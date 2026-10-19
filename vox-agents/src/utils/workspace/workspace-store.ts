/**
 * @module utils/workspace/workspace-store
 *
 * A seat's versioned file store in one SQLite database. It follows git's object model without git:
 * file contents are stored once by SHA-256 hash, each change is a commit that points to its parent,
 * and the `head` reference names the current version. A version is read by replaying the path
 * changes of its ancestors in order, so each path resolves to its latest change.
 *
 * The store's tables live in the seat's telemetry database next to its spans, so one file holds a
 * seat's whole game.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import { createLogger } from '../logger.js';
import { errorMessage } from '../errors.js';

const logger = createLogger('WorkspaceStore');

/** What a commit means. */
export type CommitKind = 'init' | 'turn' | 'briefing' | 'notes' | 'reload' | 'reference';

/** The INTEGER PRIMARY KEY of a `ws_commits` row. */
export type CommitID = number;

/** A file in a version. Store paths have no leading slash and start with `records/`, `game/`, or `reference/`. */
export interface StoreFile { type: 'file'; hash: string; size: number; mode: number; mtime: number }

/** An explicit directory in a version, kept for empty directories and directory metadata. */
export interface StoreDir { type: 'dir'; mode: number; mtime: number }

/** One explicit entry of a version. */
export type ManifestEntry = StoreFile | StoreDir;

/** Every explicit entry of a version by store path. Parent directories are implied. */
export type Manifest = ReadonlyMap<string, ManifestEntry>;

/** One path change in a commit. A delete removes the path and everything under it. */
export type PathChange =
  | { path: string; type: 'file'; content: string | Uint8Array; mode?: number; mtime?: number }
  | { path: string; type: 'dir'; mode?: number; mtime?: number }
  | { path: string; type: 'delete' };

/** What a writer asks {@link WorkspaceStore.commit} to record. */
export interface CommitRequest {
  kind: Exclude<CommitKind, 'init'>;
  turn: number | null;
  /** `host` or an agent name. */
  author: string;
  changes: PathChange[];
  /** Derived files computed inside the transaction from the tree after `changes`, such as a catalog. */
  derive?: (tree: Manifest, read: (path: string) => Uint8Array | undefined) => PathChange[];
  /** Run signal. The commit throws and writes nothing when it is aborted. */
  signal?: AbortSignal;
}

/** One commit row. */
export interface CommitInfo {
  id: CommitID;
  parent: CommitID | null;
  turn: number | null;
  kind: CommitKind;
  author: string;
  traceId: string | null;
  spanId: string | null;
  time: number;
}

/** Default mode for files written without one. */
const defaultFileMode = 0o644;
/** Default mode for directories written without one. */
const defaultDirMode = 0o755;

/** Store folder of the game reference, static game data that a rewind carries forward. */
export const referenceStoreFolder = 'reference';
/** Path prefix of every entry in the reference folder. */
export const referenceStorePrefix = `${referenceStoreFolder}/`;

const schema = `
CREATE TABLE IF NOT EXISTS ws_blobs (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  compressed INTEGER NOT NULL,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_commits (
  id INTEGER PRIMARY KEY,
  parent INTEGER REFERENCES ws_commits(id),
  turn INTEGER,
  kind TEXT NOT NULL,
  author TEXT NOT NULL,
  trace_id TEXT,
  span_id TEXT,
  time INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ws_changes (
  commit_id INTEGER NOT NULL REFERENCES ws_commits(id),
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('file', 'dir', 'delete')),
  hash TEXT REFERENCES ws_blobs(hash),
  mode INTEGER,
  mtime INTEGER,
  PRIMARY KEY (commit_id, seq)
);
CREATE TABLE IF NOT EXISTS ws_refs (
  name TEXT PRIMARY KEY,
  commit_id INTEGER NOT NULL REFERENCES ws_commits(id)
);
`;

/** Common table expression listing a commit and all its ancestors; bind the commit ID. */
const chainCte = `WITH RECURSIVE chain(id) AS (
  SELECT ?
  UNION ALL SELECT ws_commits.parent FROM ws_commits JOIN chain ON ws_commits.id = chain.id
  WHERE ws_commits.parent IS NOT NULL
)`;

/** A `ws_changes` row joined with its blob size. */
interface ChangeRow { path: string; type: 'file' | 'dir' | 'delete'; hash: string | null; mode: number | null; mtime: number | null; size: number | null }

