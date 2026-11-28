import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFile, link } from 'node:fs/promises';
import path from 'node:path';
import { ReplayStore, ReplayStoreConflictError, resolveReplayOutput, type ReplayCheckpoint } from '../../../../src/newspaper/replay/store.js';
import { replayStateSchema } from '../../../../src/newspaper/contracts/replay.js';
import { issueDocumentSchema, type IssueDocument } from '../../../../src/newspaper/contracts/issue.js';
import { createInitialPublicationState } from '../../../../src/newspaper/contracts/publication.js';
import { createReplayRecording, replaySettings } from '../../../helpers/newspaper-replay.js';

/** Load a finished edition independently of editorial selection. */
async function issueFixture(): Promise<IssueDocument> {
  const issue = issueDocumentSchema.parse(JSON.parse(await readFile(new URL('../../../../newspaper/fixtures/steam-press-broadsheet-ordinary.json', import.meta.url), 'utf8')));
  issue.timelineId = 'run-a';
  issue.cutoff.turn = 10;
  return issue;
}

/** Build a run checkpoint with the current cutoff and optional article provenance. */
function checkpointAt(cutoffTurn: number | null = null, issue?: IssueDocument): ReplayCheckpoint {
  const publication = createInitialPublicationState();
  publication.lastCheckTurn = cutoffTurn;
  if (issue) publication.issues.push({ issueId: issue.issueId, turn: issue.cutoff.turn, designId: issue.publication.designId, items: issue.items.map(item => ({
    id: item.id, issueId: issue.issueId, turn: issue.cutoff.turn, tags: item.tags, seriesKeys: item.seriesKeys,
    templateIds: ['fixture'], triggerIds: ['controlled'], importance: 5, headline: item.headline, evidenceSummary: 'Recorded observations', sources: [], fingerprint: item.id,
  })) });
  return {
    session: replayStateSchema.parse({
      settings: replaySettings('source.db'), runId: 'run-a', outputPath: 'output.db', preferences: publication.preferences,
      speed: { multiplier: 1, source: 'assumedStandard', recordedName: null, label: 'Standard' },
      publicationIntervalTurns: 5, comparisonTurns: 5, cursor: { cutoffTurn, previousCheckTurn: 9, finished: false },
    }), publication,
  };
}

