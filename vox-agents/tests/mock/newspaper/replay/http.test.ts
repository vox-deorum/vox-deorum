import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { startNewspaperHost } from '../../../../src/newspaper/export/http.js';
import { mountReplayRoutes } from '../../../../src/newspaper/replay/http.js';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import { replayEvidenceResponseSchema, replayStateSchema } from '../../../../src/newspaper/contracts/replay.js';
import { createReplayRecording, replaySettings } from '../../../helpers/newspaper-replay.js';

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
});