/** A `ws_commits` row as SQLite returns it. */
interface CommitRow { id: number; parent: number | null; turn: number | null; kind: CommitKind; author: string; trace_id: string | null; span_id: string | null; time: number }

/** The store's tables, in an order that copies referenced rows first. */
const storeTables = ['ws_blobs', 'ws_commits', 'ws_changes', 'ws_refs'] as const;

/** Whether a connection's main database has the store's `ws_refs` table. */
function hasRefsTable(db: Database.Database): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ws_refs'`).get() !== undefined;
}

/**
 * Append the attached `seed` store's newer commits to the main store and take its refs, when the main
 * store is an earlier copy of the seed: the seed has commits past the main store's last one, and every
 * main commit matches a seed commit by ID, parent, kind, and time. Existing commits keep their IDs, so
 * commits named in telemetry still read the same versions. Diverged histories are left alone.
 *
 * @returns Whether commits were copied
 */
function catchUpFromSeed(db: Database.Database): boolean {
  const last = (db.prepare('SELECT MAX(id) AS id FROM main.ws_commits').get() as { id: number | null }).id ?? 0;
  const seedLast = (db.prepare('SELECT MAX(id) AS id FROM seed.ws_commits').get() as { id: number | null }).id ?? 0;
  if (seedLast <= last) return false;
  const unmatched = db.prepare(`SELECT COUNT(*) AS count FROM main.ws_commits m LEFT JOIN seed.ws_commits s
    ON s.id = m.id AND s.parent IS m.parent AND s.kind = m.kind AND s.time = m.time WHERE s.id IS NULL`)
    .get() as { count: number };
  if (unmatched.count > 0) {
    logger.warn('Workspace store history differs from the newer seed store, so the newer commits were not copied');
    return false;
  }
  db.prepare(`INSERT OR IGNORE INTO main.ws_blobs SELECT * FROM seed.ws_blobs
    WHERE hash IN (SELECT hash FROM seed.ws_changes WHERE commit_id > ? AND hash IS NOT NULL)`).run(last);
  db.prepare('INSERT INTO main.ws_commits SELECT * FROM seed.ws_commits WHERE id > ?').run(last);
  db.prepare('INSERT INTO main.ws_changes SELECT * FROM seed.ws_changes WHERE commit_id > ?').run(last);
  db.exec('INSERT OR REPLACE INTO main.ws_refs SELECT * FROM seed.ws_refs');
  return true;
}

/**
 * The time of a database's newest store commit through a short read-only connection, or undefined
 * when the file is missing, unreadable, or has no store.
 */
function storeTime(dbPath: string): number | undefined {
  if (!fs.existsSync(dbPath)) return undefined;
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    if (!hasRefsTable(db)) return undefined;
    const row = db.prepare('SELECT MAX(time) AS time FROM ws_commits').get() as { time: number | null };
    return row.time ?? 0;
  } catch (error) {
    logger.warn(`Could not read workspace store in ${dbPath}: ${errorMessage(error)}`);
    return undefined;
  } finally {
    db?.close();
  }
}

