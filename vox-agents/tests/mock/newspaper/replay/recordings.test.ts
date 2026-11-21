import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { latestRecording } from '../../../../src/newspaper/replay/recordings.js';

describe('archived recording suggestion', () => {
  it('should choose the newest archived knowledge database across experiments', async () => {
    const archive = await mkdtemp(join(tmpdir(), 'vd-newspaper-archive-'));
    try {
      const experiment = join(archive, 'self-play');
      const latest = join(experiment, 'new-game_1794782175768.db');
      const old = join(archive, 'old-game_1794756822470.db');
      await mkdir(experiment);
      await Promise.all([
        writeFile(latest, ''),
        writeFile(old, ''),
        writeFile(join(experiment, 'new-game-player-7.db'), ''),
        writeFile(join(experiment, 'other-game_1794999999999.Civ5Save'), ''),
      ]);
      await utimes(latest, 0, 0);
      expect(await latestRecording(archive)).toBe(latest);
    } finally {
      await rm(archive, { recursive: true, force: true });
    }
  });

  it('should leave the suggestion empty when the archive does not exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vd-newspaper-archive-'));
    try {
      expect(await latestRecording(join(directory, 'archive'))).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
