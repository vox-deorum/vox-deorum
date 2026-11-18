import Database from 'better-sqlite3';
import { mkdirSync, realpathSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { archiveIssueSchema, type ArchiveIssue, type ArchiveList } from '../contracts/archive.js';
import { replayStateSchema, replayCheckSchema } from '../contracts/replay.js';
import { publicationStateSchema, type PublicationState } from '../contracts/publication.js';

const checkpointSchema = z.object({ session: replayStateSchema, publication: publicationStateSchema, configuration: z.unknown().optional() });
export type ReplayCheckpoint = z.infer<typeof checkpointSchema>;
export type StoredReplayCheck = z.infer<typeof replayCheckSchema>;

/** A saved run changed elsewhere and must be resumed before another write is accepted. */
export class ReplayStoreConflictError extends Error {}

/** Refuse source aliases, symlinks and existing hardlinks before creating an output file. */
export function resolveReplayOutput(sourcePath: string, outputPath?: string): string {
  const source = realpathSync(sourcePath);
  const output = path.resolve(outputPath ?? path.join(process.cwd(), '.tmp', 'newspaper', 'replays.sqlite'));
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

/** Versioned offline publication storage. Live game checkpoints belong to Plan 5. */
export class ReplayStore {
  private readonly db: Database.Database;
  private readonly revisions = new Map<string, number>();

  /** Create only the offline output schema and reject incompatible databases. */
  constructor(readonly filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    try {
      this.db.pragma('foreign_keys = ON');
      const version = this.db.pragma('user_version', { simple: true });
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
      if (version !== 0 && version !== 4) {
        throw new Error('Unsupported offline newspaper database version. Choose a new output path to start a fresh run.');
      }
      if (version === 0 && tables.length) throw new Error('The output path contains a different database.');
      if (version !== 0 && !['OfflineReplayRuns', 'OfflineReplayChecks', 'OfflineReplayIssues'].every(name => tables.some(table => table.name === name))) {
        throw new Error('The output path is not an offline newspaper database.');
      }
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS OfflineReplayRuns (
            RunID TEXT NOT NULL, Receiver INTEGER NOT NULL, SourceIdentity TEXT NOT NULL,
            ParentRunID TEXT, Checkpoint TEXT NOT NULL, Revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (RunID, Receiver)
          );
          CREATE TABLE IF NOT EXISTS OfflineReplayChecks (
            RunID TEXT NOT NULL, Receiver INTEGER NOT NULL, Cutoff INTEGER NOT NULL,
            Result TEXT NOT NULL, PRIMARY KEY (RunID, Receiver, Cutoff),
            FOREIGN KEY (RunID, Receiver) REFERENCES OfflineReplayRuns(RunID, Receiver)
          );
          CREATE TABLE IF NOT EXISTS OfflineReplayIssues (
            RunID TEXT NOT NULL, Receiver INTEGER NOT NULL, IssueID TEXT NOT NULL,
            Cutoff INTEGER NOT NULL, Document TEXT NOT NULL, Decision TEXT NOT NULL, Evidence TEXT NOT NULL,
            PRIMARY KEY (RunID, Receiver, IssueID), UNIQUE (RunID, Receiver, Cutoff),
            FOREIGN KEY (RunID, Receiver) REFERENCES OfflineReplayRuns(RunID, Receiver)
          );
        `);
        this.db.pragma('user_version = 4');
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
    if (!row) throw new Error('The requested replay run and receiver were not found.');
    if (row.SourceIdentity !== sourceIdentity) throw new Error('This run belongs to a different source recording.');
    const checkpoint = checkpointSchema.parse(JSON.parse(row.Checkpoint));
    this.revisions.set(JSON.stringify([runId, receiver]), row.Revision);
    return checkpoint;
  }

  /** Return a previously committed cutoff without invoking the editor again. */
  getCheck(runId: string, receiver: number, cutoff: number): StoredReplayCheck | undefined {
    const row = this.db.prepare('SELECT Result FROM OfflineReplayChecks WHERE RunID = ? AND Receiver = ? AND Cutoff = ?')
      .get(runId, receiver, cutoff) as { Result: string } | undefined;
    return row ? replayCheckSchema.parse(JSON.parse(row.Result)) : undefined;
  }

  /** Commit immutable content, evidence, decision, cursor and editorial memory in one transaction. */
  commit(checkpoint: ReplayCheckpoint, result: StoredReplayCheck): StoredReplayCheck {
    const next = checkpointSchema.parse(checkpoint);
    const check = replayCheckSchema.parse(structuredClone(result));
    const runId = next.session.runId!;
    const receiver = next.session.settings.receiverPlayerID;
    const cutoff = next.session.cursor.cutoffTurn!;
    if (check.decision.cutoffTurn !== cutoff || next.publication.lastCheckTurn !== cutoff) throw new Error('Check and checkpoint cutoffs must agree.');
    if ((check.status === 'published') !== !!check.issue) throw new Error('Published checks require an issue; skipped checks cannot carry one.');
    return this.db.transaction(() => {
      const revision = this.revisions.get(JSON.stringify([runId, receiver]));
      const current = this.db.prepare('SELECT Revision FROM OfflineReplayRuns WHERE RunID = ? AND Receiver = ?')
        .get(runId, receiver) as { Revision: number } | undefined;
      if (revision === undefined || current?.Revision !== revision) {
        throw new ReplayStoreConflictError('This replay run changed in another session. Resume the run to reload its latest checks and votes.');
      }
      const previous = this.getCheck(runId, receiver, cutoff);
      if (previous) return previous;
      this.db.prepare('INSERT INTO OfflineReplayChecks VALUES (?, ?, ?, ?)').run(runId, receiver, cutoff, JSON.stringify(check));
      if (check.issue) {
        if (check.issue.receiver.playerId !== receiver || check.issue.timelineId !== runId || check.issue.cutoff.turn !== cutoff) throw new Error('Issue identity does not match its replay checkpoint.');
        const evidence = next.publication.issues.find(issue => issue.issueId === check.issue!.issueId);
        if (!evidence) throw new Error('Published issue evidence is missing from the checkpoint.');
        this.db.prepare('INSERT INTO OfflineReplayIssues VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(runId, receiver, check.issue.issueId, cutoff, JSON.stringify(check.issue), JSON.stringify(check.decision), JSON.stringify(evidence));
      }
      this.save(next);
      return check;
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

  /** Read stored prose and decisions and overlay today's votes for its unique articles. */
  get(runId: string, receiver: number, issueId: string, publication: PublicationState): ArchiveIssue | undefined {
    const row = this.db.prepare('SELECT Document, Decision, Evidence FROM OfflineReplayIssues WHERE RunID = ? AND Receiver = ? AND IssueID = ?')
      .get(runId, receiver, issueId) as { Document: string; Decision: string; Evidence: string } | undefined;
    if (!row) return undefined;
    const issue = JSON.parse(row.Document) as ArchiveIssue['issue'];
    return archiveIssueSchema.parse({
      index: { issueId, runId, receiverPlayerID: receiver, cutoffTurn: issue.cutoff.turn, title: issue.publication.title, itemCount: issue.items.length },
      issue, articles: JSON.parse(row.Evidence).items, decision: JSON.parse(row.Decision), votes: Object.fromEntries(issue.items.map(item => [item.id, publication.votes[item.id] ?? 0])),
    });
  }

  /** Close the output connection after the session has drained its queue. */
  close(): void { this.db.close(); }
}
