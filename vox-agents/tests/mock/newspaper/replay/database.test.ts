import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'kysely';
import { openReplayDatabase } from '../../../../src/newspaper/replay/database.js';
import { createReplayRecording } from '../../../helpers/newspaper-replay.js';

describe('replay read-only database', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let db: Awaited<ReturnType<typeof openReplayDatabase>> | undefined;
  beforeEach(async () => { recording = await createReplayRecording(); });
  afterEach(async () => {
    await db?.destroy();
    vi.restoreAllMocks();
    await recording.cleanup();
  });

  it('should close an unused source without executing SQL or setting up a schema', async () => {
    const close = vi.spyOn(Database.prototype, 'close');
    const prepare = vi.spyOn(Database.prototype, 'prepare');
    db = await openReplayDatabase(recording.filename);
    await db.destroy();
    expect(prepare).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should decode JSON, reject writes, and close after use without altering source bytes or schema', async () => {
    const close = vi.spyOn(Database.prototype, 'close');
    db = await openReplayDatabase(recording.filename);
    const row = await db.selectFrom('PlayerSummaries').selectAll().where('ID', '=', 3).executeTakeFirstOrThrow();
    expect(row.OutgoingTradeRoutes).toEqual({ 'Home => Port (Civ1)': { FromGold: 0, ToFood: -1 } });
    await expect(sql`CREATE TABLE unwanted (id INTEGER)`.execute(db)).rejects.toThrow();
    await expect(sql`UPDATE PlayerSummaries SET Gold = 7`.execute(db)).rejects.toThrow();
    expect((await sql`SELECT sql FROM sqlite_master ORDER BY name`.execute(db)).rows).toEqual(recording.schema);
    await db.destroy();
    expect(close).toHaveBeenCalledOnce();
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should fail opening a missing source without creating a database', async () => {
    const filename = path.join(path.dirname(recording.filename), 'missing.db');
    await expect(openReplayDatabase(filename)).rejects.toThrow();
    await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
