import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import { queryNewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/queries.js';
import { deferred } from '../../../helpers/deferred.js';
import { startNewspaperHost } from '../../../../src/newspaper/export/http.js';
import { mountReplayRoutes } from '../../../../src/newspaper/replay/http.js';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import { replayAdvanceSummaryResponseSchema, replayEvidenceResponseSchema, replayStateSchema } from '../../../../src/newspaper/contracts/replay.js';
import { createReplayRecording, replaySettings as sourceSettings, writeReplayPublicationCatalogue } from '../../../helpers/newspaper-replay.js';

/** Keep evidence-only lifecycle checks independent of the publication output store. */
function replaySettings(databasePath: string) { return { ...sourceSettings(databasePath), publicationEnabled: false }; }

describe('replay HTTP routes', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let session: ReplaySession;
  let host: Awaited<ReturnType<typeof startNewspaperHost>>;
  beforeEach(async () => {
    recording = await createReplayRecording();
    session = new ReplaySession();
    host = await startNewspaperHost({
      /** Exercise the same application injection used by the normal VD server. */
      mountApplicationRoutes: app => mountReplayRoutes(app, () => session),
    });
  });
  afterEach(async () => {
    await session.close();
    await host.close();
    await recording.cleanup();
  });

  it('should parse settings before the host fallback and return contracted session and evidence responses', async () => {
    await request(host.app).get('/api/newspaper/replay').expect(409);
    const configured = await request(host.app).put('/api/newspaper/replay').send(replaySettings(recording.filename)).expect(200);
    expect(replayStateSchema.parse(configured.body).cursor.cutoffTurn).toBeNull();
    const preview = await request(host.app).post('/api/newspaper/replay/evidence').expect(200);
    expect(replayEvidenceResponseSchema.parse(preview.body).session.cursor.cutoffTurn).toBeNull();
    const advanced = await request(host.app).post('/api/newspaper/replay/advance').send({}).expect(200);
    expect(replayEvidenceResponseSchema.parse(advanced.body).session.cursor.cutoffTurn).toBe(10);
    expect(advanced.body.evidence).toEqual(preview.body.evidence);
    const status = await request(host.app).get('/api/newspaper/replay').expect(200);
    expect(status.body).toEqual(advanced.body.session);
    await request(host.app).post('/api/newspaper/replay/unknown').expect(404);
  });

  it('should reject malformed JSON, oversized bodies, invalid settings and unavailable files as JSON errors', async () => {
    const configure = vi.spyOn(session, 'configure');
    const malformed = await request(host.app).put('/api/newspaper/replay').set('Content-Type', 'application/json').send('{invalid').expect(400);
    expect(malformed.body.error).toEqual(expect.any(String));
    await request(host.app).put('/api/newspaper/replay').send({ path: 'a'.repeat(65 * 1024) }).expect(413);
    expect(configure).not.toHaveBeenCalled();
    const invalid = await request(host.app).put('/api/newspaper/replay').send({}).expect(400);
    expect(invalid.body.error).toEqual(expect.any(String));
    await request(host.app).put('/api/newspaper/replay').send(replaySettings(`${recording.filename}.missing`)).expect(400);
  });

  it('should return a compact advance with no check for evidence-only sessions', async () => {
    await request(host.app).put('/api/newspaper/replay').send(replaySettings(recording.filename)).expect(200);
    const advanced = await request(host.app).post('/api/newspaper/replay/advance?view=summary').send({}).expect(200);
    const summary = replayAdvanceSummaryResponseSchema.parse(advanced.body);
    expect(summary.session.cursor.cutoffTurn).toBe(10);
    expect(advanced.body).toEqual({ session: summary.session });
  });

  it('should return compact published and skipped outcomes while retaining the archived decision', async () => {
    const scope = { runId: 'summary-run', receiverPlayerID: 0 };
    await request(host.app).put('/api/newspaper/replay').send({
      ...sourceSettings(recording.filename), fromTurn: 6, toTurn: 30, ...scope,
      editorialConfigDirectory: await writeReplayPublicationCatalogue(recording.filename),
      outputPath: path.join(path.dirname(recording.filename), 'summary-output.sqlite'),
    }).expect(200);
    const published = await request(host.app).post('/api/newspaper/replay/advance?view=summary').send(scope).expect(200);
    const summary = replayAdvanceSummaryResponseSchema.parse(published.body);
    const issueId = summary.check?.issueId;
    expect(issueId).toEqual(expect.any(String));
    expect(published.body).toEqual({ session: summary.session, check: { status: 'published', issueId } });
    const detail = await request(host.app).get(`/api/newspaper/replay/issues/${encodeURIComponent(issueId!)}`).query(scope).expect(200);
    expect(detail.body.issue.issueId).toBe(issueId);
    expect(detail.body.decision.status).toBe('published');
    const skipped = await request(host.app).post('/api/newspaper/replay/advance?view=summary').send(scope).expect(200);
    expect(skipped.body).toEqual({
      session: replayAdvanceSummaryResponseSchema.parse(skipped.body).session,
      check: { status: 'skipped', reason: expect.any(String) },
    });
  });

  it('should reject external origins before parsing or calling the session', async () => {
    const configure = vi.spyOn(session, 'configure');
    await request(host.app).put('/api/newspaper/replay').set('Host', 'attacker.test').set('Content-Type', 'application/json').send('{invalid').expect(403);
    await request(host.app).put('/api/newspaper/replay').set('Origin', 'https://attacker.test').send({}).expect(403);
    expect(configure).not.toHaveBeenCalled();
  });

  it('should report exhausted cursors and reject requests as soon as session shutdown starts', async () => {
    await request(host.app).put('/api/newspaper/replay').send({ ...replaySettings(recording.filename), toTurn: 10 }).expect(200);
    await request(host.app).post('/api/newspaper/replay/advance').expect(200);
    await request(host.app).post('/api/newspaper/replay/advance').expect(409);
    await session.close();
    await request(host.app).post('/api/newspaper/replay/evidence').expect(503);
    await request(host.app).put('/api/newspaper/replay').send(replaySettings(recording.filename)).expect(503);
  });

  it('should resolve the current session after the server replaces it on restart', async () => {
    await session.close();
    session = new ReplaySession();
    await request(host.app).put('/api/newspaper/replay').send(replaySettings(recording.filename)).expect(200);
    await request(host.app).post('/api/newspaper/replay/advance').expect(200);
  });

  it('should publish, reopen and vote within the configured archive scope', async () => {
    const scope = { runId: 'http-run', receiverPlayerID: 0 };
    await request(host.app).put('/api/newspaper/replay').send({
      ...sourceSettings(recording.filename), fromTurn: 6, toTurn: 30, ...scope,
      editorialConfigDirectory: await writeReplayPublicationCatalogue(recording.filename),
      outputPath: path.join(path.dirname(recording.filename), 'http-output.sqlite'),
    }).expect(200);
    await request(host.app).post('/api/newspaper/replay/advance').send({}).expect(400);
    const advanced = await request(host.app).post('/api/newspaper/replay/advance').send(scope).expect(200);
    expect(advanced.body.check.status).toBe('published');
    const issueId = advanced.body.check.issue.issueId;
    const itemId = advanced.body.check.issue.items[0].id;
    const list = await request(host.app).get('/api/newspaper/replay/issues').query(scope).expect(200);
    expect(list.body.issues.map((issue: { issueId: string }) => issue.issueId)).toEqual([issueId]);
    await request(host.app).put('/api/newspaper/replay/votes').send({ ...scope, itemId, value: 1 }).expect(200);
    const reopened = await request(host.app).get(`/api/newspaper/replay/issues/${encodeURIComponent(issueId)}`).query(scope).expect(200);
    expect(reopened.body.votes[itemId]).toBe(1);
    await request(host.app).get('/api/newspaper/replay/issues').query({ ...scope, receiverPlayerID: 'bad' }).expect(400);
    await request(host.app).post('/api/newspaper/replay/advance').send({ ...scope, runId: 'stale' }).expect(409);
    await request(host.app).put('/api/newspaper/replay/preferences').send({ ...scope, frequencyStandardTurns: 2, llmEnabled: true }).expect(200);
    await request(host.app).put('/api/newspaper/replay/votes').send({ itemId, value: 1 }).expect(400);
  });

  it('should validate required advance scope inside the queue after a publication configuration', async () => {
    await session.close();
    const entered = deferred();
    const release = deferred();
    session = new ReplaySession({ query: async (db, input) => {
      entered.resolve();
      await release.promise;
      return queryNewspaperEvidence(db, input);
    } });
    await session.configure(replaySettings(recording.filename));
    const reading = session.evidence();
    await entered.promise;
    const configuring = session.configure({
      ...sourceSettings(recording.filename), fromTurn: 6, runId: 'queued-publication',
      outputPath: path.join(path.dirname(recording.filename), 'queued.sqlite'),
    });
    const advance = session.advance.bind(session);
    const getState = vi.spyOn(session, 'getState');
    const accepted = deferred();
    vi.spyOn(session, 'advance').mockImplementation((scope, requireScope) => {
      const result = advance(scope, requireScope);
      accepted.resolve();
      return result;
    });
    const unscoped = request(host.app).post('/api/newspaper/replay/advance').send({}).then(response => response);
    await accepted.promise;
    release.resolve();
    await reading;
    await configuring;
    expect((await unscoped).status).toBe(400);
    expect(getState).not.toHaveBeenCalled();
    expect((await session.getState()).cursor.cutoffTurn).toBeNull();
    await request(host.app).post('/api/newspaper/replay/advance').send({ runId: 'old-run', receiverPlayerID: 0 }).expect(409);
    await request(host.app).post('/api/newspaper/replay/advance').send({ runId: 'queued-publication', receiverPlayerID: 0 }).expect(200);
  });

  it('should return a conflict and preserve the active run when its ID is reused', async () => {
    const settings = {
      ...sourceSettings(recording.filename), runId: 'existing-http',
      outputPath: path.join(path.dirname(recording.filename), 'existing.sqlite'),
    };
    const configured = await request(host.app).put('/api/newspaper/replay').send(settings).expect(200);
    await request(host.app).put('/api/newspaper/replay').send(settings).expect(409);
    const current = await request(host.app).get('/api/newspaper/replay').expect(200);
    expect(current.body).toEqual(configured.body);
    const resumed = await request(host.app).put('/api/newspaper/replay').send({ ...settings, mode: 'resume' }).expect(200);
    expect(resumed.body).toEqual(configured.body);
  });
});
