import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFile, link } from 'node:fs/promises';
import path from 'node:path';
import { ReplayStore, ReplayStoreConflictError, resolveReplayOutput, type ReplayCheckpoint, type StoredReplayCheck } from '../../../../src/newspaper/replay/store.js';
import { replayStateSchema } from '../../../../src/newspaper/contracts/replay.js';
import { issueDocumentSchema } from '../../../../src/newspaper/contracts/issue.js';
import { createInitialPublicationState, type EditorialDecisionRecord } from '../../../../src/newspaper/contracts/publication.js';
import { createReplayRecording, replaySettings } from '../../../helpers/newspaper-replay.js';

/** Build one valid audited check with optional fixture prose, independently of editorial selection. */
async function checkFixture(published = true): Promise<{ checkpoint: ReplayCheckpoint; check: StoredReplayCheck }> {
  const issue = issueDocumentSchema.parse(JSON.parse(await readFile(new URL('../../../../newspaper/fixtures/victorian-ordinary.json', import.meta.url), 'utf8')));
  issue.timelineId = 'run-a';
  issue.cutoff.turn = 10;
  const decision: EditorialDecisionRecord = {
    checkId: 'check-10', cutoffTurn: 10, configurationId: 'test', configurationSnapshot: {}, seed: 'test', editor: 'heuristic',
    status: published ? 'published' : 'skipped', candidateScores: [], merges: [], selectedVariants: {}, designId: published ? issue.publication.designId : null,
    layouts: {}, evidence: [], diplomacyInference: [], triggerAudit: [], evidenceRequest: { cutoffTurn: 10, previousCheckTurn: 9, receiverPlayerID: 0 }, feedback: { revision: 'empty', windowItemIds: [], votes: {}, tagCounts: {}, seriesAdjustments: {}, tagAdjustments: {}, coefficients: { series: 2, tag: 1, bound: 5, window: 50 } },
  };
  const publication = createInitialPublicationState();
  publication.lastCheckTurn = 10;
  if (published) publication.issues.push({ issueId: issue.issueId, turn: 10, items: issue.items.map(item => ({
    id: item.id, issueId: issue.issueId, turn: 10, tags: item.tags, seriesKeys: item.seriesKeys,
    templateIds: ['fixture'], triggerIds: ['controlled'], importance: 5, headline: item.headline, evidenceSummary: 'Recorded observations', sources: [], fingerprint: item.id,
  })) });
  return {
    checkpoint: { session: replayStateSchema.parse({
      settings: replaySettings('source.db'), runId: 'run-a', outputPath: 'output.db', preferences: publication.preferences,
      speed: { multiplier: 1, source: 'assumedStandard', recordedName: null, label: 'Standard' },
      publicationIntervalTurns: 5, comparisonTurns: 5, cursor: { cutoffTurn: 10, previousCheckTurn: 9, finished: false },
    }), publication },
    check: { status: published ? 'published' : 'skipped', decision, ...(published ? { issue } : { reason: 'No developments' }) },
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

  it('should roll back content and check identity when saving the cursor fails', async () => {
    const { checkpoint, check } = await checkFixture();
    const initial = structuredClone(checkpoint);
    initial.session.cursor.cutoffTurn = null;
    initial.publication = createInitialPublicationState();
    store.create('source', initial);
    const sqlite = new Database(filename);
    sqlite.exec("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON OfflineReplayRuns BEGIN SELECT RAISE(ABORT, 'save failed'); END");
    expect(() => store.commit(checkpoint, check)).toThrow('save failed');
    expect(store.list('run-a', 0).issues).toEqual([]);
    expect(store.getCheck('run-a', 0, 10)).toBeUndefined();
    expect(store.load('run-a', 0, 'source')).toEqual(initial);
    sqlite.exec('DROP TRIGGER fail_checkpoint');
    sqlite.close();
    store.commit(checkpoint, check);
    expect(store.load('run-a', 0, 'source')).toEqual(checkpoint);
    expect(store.list('run-a', 0).issues).toHaveLength(1);
  });

  it('should retain immutable issues and evidence across restart and commit a cutoff once', async () => {
    const { checkpoint, check } = await checkFixture();
    store.create('source', checkpoint);
    store.commit(checkpoint, check);
    const original = store.get('run-a', 0, check.issue!.issueId, checkpoint.publication)!;
    check.issue!.publication.title = 'Changed retry';
    expect(store.commit(checkpoint, check).issue!.publication.title).toBe(original.issue.publication.title);
    store.close();
    store = new ReplayStore(filename);
    expect(store.list('run-a', 0).issues).toHaveLength(1);
    expect(store.get('run-a', 0, original.issue.issueId, checkpoint.publication)).toEqual(original);
    expect(() => store.load('run-a', 1, 'source')).toThrow();
    expect(() => store.load('run-a', 0, 'other-source')).toThrow();
    expect(store.get('other-run', 0, original.issue.issueId, checkpoint.publication)).toBeUndefined();
    const sqlite = new Database(filename, { readonly: true });
    const row = sqlite.prepare('SELECT Evidence FROM OfflineReplayIssues').get() as { Evidence: string };
    expect(JSON.parse(row.Evidence).items[0]).toMatchObject({ templateIds: ['fixture'], evidenceSummary: 'Recorded observations' });
    sqlite.close();
  });

  it('should durably complete quiet checks without adding an issue', async () => {
    const { checkpoint, check } = await checkFixture(false);
    store.create('source', checkpoint);
    store.commit(checkpoint, check);
    expect(store.load('run-a', 0, 'source').publication.lastCheckTurn).toBe(10);
    expect(store.getCheck('run-a', 0, 10)?.status).toBe('skipped');
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
    const futurePath = path.join(path.dirname(recording.filename), 'future.sqlite');
    const future = new Database(futurePath);
    future.pragma('user_version = 99');
    future.close();
    expect(() => new ReplayStore(futurePath)).toThrow();
  });

  it('should reject stale votes and roll back a competing check without losing the current checkpoint', async () => {
    const { checkpoint, check } = await checkFixture();
    store.create('source', checkpoint);
    store.commit(checkpoint, check);
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
      const decision = { ...check.decision, cutoffTurn: 15, checkId: 'check-15', status: 'skipped' as const };
      expect(() => competitor.commit(future, { status: 'skipped', decision, reason: 'Quiet' })).toThrow(ReplayStoreConflictError);
      expect(store.getCheck('run-a', 0, 15)).toBeUndefined();
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

  it('should retain the current schema and optimistic revision across reopening', async () => {
    const { checkpoint } = await checkFixture(false);
    store.create('source', checkpoint);
    store.close();
    store = new ReplayStore(filename);
    const restored = store.load('run-a', 0, 'source');
    expect(restored).toEqual(checkpoint);
    restored.publication.preferences.llmEnabled = true;
    store.save(restored);
    const saved = new Database(filename, { readonly: true });
    expect(saved.pragma('user_version', { simple: true })).toBe(4);
    expect(saved.prepare('SELECT Revision FROM OfflineReplayRuns').get()).toEqual({ Revision: 1 });
    saved.close();
  });

  it.each([1, 3])('should reject version %s output without modifying it', async version => {
    const { checkpoint } = await checkFixture(false);
    const originalPath = path.join(path.dirname(recording.filename), `version-${version}.sqlite`);
    const original = new ReplayStore(originalPath);
    original.create('source', checkpoint);
    original.close();
    const sqlite = new Database(originalPath);
    if (version === 1) sqlite.exec('ALTER TABLE OfflineReplayRuns DROP COLUMN Revision');
    sqlite.pragma(`user_version = ${version}`);
    sqlite.close();
    const bytes = await readFile(originalPath);
    expect(() => new ReplayStore(originalPath)).toThrow(/new output path/i);
    expect(await readFile(originalPath)).toEqual(bytes);
  });

  it('should reject a stale duplicate commit while accepting a duplicate from the current writer', async () => {
    const { checkpoint, check } = await checkFixture(false);
    const initial = structuredClone(checkpoint);
    initial.session.cursor.cutoffTurn = null;
    initial.publication.lastCheckTurn = null;
    store.create('source', initial);
    const competitor = new ReplayStore(filename);
    try {
      competitor.load('run-a', 0, 'source');
      expect(competitor.getCheck('run-a', 0, 10)).toBeUndefined();
      store.commit(checkpoint, check);
      const unsaved = structuredClone(checkpoint);
      unsaved.publication.preferences.llmEnabled = true;
      expect(() => competitor.commit(unsaved, check)).toThrow(ReplayStoreConflictError);
      expect(store.commit(checkpoint, check)).toEqual(check);
      expect(store.load('run-a', 0, 'source')).toEqual(checkpoint);
      expect(store.getCheck('run-a', 0, 10)).toEqual(check);
    } finally { competitor.close(); }
  });
});