/** Require a relative path in a store folder, allowing the folder itself only for deletion. */
function checkStorePath({ path: storePath, type }: PathChange): void {
  const parts = storePath.split('/');
  if (!['records', 'game', 'reference'].includes(parts[0]) || (parts.length < 2 && type !== 'delete')
    || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Invalid workspace store path: ${storePath}`);
  }
}

/** View a Buffer as a plain Uint8Array without copying. */
function asBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Remove every entry strictly under a path. */
function removeUnder(tree: Map<string, ManifestEntry>, storePath: string): void {
  const prefix = `${storePath}/`;
  for (const key of tree.keys()) {
    if (key.startsWith(prefix)) tree.delete(key);
  }
}

/**
 * Apply one resolved change to a tree. A delete removes the path and everything under it. A file
 * or directory replaces any file at an ancestor path, and a file replacing an explicit directory
 * drops that directory's contents, so the tree stays a valid hierarchy.
 */
function applyEntry(tree: Map<string, ManifestEntry>, storePath: string, entry: ManifestEntry | null): void {
  if (entry === null) {
    tree.delete(storePath);
    removeUnder(tree, storePath);
    return;
  }
  for (let index = storePath.indexOf('/'); index !== -1; index = storePath.indexOf('/', index + 1)) {
    const parent = storePath.slice(0, index);
    if (tree.get(parent)?.type === 'file') tree.delete(parent);
  }
  if (entry.type === 'file' && tree.get(storePath)?.type === 'dir') removeUnder(tree, storePath);
  tree.set(storePath, entry);
}

/** The manifest entry a stored change row produces, or null for a delete. */
function rowEntry(row: ChangeRow): ManifestEntry | null {
  if (row.type === 'delete') return null;
  if (row.type === 'dir') return { type: 'dir', mode: row.mode ?? defaultDirMode, mtime: row.mtime ?? 0 };
  return { type: 'file', hash: row.hash ?? '', size: row.size ?? 0, mode: row.mode ?? defaultFileMode, mtime: row.mtime ?? 0 };
}

/** Convert a commit row to its public shape. */
function commitInfo(row: CommitRow): CommitInfo {
  return {
    id: row.id, parent: row.parent, turn: row.turn, kind: row.kind, author: row.author,
    traceId: row.trace_id, spanId: row.span_id, time: row.time,
  };
}

/**
 * One connection to a seat's versioned store. Writes go through {@link commit} and {@link rewind},
 * each one synchronous transaction, so readers always see whole commits.
 */
export class WorkspaceStore {
  private cache?: { id: CommitID; tree: Map<string, ManifestEntry> };

  /** Wrap an open connection; use {@link WorkspaceStore.open}. */
  private constructor(private readonly db: Database.Database) {}

  /**
   * Whether a database file holds a store. The file may exist with only telemetry tables.
   */
  static hasStore(dbPath: string): boolean {
    return storeTime(dbPath) !== undefined;
  }

  /**
   * The seat's store to copy from. Telemetry files sit at `<root>/<folder>/<seat>.db` with one
   * folder per strategist, so a seat that changes strategist writes to another file. This returns
   * the same file name in another folder of the same root, except `workspaces`, with the newest
   * commit, so the seat's records and notes follow it.
   *
   * @param dbPath - The database being opened
   * @returns The seed database, or undefined when no sibling holds a store
   */
  static findSeed(dbPath: string): string | undefined {
    const name = path.basename(dbPath);
    const target = path.resolve(dbPath);
    const root = path.dirname(path.dirname(target));
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return undefined;
    }
    let best: { file: string; time: number } | undefined;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'workspaces') continue;
      const file = path.resolve(root, entry.name, name);
      if (file === target) continue;
      const time = storeTime(file);
      if (time !== undefined && (!best || time > best.time)) best = { file, time };
    }
    return best?.file;
  }

  /**
   * Open a store. A writable open creates the folder, the schema, and the first commit with `head`
   * in one transaction when the file has no store, and keeps them on reopening. The first commit is
   * an empty `init`, or, with `seedFrom`, a copy of that store's whole history with the same commit
   * IDs. An existing store opened with `seedFrom` takes the seed's newer commits when it is an
   * earlier copy of the seed. A read-only open requires an existing store and never writes.
   */
  static open(dbPath: string, options: { readonly?: boolean; seedFrom?: string } = {}): WorkspaceStore {
    if (options.readonly) {
      return new WorkspaceStore(new Database(dbPath, { readonly: true, fileMustExist: true }));
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    let copied: 'whole' | 'newer' | undefined;
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      // SQLite cannot attach inside a transaction, so the seed is attached before checking for head.
      const seed = options.seedFrom !== undefined;
      if (seed) db.prepare('ATTACH DATABASE ? AS seed').run(options.seedFrom);
      try {
        db.transaction(() => {
          db.exec(schema);
          if (db.prepare(`SELECT 1 FROM ws_refs WHERE name = 'head'`).get()) {
            if (seed && catchUpFromSeed(db)) copied = 'newer';
            return;
          }
          if (seed) {
            for (const table of storeTables) db.exec(`INSERT INTO main.${table} SELECT * FROM seed.${table}`);
            if (db.prepare(`SELECT 1 FROM ws_refs WHERE name = 'head'`).get()) {
              copied = 'whole';
              return;
            }
          }
          const init = db.prepare(`INSERT INTO ws_commits (parent, turn, kind, author, time) VALUES (NULL, NULL, 'init', 'host', ?)`)
            .run(Date.now());
          db.prepare(`INSERT INTO ws_refs (name, commit_id) VALUES ('head', ?)`).run(init.lastInsertRowid);
        }).immediate();
      } finally {
        if (seed) db.exec('DETACH DATABASE seed');
      }
    } catch (error) {
      db.close();
      throw error;
    }
    if (copied === 'whole') logger.info(`Copied workspace store from ${options.seedFrom} into ${dbPath}`);
    if (copied === 'newer') logger.info(`Copied newer workspace commits from ${options.seedFrom} into ${dbPath}`);
    return new WorkspaceStore(db);
  }

  /** The commit `head` names. */
  head(): CommitID {
    const row = this.db.prepare(`SELECT commit_id FROM ws_refs WHERE name = 'head'`).get() as { commit_id: number } | undefined;
    if (!row) throw new Error('Workspace store has no head');
    return row.commit_id;
  }

  /** Whether a commit exists, in or out of head's ancestry. */
  hasCommit(id: CommitID): boolean {
    return this.db.prepare('SELECT 1 FROM ws_commits WHERE id = ?').get(id) !== undefined;
  }

  /**
   * The explicit entries of a version, head by default. Head's manifest is cached in memory and
   * rebuilt only when head moves.
   *
   * @throws for an unknown commit
   */
  manifest(commit?: CommitID): Manifest {
    const head = this.head();
    const id = commit ?? head;
    if (this.cache?.id === id) return this.cache.tree;
    const tree = this.buildTree(id);
    if (id === head) this.cache = { id, tree };
    return tree;
  }

  /** The contents of a blob. */
  readBlob(hash: string): Uint8Array {
    const row = this.db.prepare('SELECT compressed, data FROM ws_blobs WHERE hash = ?').get(hash) as
      { compressed: number; data: Buffer } | undefined;
    if (!row) throw new Error(`Workspace store has no blob ${hash}`);
    return asBytes(row.compressed ? inflateSync(row.data) : row.data);
  }

  /** A file's contents in a version, head by default, or undefined when it is not a file there. */
  readFile(storePath: string, commit?: CommitID): Uint8Array | undefined {
    const entry = this.manifest(commit).get(storePath);
    return entry?.type === 'file' ? this.readBlob(entry.hash) : undefined;
  }

  /**
   * Record changes as one commit on top of the current head, in one synchronous transaction. Later
   * commits win path by path. Derived files are computed from the resulting tree inside the same
   * transaction. The commit records the active span's trace and span IDs.
   *
   * @throws without writing when the request's signal is aborted or a path is invalid
   */
  commit(request: CommitRequest): CommitID {
    const spanContext = trace.getActiveSpan()?.spanContext();
    const span = spanContext && isSpanContextValid(spanContext) ? spanContext : undefined;
    const result = this.db.transaction(() => {
      request.signal?.throwIfAborted();
      const parent = this.head();
      const tree = new Map(this.manifest(parent));
      const id = Number(this.db.prepare(
        'INSERT INTO ws_commits (parent, turn, kind, author, trace_id, span_id, time) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(parent, request.turn, request.kind, request.author, span?.traceId ?? null, span?.spanId ?? null, Date.now()).lastInsertRowid);
      const seq = this.writeChanges(id, 0, request.changes, tree);
      if (request.derive) {
        const read = (storePath: string): Uint8Array | undefined => {
          const entry = tree.get(storePath);
          return entry?.type === 'file' ? this.readBlob(entry.hash) : undefined;
        };
        this.writeChanges(id, seq, request.derive(tree, read), tree);
      }
      this.db.prepare(`UPDATE ws_refs SET commit_id = ? WHERE name = 'head'`).run(id);
      return { id, tree };
    }).immediate();
    this.cache = result;
    return result.id;
  }

  /** The turn of the newest `turn` commit in head's ancestry, or undefined before any turn is recorded. */
  lastRecordedTurn(): number | undefined {
    const row = this.db.prepare(`${chainCte}
      SELECT turn FROM ws_commits WHERE id IN chain AND kind = 'turn' ORDER BY id DESC LIMIT 1`)
      .get(this.head()) as { turn: number } | undefined;
    return row?.turn ?? undefined;
  }

  /**
   * Discard the timeline from turn N on. Does nothing unless the last recorded turn is N or later.
   * Otherwise moves head to the parent of the oldest `turn` commit for turn N or later in head's
   * ancestry and adds a `reload` commit for turn N there. The reload commit preserves the current
   * reference, including deletions, since the reference does not depend on the turn.
   * Discarded commits stay in history.
   *
   * @returns whether head moved
   */
  rewind(turn: number): boolean {
    const moved = this.db.transaction(() => {
      const last = this.lastRecordedTurn();
      if (last === undefined || last < turn) return false;
      const discarded = this.manifest();
      const anchor = this.db.prepare(`${chainCte}
        SELECT id, parent FROM ws_commits WHERE id IN chain AND kind = 'turn' AND turn >= ? ORDER BY id ASC LIMIT 1`)
        .get(this.head(), turn) as { id: number; parent: number };
      const reload = Number(this.db.prepare(
        `INSERT INTO ws_commits (parent, turn, kind, author, time) VALUES (?, ?, 'reload', 'host', ?)`,
      ).run(anchor.parent, turn, Date.now()).lastInsertRowid);
      const insert = this.db.prepare(
        `INSERT INTO ws_changes (commit_id, seq, path, type, hash, mode, mtime) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      let seq = 0;
      insert.run(reload, seq++, referenceStoreFolder, 'delete', null, null, null);
      for (const [storePath, entry] of discarded) {
        if (!storePath.startsWith(referenceStorePrefix)) continue;
        insert.run(reload, seq++, storePath, entry.type, entry.type === 'file' ? entry.hash : null, entry.mode, entry.mtime);
      }
      this.db.prepare(`UPDATE ws_refs SET commit_id = ? WHERE name = 'head'`).run(reload);
      logger.info(`Rewound workspace store to before turn ${turn} (last recorded turn ${last})`);
      return true;
    }).immediate();
    if (moved) this.cache = undefined;
    return moved;
  }

  /** Every commit in creation order, including ones outside head's ancestry. */
  history(): CommitInfo[] {
    return (this.db.prepare('SELECT * FROM ws_commits ORDER BY id').all() as CommitRow[]).map(commitInfo);
  }

  /** Run a function inside one read transaction, so every read in it sees the same version. */
  readTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Close the connection. */
  close(): void {
    this.db.close();
  }

  /** Replay a commit's ancestry into its tree. */
  private buildTree(id: CommitID): Map<string, ManifestEntry> {
    if (!this.hasCommit(id)) throw new Error(`Workspace store has no commit ${id}`);
    const rows = this.db.prepare(`${chainCte}
      SELECT c.path, c.type, c.hash, c.mode, c.mtime, b.size FROM ws_changes c
      LEFT JOIN ws_blobs b ON b.hash = c.hash
      WHERE c.commit_id IN chain ORDER BY c.commit_id, c.seq`).all(id) as ChangeRow[];
    const tree = new Map<string, ManifestEntry>();
    for (const row of rows) applyEntry(tree, row.path, rowEntry(row));
    return tree;
  }

  /** Store each change's blob and row for a commit and apply it to the tree; returns the next sequence number. */
  private writeChanges(commit: CommitID, seq: number, changes: PathChange[], tree: Map<string, ManifestEntry>): number {
    const insert = this.db.prepare(
      'INSERT INTO ws_changes (commit_id, seq, path, type, hash, mode, mtime) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const change of changes) {
      checkStorePath(change);
      let entry: ManifestEntry | null = null;
      if (change.type === 'file') {
        const bytes = typeof change.content === 'string' ? asBytes(Buffer.from(change.content, 'utf8')) : change.content;
        entry = { type: 'file', hash: this.putBlob(bytes), size: bytes.byteLength, mode: change.mode ?? defaultFileMode, mtime: change.mtime ?? Date.now() };
      } else if (change.type === 'dir') {
        entry = { type: 'dir', mode: change.mode ?? defaultDirMode, mtime: change.mtime ?? Date.now() };
      }
      insert.run(commit, seq++, change.path, change.type, entry?.type === 'file' ? entry.hash : null,
        entry?.mode ?? null, entry?.mtime ?? null);
      applyEntry(tree, change.path, entry);
    }
    return seq;
  }

  /** Store contents once by SHA-256 hash, compressed with zlib only when that is smaller. */
  private putBlob(bytes: Uint8Array): string {
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (this.db.prepare('SELECT 1 FROM ws_blobs WHERE hash = ?').get(hash)) return hash;
    const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const packed = deflateSync(raw);
    const compressed = packed.byteLength < raw.byteLength;
    this.db.prepare('INSERT INTO ws_blobs (hash, size, compressed, data) VALUES (?, ?, ?, ?)')
      .run(hash, raw.byteLength, compressed ? 1 : 0, compressed ? packed : raw);
    return hash;
  }
}
