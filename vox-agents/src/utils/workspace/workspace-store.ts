/**
 * @module utils/workspace/workspace-store
 *
 * A seat's versioned file store in one SQLite database. It follows git's object model without git:
 * file contents are stored once by SHA-256 hash, each change is a commit that points to its parent,
 * and the `head` reference names the current version. A version is read by replaying the path
 * changes of its ancestors in order, so each path resolves to its latest change.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import { createLogger } from '../logger.js';
import { workspaceRoot, workspaceSeatName } from './player-workspace.js';

const logger = createLogger('WorkspaceStore');

/** What a commit means. */
export type CommitKind = 'init' | 'turn' | 'briefing' | 'notes' | 'reload';

/** The INTEGER PRIMARY KEY of a `ws_commits` row. */
export type CommitID = number;

/** A file in a version. Store paths have no leading slash and start with `records/` or `game/`. */
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

/** Check that a store path is relative, starts with `records/` or `game/`, and has no `.` or `..` parts. */
function checkStorePath(storePath: string): void {
  const parts = storePath.split('/');
  if ((parts[0] !== 'records' && parts[0] !== 'game') || parts.length < 2
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
   * The store path for one seat, `<workspaceRoot()>/games/<gameID>-player-<playerID>.db`. It does
   * not depend on the strategist, so a seat keeps one store across sessions.
   *
   * @throws if the game ID cannot name a workspace folder
   */
  static pathFor(gameID: string, playerID: number): string {
    return path.join(workspaceRoot(), 'games', `${workspaceSeatName(gameID, playerID)}.db`);
  }

  /**
   * Open a store. A writable open creates the folder, the schema, and the empty `init` commit with
   * `head` in one transaction when the store is new, and keeps them on reopening. A read-only open
   * requires an existing store and never writes.
   */
  static open(dbPath: string, options: { readonly?: boolean } = {}): WorkspaceStore {
    if (options.readonly) {
      return new WorkspaceStore(new Database(dbPath, { readonly: true, fileMustExist: true }));
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.transaction(() => {
        db.exec(schema);
        if (db.prepare(`SELECT 1 FROM ws_refs WHERE name = 'head'`).get()) return;
        const init = db.prepare(`INSERT INTO ws_commits (parent, turn, kind, author, time) VALUES (NULL, NULL, 'init', 'host', ?)`)
          .run(Date.now());
        db.prepare(`INSERT INTO ws_refs (name, commit_id) VALUES ('head', ?)`).run(init.lastInsertRowid);
      }).immediate();
    } catch (error) {
      db.close();
      throw error;
    }
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
   * ancestry and adds a `reload` commit for turn N there. Discarded commits stay in history.
   *
   * @returns whether head moved
   */
  rewind(turn: number): boolean {
    const moved = this.db.transaction(() => {
      const last = this.lastRecordedTurn();
      if (last === undefined || last < turn) return false;
      const anchor = this.db.prepare(`${chainCte}
        SELECT id, parent FROM ws_commits WHERE id IN chain AND kind = 'turn' AND turn >= ? ORDER BY id ASC LIMIT 1`)
        .get(this.head(), turn) as { id: number; parent: number };
      const reload = Number(this.db.prepare(
        `INSERT INTO ws_commits (parent, turn, kind, author, time) VALUES (?, ?, 'reload', 'host', ?)`,
      ).run(anchor.parent, turn, Date.now()).lastInsertRowid);
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
      checkStorePath(change.path);
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
