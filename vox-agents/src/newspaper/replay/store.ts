import Database from 'better-sqlite3';
import { mkdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { archiveIssueSchema, type ArchiveIssue, type ArchiveList } from '../contracts/archive.js';
import { replayStateSchema } from '../contracts/replay.js';
import { publicationStateSchema, type PublicationState } from '../contracts/publication.js';
import type { IssueDocument } from '../contracts/issue.js';
import { checkCoverageSchema, type CheckCoverage } from '../contracts/coverage.js';

/** Offline output schema version written to SQLite `user_version`. */
const offlineSchemaVersion = 9;

const checkpointSchema = z.object({ session: replayStateSchema, publication: publicationStateSchema, configuration: z.unknown().optional() });
export type ReplayCheckpoint = z.infer<typeof checkpointSchema>;

/** A saved run changed elsewhere and must be resumed before another write is accepted. */
export class ReplayStoreConflictError extends Error {}

/** Refuse source aliases, symlinks and existing hardlinks before creating an output file. */
export function resolveReplayOutput(sourcePath: string, outputPath?: string): string {
  const source = realpathSync(sourcePath);
  const output = path.resolve(outputPath ?? path.join(process.cwd(), '.tmp', 'newspaper', `replays-v${offlineSchemaVersion}.sqlite`));
  const sourceStat = statSync(source);
  if (existsSync(output)) {
    const outputStat = statSync(output);
    if (realpathSync(output).toLowerCase() === source.toLowerCase()
      || (sourceStat.dev === outputStat.dev && sourceStat.ino === outputStat.ino)) {
      throw new Error('The newspaper output database must be separate from the source recording.');
    }
  } else if (output.toLowerCase() === source.toLowerCase()) {
    throw new Error('The newspaper output database must be separate from the source recording.');
  }
  return output;
}

/** Parse saved coverage. Early rows marked stories that found no slot in a published edition as `unpublished`. */
function readCoverage(saved: string): CheckCoverage {
  const coverage = checkCoverageSchema.parse(JSON.parse(saved));
  if (coverage.status === 'published')
    for (const candidate of coverage.candidates) if (candidate.outcome === 'unpublished') candidate.outcome = 'unplaced';
  return coverage;
}

/** Store the latest checkpoint and published editions for each offline run. */
export class ReplayStore {
  private readonly db: Database.Database;
  private readonly revisions = new Map<string, number>();

  /** Open the current output schema and reject any other version without changing it. */
  constructor(readonly filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    try {
      this.db.pragma('foreign_keys = ON');
      this.db.transaction(() => {
        const version = Number(this.db.pragma('user_version', { simple: true }));
        const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
        if (version === 0 ? tables.length > 0 : !['OfflineReplayRuns', 'OfflineReplayIssues'].every(name => tables.some(table => table.name === name))) {
          throw new Error('The output path contains a different database.');
        }
        if (version !== 0 && version !== offlineSchemaVersion) {
          throw new Error('This newspaper output uses an unsupported version. Choose another output path.');
        }
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS OfflineReplayRuns (
            RunID TEXT NOT NULL, Receiver INTEGER NOT NULL, SourceIdentity TEXT NOT NULL,
            ParentRunID TEXT, Checkpoint TEXT NOT NULL, Revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (RunID, Receiver)
          );
          CREATE TABLE IF NOT EXISTS OfflineReplayIssues (
            RunID TEXT NOT NULL, Receiver INTEGER NOT NULL, IssueID TEXT NOT NULL,
            Cutoff INTEGER NOT NULL, Document TEXT NOT NULL, Evidence TEXT NOT NULL,
            PRIMARY KEY (RunID, Receiver, IssueID), UNIQUE (RunID, Receiver, Cutoff),
            FOREIGN KEY (RunID, Receiver) REFERENCES OfflineReplayRuns(RunID, Receiver)
          );
          -- Added without a version change, so runs saved earlier keep resuming; their older checks have no rows.
          CREATE TABLE IF NOT EXISTS OfflineReplayCoverage (
            RunID TEXT NOT NULL, Receiver INTEGER NOT NULL, Cutoff INTEGER NOT NULL, Coverage TEXT NOT NULL,
            PRIMARY KEY (RunID, Receiver, Cutoff),
            FOREIGN KEY (RunID, Receiver) REFERENCES OfflineReplayRuns(RunID, Receiver)
          );
        `);
        this.db.pragma(`user_version = ${offlineSchemaVersion}`);
      }).immediate();
    } catch (error) { this.db.close(); throw error; }
  }

  /** Create an explicit branch or new run without overwriting saved history. */
  create(sourceIdentity: string, checkpoint: ReplayCheckpoint, parentRunId?: string): void {
    const state = checkpointSchema.parse(checkpoint);
    const created = this.db.prepare('INSERT INTO OfflineReplayRuns (RunID, Receiver, SourceIdentity, ParentRunID, Checkpoint) VALUES (?, ?, ?, ?, ?) ON CONFLICT (RunID, Receiver) DO NOTHING')
      .run(state.session.runId, state.session.settings.receiverPlayerID, sourceIdentity, parentRunId ?? null, JSON.stringify(state));
    if (created.changes !== 1) throw new ReplayStoreConflictError('Run already exists; resume it or choose another run ID.');
    this.revisions.set(JSON.stringify([state.session.runId, state.session.settings.receiverPlayerID]), 0);
  }

  /** Resume only the requested source, branch and receiving player. */
  load(runId: string, receiver: number, sourceIdentity: string): ReplayCheckpoint {
    const row = this.db.prepare('SELECT SourceIdentity, Checkpoint, Revision FROM OfflineReplayRuns WHERE RunID = ? AND Receiver = ?')
      .get(runId, receiver) as { SourceIdentity: string; Checkpoint: string; Revision: number } | undefined;
    if (!row) throw new Error('The requested replay run and receiver were not found. Choose New run and Generate to regenerate editions from the recording.');
    if (row.SourceIdentity !== sourceIdentity) throw new Error('This run belongs to a different source recording.');
    const checkpoint = checkpointSchema.parse(JSON.parse(row.Checkpoint));
    this.revisions.set(JSON.stringify([runId, receiver]), row.Revision);
    return checkpoint;
  }

  /** Advance the run and save any edition, its evidence, and the check's coverage in the same transaction. */
  commit(checkpoint: ReplayCheckpoint, issue?: IssueDocument, coverage?: CheckCoverage): void {
    const next = checkpointSchema.parse(checkpoint);
    const runId = next.session.runId!;
    const receiver = next.session.settings.receiverPlayerID;
    const cutoff = next.session.cursor.cutoffTurn;
    if (cutoff === null || next.publication.lastCheckTurn !== cutoff) throw new Error('Check and checkpoint cutoffs must agree.');
    this.db.transaction(() => {
      const revision = this.revisions.get(JSON.stringify([runId, receiver]));
      const current = this.db.prepare(`
        SELECT Revision, json_extract(Checkpoint, '$.publication.lastCheckTurn') AS LastCheckTurn
        FROM OfflineReplayRuns WHERE RunID = ? AND Receiver = ?
      `).get(runId, receiver) as { Revision: number; LastCheckTurn: number | null } | undefined;
      if (!current || current.Revision !== revision) {
        throw new ReplayStoreConflictError('This replay run changed in another session. Resume the run to reload its latest checks and votes.');
      }
      if (current.LastCheckTurn !== null && cutoff <= current.LastCheckTurn) {
        throw new ReplayStoreConflictError('This cutoff has already been reached; resume the saved run.');
      }
      if (issue) {
        if (issue.receiver.playerId !== receiver || issue.timelineId !== runId || issue.cutoff.turn !== cutoff) throw new Error('Issue identity does not match its replay checkpoint.');
        const evidence = next.publication.issues.find(record => record.issueId === issue.issueId);
        if (!evidence) throw new Error('Published issue evidence is missing from the checkpoint.');
        this.db.prepare('INSERT INTO OfflineReplayIssues VALUES (?, ?, ?, ?, ?, ?)')
          .run(runId, receiver, issue.issueId, cutoff, JSON.stringify(issue), JSON.stringify(evidence));
      }
      if (coverage) {
        if (coverage.turn !== cutoff) throw new Error('Coverage and checkpoint cutoffs must agree.');
        this.db.prepare('INSERT INTO OfflineReplayCoverage VALUES (?, ?, ?, ?)')
          .run(runId, receiver, cutoff, JSON.stringify(checkCoverageSchema.parse(coverage)));
      }
      this.save(next);
    }).immediate();
  }

  /** Save replaceable preferences or votes without changing any immutable publication. */
  save(checkpoint: ReplayCheckpoint): void {
    const state = checkpointSchema.parse(checkpoint);
    const key = JSON.stringify([state.session.runId, state.session.settings.receiverPlayerID]);
    const revision = this.revisions.get(key);
    if (revision === undefined) throw new ReplayStoreConflictError('Resume this replay run before saving changes.');
    const changed = this.db.prepare('UPDATE OfflineReplayRuns SET Checkpoint = ?, Revision = Revision + 1 WHERE RunID = ? AND Receiver = ? AND Revision = ?')
      .run(JSON.stringify(state), state.session.runId, state.session.settings.receiverPlayerID, revision);
    if (changed.changes !== 1) throw new ReplayStoreConflictError('This replay run changed in another session. Resume the run to reload its latest checks and votes.');
    this.revisions.set(key, revision + 1);
  }

  /** List only this branch's receiver, in publication order. */
  list(runId: string, receiver: number): ArchiveList {
    const rows = this.db.prepare('SELECT Document FROM OfflineReplayIssues WHERE RunID = ? AND Receiver = ? ORDER BY Cutoff, IssueID')
      .all(runId, receiver) as { Document: string }[];
    return { issues: rows.map(row => {
      const issue = JSON.parse(row.Document) as ArchiveIssue['issue'];
      return { issueId: issue.issueId, runId, receiverPlayerID: receiver, cutoffTurn: issue.cutoff.turn, title: issue.publication.title, itemCount: issue.items.length };
    }) };
  }

  /** Read an edition and its sources with the current votes for its articles. */
  get(runId: string, receiver: number, issueId: string, publication: PublicationState): ArchiveIssue | undefined {
    const row = this.db.prepare('SELECT Document, Evidence FROM OfflineReplayIssues WHERE RunID = ? AND Receiver = ? AND IssueID = ?')
      .get(runId, receiver, issueId) as { Document: string; Evidence: string } | undefined;
    if (!row) return undefined;
    const issue = JSON.parse(row.Document) as ArchiveIssue['issue'];
    return archiveIssueSchema.parse({
      index: { issueId, runId, receiverPlayerID: receiver, cutoffTurn: issue.cutoff.turn, title: issue.publication.title, itemCount: issue.items.length },
      issue, articles: JSON.parse(row.Evidence).items, votes: Object.fromEntries(issue.items.map(item => [item.id, publication.votes[item.id] ?? 0])),
    });
  }

  /** Read every saved check's coverage for this branch's receiver, in cutoff order. */
  coverage(runId: string, receiver: number): CheckCoverage[] {
    const rows = this.db.prepare('SELECT Coverage FROM OfflineReplayCoverage WHERE RunID = ? AND Receiver = ? ORDER BY Cutoff')
      .all(runId, receiver) as { Coverage: string }[];
    return rows.map(row => readCoverage(row.Coverage));
  }

  /** Read one check's coverage, or undefined when that check saved none. */
  checkCoverage(runId: string, receiver: number, turn: number): CheckCoverage | undefined {
    const row = this.db.prepare('SELECT Coverage FROM OfflineReplayCoverage WHERE RunID = ? AND Receiver = ? AND Cutoff = ?')
      .get(runId, receiver, turn) as { Coverage: string } | undefined;
    return row && readCoverage(row.Coverage);
  }

  /** Close the output connection after the session has drained its queue. */
  close(): void { this.db.close(); }
}