describe('offline replay output store', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let store: ReplayStore;
  let filename: string;
  beforeEach(async () => {
    recording = await createReplayRecording();
    filename = path.join(path.dirname(recording.filename), 'output.sqlite');
    store = new ReplayStore(filename);
  });
  afterEach(async () => { store.close(); await recording.cleanup(); });

  it('should roll back an edition when saving the cursor fails', async () => {
    const issue = await issueFixture();
    const checkpoint = checkpointAt(10, issue);
    const initial = checkpointAt();
    store.create('source', initial);
    const sqlite = new Database(filename);
    sqlite.exec("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON OfflineReplayRuns BEGIN SELECT RAISE(ABORT, 'save failed'); END");
    expect(() => store.commit(checkpoint, issue)).toThrow('save failed');
    expect(store.list('run-a', 0).issues).toEqual([]);
    expect(store.load('run-a', 0, 'source')).toEqual(initial);
    sqlite.exec('DROP TRIGGER fail_checkpoint');
    sqlite.close();
    store.commit(checkpoint, issue);
    expect(store.load('run-a', 0, 'source')).toEqual(checkpoint);
    expect(store.list('run-a', 0).issues).toHaveLength(1);
  });

  it('should reopen an immutable edition with its evidence and current votes', async () => {
    const issue = await issueFixture();
    const checkpoint = checkpointAt(10, issue);
    store.create('source', checkpointAt());
    store.commit(checkpoint, issue);
    const original = structuredClone(issue);
    issue.publication.title = 'Changed retry';
    expect(() => store.commit(checkpoint, issue)).toThrow(ReplayStoreConflictError);
    const itemId = issue.items[0].id;
    checkpoint.publication.votes[itemId] = 1;
    store.save(checkpoint);
    store.close();
    store = new ReplayStore(filename);
    expect(store.list('run-a', 0).issues).toHaveLength(1);
    const { publication } = store.load('run-a', 0, 'source');
    const reopened = store.get('run-a', 0, original.issueId, publication)!;
    expect(reopened.issue).toEqual(original);
    expect(reopened.votes[itemId]).toBe(1);
    expect(reopened.articles[0]).toMatchObject({ templateIds: ['fixture'], evidenceSummary: 'Recorded observations' });
    expect(() => store.load('run-a', 1, 'source')).toThrow();
    expect(() => store.load('run-a', 0, 'other-source')).toThrow();
    expect(store.get('other-run', 0, original.issueId, publication)).toBeUndefined();
  });

  it('should advance through quiet cutoffs without publishing or revisiting completed turns', () => {
    const first = checkpointAt(10);
    const second = checkpointAt(15);
    store.create('source', checkpointAt());
    store.commit(first);
    store.close();
    store = new ReplayStore(filename);
    expect(store.load('run-a', 0, 'source')).toEqual(first);
    store.commit(second);
    expect(() => store.commit(second)).toThrow(ReplayStoreConflictError);
    expect(() => store.commit(first)).toThrow(ReplayStoreConflictError);
    expect(store.load('run-a', 0, 'source')).toEqual(second);
    expect(store.list('run-a', 0).issues).toEqual([]);
  });

  it('should reject recording paths and existing hardlinks before opening writable SQLite', async () => {
    expect(() => resolveReplayOutput(recording.filename, recording.filename)).toThrow();
    const alias = path.join(path.dirname(recording.filename), 'source-alias.db');
    await link(recording.filename, alias);
    expect(() => resolveReplayOutput(recording.filename, alias)).toThrow();
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should refuse an unrelated database and an unsupported offline schema version', () => {
    const unrelatedPath = path.join(path.dirname(recording.filename), 'unrelated.sqlite');
    const unrelated = new Database(unrelatedPath);
    unrelated.exec('CREATE TABLE unrelated (value INTEGER)');
    unrelated.close();
    expect(() => new ReplayStore(unrelatedPath)).toThrow();
    const future = new Database(filename);
    future.pragma('user_version = 99');
    future.close();
    expect(() => new ReplayStore(filename)).toThrow();
  });

  it('should reject stale votes and roll back a competing check without losing the current checkpoint', async () => {
    const issue = await issueFixture();
    const checkpoint = checkpointAt(10, issue);
    store.create('source', checkpointAt());
    store.commit(checkpoint, issue);
    const competitor = new ReplayStore(filename);
    try {
      const stale = competitor.load('run-a', 0, 'source');
      const itemId = checkpoint.publication.issues[0].items[0].id;
      const otherItemId = checkpoint.publication.issues[0].items[1].id;
      checkpoint.publication.votes[itemId] = 1;
      store.save(checkpoint);
      stale.publication.votes[otherItemId] = -1;
      expect(() => competitor.save(stale)).toThrow(ReplayStoreConflictError);

      const future = structuredClone(stale);
      future.session.cursor = { cutoffTurn: 15, previousCheckTurn: 10, finished: false };
      future.publication.lastCheckTurn = 15;
      expect(() => competitor.commit(future)).toThrow(ReplayStoreConflictError);
      expect(store.load('run-a', 0, 'source')).toEqual(checkpoint);

      const refreshed = competitor.load('run-a', 0, 'source');
      refreshed.publication.preferences.llmEnabled = true;
      refreshed.publication.votes[otherItemId] = -1;
      competitor.save(refreshed);
      expect(store.load('run-a', 0, 'source').publication.votes[itemId]).toBe(1);
      expect(store.load('run-a', 0, 'source').publication.votes[otherItemId]).toBe(-1);
      expect(store.load('run-a', 0, 'source').publication.preferences.llmEnabled).toBe(true);
    } finally { competitor.close(); }
  });

  it('should retain the current schema and optimistic revision across reopening', () => {
    const checkpoint = checkpointAt();
    store.create('source', checkpoint);
    store.close();
    store = new ReplayStore(filename);
    const restored = store.load('run-a', 0, 'source');
    expect(restored).toEqual(checkpoint);
    restored.publication.preferences.llmEnabled = true;
    store.save(restored);
    const saved = new Database(filename, { readonly: true });
    expect(saved.pragma('user_version', { simple: true })).toBe(9);
    expect(saved.prepare('SELECT Revision FROM OfflineReplayRuns').get()).toEqual({ Revision: 1 });
    saved.close();
  });

  it('should reject older output without changing its saved run', () => {
    const checkpoint = checkpointAt();
    const originalPath = path.join(path.dirname(recording.filename), 'version-8.sqlite');
    const original = new ReplayStore(originalPath);
    original.create('source', checkpoint);
    original.close();
    const sqlite = new Database(originalPath);
    sqlite.pragma('user_version = 8');
    sqlite.close();
    expect(() => new ReplayStore(originalPath)).toThrow(/unsupported version/i);
    const retained = new Database(originalPath, { readonly: true });
    expect(retained.pragma('user_version', { simple: true })).toBe(8);
    expect(retained.prepare('SELECT RunID, SourceIdentity FROM OfflineReplayRuns').all())
      .toEqual([{ RunID: 'run-a', SourceIdentity: 'source' }]);
    retained.close();
    const fresh = new ReplayStore(path.join(path.dirname(recording.filename), 'fresh.sqlite'));
    try {
      fresh.create('source', checkpoint);
      expect(fresh.load('run-a', 0, 'source')).toEqual(checkpoint);
    } finally { fresh.close(); }
  });

  it('should reject a stale duplicate commit without changing the saved checkpoint', () => {
    const checkpoint = checkpointAt(10);
    store.create('source', checkpointAt());
    const competitor = new ReplayStore(filename);
    try {
      competitor.load('run-a', 0, 'source');
      store.commit(checkpoint);
      const unsaved = structuredClone(checkpoint);
      unsaved.publication.preferences.llmEnabled = true;
      expect(() => competitor.commit(unsaved)).toThrow(ReplayStoreConflictError);
      expect(store.load('run-a', 0, 'source')).toEqual(checkpoint);
    } finally { competitor.close(); }
  });
  it('should save coverage with each check and add its table to output saved before coverage existed', () => {
    store.create('source', checkpointAt());
    store.close();
    const older = new Database(filename);
    older.exec('DROP TABLE OfflineReplayCoverage');
    older.close();
    store = new ReplayStore(filename);
    store.load('run-a', 0, 'source');
    expect(store.coverage('run-a', 0)).toEqual([]);
    const coverage = (turn: number) => ({ turn, status: 'skipped' as const, printedFloor: null, rules: {}, templates: {}, candidates: [] });
    expect(() => store.commit(checkpointAt(10), undefined, coverage(9))).toThrow();
    store.commit(checkpointAt(10), undefined, coverage(10));
    store.commit(checkpointAt(15));
    expect(store.coverage('run-a', 0)).toEqual([coverage(10)]);
    expect(store.checkCoverage('run-a', 0, 10)).toEqual(coverage(10));
    expect(store.checkCoverage('run-a', 0, 15)).toBeUndefined();
    expect(store.coverage('run-a', 1)).toEqual([]);
  });

  it('should read a story saved as unpublished in a published check as one that found no slot', () => {
    store.create('source', checkpointAt());
    const candidate = { id: 'story', template: 'report', subject: 'city/1', rules: ['rule'], importance: 5, score: 5, outcome: 'unpublished' as const };
    store.commit(checkpointAt(10), undefined, { turn: 10, status: 'published', printedFloor: 9, rules: {}, templates: {}, candidates: [candidate] });
    expect(store.checkCoverage('run-a', 0, 10)!.candidates[0].outcome).toBe('unplaced');
  });
});
