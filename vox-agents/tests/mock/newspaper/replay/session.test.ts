import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { queryNewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/queries.js';
import { openReadonlyGameDb } from '../../../../src/knowledge/database.js';
import { openReplayDatabase } from '../../../../src/newspaper/replay/database.js';
import { ReplaySession, ReplaySessionError } from '../../../../src/newspaper/replay/session.js';
import { createReplayRecording, replaySettings as sourceSettings } from '../../../helpers/newspaper-replay.js';
import { deferred } from '../../../helpers/deferred.js';

/** Keep legacy evidence-only lifecycle checks independent of the publication output store. */
function replaySettings(databasePath: string) { return { ...sourceSettings(databasePath), publicationEnabled: false }; }

describe('replay session', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let session: ReplaySession;
  beforeEach(async () => {
    recording = await createReplayRecording();
    session = new ReplaySession();
  });
  afterEach(async () => {
    await session.close();
    vi.restoreAllMocks();
    await recording.cleanup();
  });

  it('should discard session state when destroying the previous source fails during replacement', async () => {
    const first = await openReplayDatabase(recording.filename);
    const next = await openReplayDatabase(recording.filename);
    const open = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next).mockImplementation(openReplayDatabase);
    session = new ReplaySession({ open });
    await session.configure(replaySettings(recording.filename));
    const originalDestroy = first.destroy.bind(first);
    const destroyFirst = vi.spyOn(first, 'destroy').mockImplementationOnce(async () => {
      await originalDestroy();
      throw new Error('close failed');
    });
    const destroyNext = vi.spyOn(next, 'destroy');
    await expect(session.configure(replaySettings(recording.filename))).rejects.toThrow('close failed');
    expect(destroyNext).toHaveBeenCalledOnce();
    await expect(session.getState()).rejects.toMatchObject({ status: 409 });
    await expect(session.evidence()).rejects.toMatchObject({ status: 409 });
    await session.configure(replaySettings(recording.filename));
    expect((await session.advance()).evidence.request.cutoffTurn).toBe(10);
    expect(destroyFirst).toHaveBeenCalledOnce();
  });

  it('should inspect without advancing and use the same MCP query including decoded JSON and source references', async () => {
    await session.configure(replaySettings(recording.filename));
    const preview = await session.evidence();
    expect(preview.session.cursor.cutoffTurn).toBeNull();
    const result = await session.advance();
    const db = openReadonlyGameDb(recording.filename)!;
    try {
      expect(result.evidence).toEqual(await queryNewspaperEvidence(db, result.evidence.request));
      expect(preview.evidence).toEqual(result.evidence);
    } finally { await db.destroy(); }
    expect(result.evidence.players[0]).toMatchObject({ source: { id: 3, turn: 10, createdAt: 1010 }, values: {
      Gold: 20, FoundedReligion: null, PolicyBranches: { Tradition: ['A', 'B'] },
      OutgoingTradeRoutes: { 'Home => Port (Civ1)': { FromGold: 0, ToFood: -1 } },
    } });
    expect(result.evidence.cities[0].values.Wonders).toEqual(['Beacon']);
    expect(result.evidence.events[0].values.HasTech).toBe(false);
    expect(result.evidence.players.some(player => player.subjectID === 5)).toBe(false);
    await session.close();
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should serialize concurrent advances without skipping windows and stop exactly at the range end', async () => {
    await session.configure(replaySettings(recording.filename));
    const results = await Promise.all([session.advance(), session.advance(), session.advance()]);
    expect(results.map(result => result.evidence.request.cutoffTurn)).toEqual([10, 15, 18]);
    expect(results.map(result => result.evidence.request.previousCheckTurn)).toEqual([9, 10, 15]);
    expect(results[1].evidence.events.map(event => event.source.id)).toEqual([103]);
    expect((await session.getState()).cursor.finished).toBe(true);
    await expect(session.advance()).rejects.toMatchObject({ status: 409 });
    expect((await session.evidence()).evidence).toEqual(results[2].evidence);
  });

  it('should convert standard-pace durations once using recorded speed and leave recorded durations unchanged', async () => {
    const settings = { ...replaySettings(recording.filename), toTurn: 40, durationUnit: 'standardTurns', publicationInterval: 5, comparisonTurns: 4 };
    const state = await session.configure(settings);
    expect(state).toMatchObject({ publicationIntervalTurns: 8, comparisonTurns: 6, speed: { multiplier: 1.5, source: 'recorded' } });
    await session.advance();
    expect((await session.advance()).evidence.request).toMatchObject({ cutoffTurn: 18, comparisonRange: { fromTurn: 12, toTurn: 18 } });
    expect((await session.advance()).evidence.request.cutoffTurn).toBe(26);
    expect((await session.configure({ ...settings, durationUnit: 'recordedTurns' })).publicationIntervalTurns).toBe(5);
  });

  it.each([
    { name: '보통', override: 2, source: 'override', multiplier: 2, interval: 10 },
    { name: '보통', override: undefined, source: 'assumedStandard', multiplier: 1, interval: 5 },
    { name: null, override: undefined, source: 'assumedStandard', multiplier: 1, interval: 5 },
  ])('should record pace source $source for unrecognized or missing metadata $name', async ({ name, override, source, multiplier, interval }) => {
    const sqlite = new Database(recording.filename);
    sqlite.prepare('DELETE FROM GameMetadata WHERE Key = ?').run('gameSpeed');
    if (name !== null) sqlite.prepare('INSERT INTO GameMetadata VALUES (?, ?)').run('gameSpeed', name);
    sqlite.close();
    const state = await session.configure({
      ...replaySettings(recording.filename), durationUnit: 'standardTurns', speedMultiplierOverride: override,
    });
    expect(state.speed).toMatchObject({ source, multiplier, recordedName: name });
    expect(state.publicationIntervalTurns).toBe(interval);
    expect((await session.advance()).session.speed).toEqual(state.speed);
  });

  it('should close a configured source before any evidence read and close only once', async () => {
    const close = vi.spyOn(Database.prototype, 'close');
    await session.configure(replaySettings(recording.filename));
    await Promise.all([session.close(), session.close()]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('should close a source whose metadata read fails and leave the session unconfigured', async () => {
    const sqlite = new Database(recording.filename);
    sqlite.exec('DROP TABLE GameMetadata');
    sqlite.close();
    const close = vi.spyOn(Database.prototype, 'close');
    await expect(session.configure(replaySettings(recording.filename))).rejects.toBeInstanceOf(ReplaySessionError);
    expect(close).toHaveBeenCalledOnce();
    await expect(session.getState()).rejects.toMatchObject({ status: 409 });
  });

  it('should turn opener failure into a session error and allow a later configuration', async () => {
    await expect(session.configure(replaySettings(`${recording.filename}.missing`))).rejects.toBeInstanceOf(ReplaySessionError);
    await expect(session.configure(replaySettings(recording.filename))).resolves.toMatchObject({ cursor: { cutoffTurn: null } });
  });

  it('should keep the old source on invalid settings or failed replacement and detach returned settings', async () => {
    const state = await session.configure(replaySettings(recording.filename));
    state.settings.receiverPlayerID = 1;
    state.cursor.cutoffTurn = 100;
    await expect(session.configure({ ...replaySettings(recording.filename), publicationInterval: 0 })).rejects.toThrow();
    await expect(session.configure(replaySettings(`${recording.filename}.missing`))).rejects.toThrow();
    expect((await session.advance()).evidence.request).toMatchObject({ receiverPlayerID: 0, cutoffTurn: 10 });
  });

  it('should leave the cursor unchanged after a failed read, retry it, and release the source on close', async () => {
    const query = vi.fn<typeof queryNewspaperEvidence>().mockRejectedValueOnce(new Error('read failed')).mockImplementation(queryNewspaperEvidence);
    session = new ReplaySession({ query });
    const close = vi.spyOn(Database.prototype, 'close');
    await session.configure(replaySettings(recording.filename));
    await expect(session.advance()).rejects.toThrow('read failed');
    expect((await session.getState()).cursor.cutoffTurn).toBeNull();
    expect((await session.advance()).evidence.request.cutoffTurn).toBe(10);
    await session.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('should drain accepted reads and queued advances before destroying the connection during shutdown', async () => {
    const entered = deferred();
    const release = deferred();
    const query = vi.fn<typeof queryNewspaperEvidence>().mockImplementation(async (db, input) => {
      entered.resolve();
      await release.promise;
      return queryNewspaperEvidence(db, input);
    });
    const db = await openReplayDatabase(recording.filename);
    const destroy = vi.spyOn(db, 'destroy');
    session = new ReplaySession({ open: async () => db, query });
    await session.configure(replaySettings(recording.filename));
    const first = session.advance();
    const second = session.advance();
    await entered.promise;
    const closing = session.close();
    await expect(session.evidence()).rejects.toMatchObject({ status: 503 });
    await expect(session.configure(replaySettings(recording.filename))).rejects.toMatchObject({ status: 503 });
    expect(destroy).not.toHaveBeenCalled();
    release.resolve();
    expect((await first).evidence.request.cutoffTurn).toBe(10);
    expect((await second).evidence.request.cutoffTurn).toBe(15);
    await closing;
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('should drain an accepted configuration before shutdown and reject work on an empty closed session', async () => {
    const close = vi.spyOn(Database.prototype, 'close');
    const configuring = session.configure(replaySettings(recording.filename));
    const closing = session.close();
    await configuring;
    await closing;
    expect(close).toHaveBeenCalledOnce();
    await expect(session.getState()).rejects.toMatchObject({ status: 503 });
  });

  it('should still release the connection when a pending read fails during shutdown', async () => {
    const entered = deferred();
    const release = deferred();
    session = new ReplaySession({ query: async () => {
      entered.resolve();
      await release.promise;
      throw new Error('read failed');
    } });
    const close = vi.spyOn(Database.prototype, 'close');
    await session.configure(replaySettings(recording.filename));
    const result = expect(session.advance()).rejects.toThrow('read failed');
    await entered.promise;
    const closing = session.close();
    expect(close).not.toHaveBeenCalled();
    release.resolve();
    await result;
    await closing;
    expect(close).toHaveBeenCalledOnce();
  });

  it('should serialize replacement after an accepted read and reset its cursor before the next check', async () => {
    await session.configure(replaySettings(recording.filename));
    const first = session.advance();
    const configuring = session.configure({ ...replaySettings(recording.filename), fromTurn: 12 });
    const next = session.advance();
    expect((await first).evidence.request.cutoffTurn).toBe(10);
    expect((await configuring).cursor.cutoffTurn).toBeNull();
    expect((await next).evidence.request).toMatchObject({ cutoffTurn: 12, previousCheckTurn: 11 });
  });
});
