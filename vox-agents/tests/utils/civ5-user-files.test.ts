import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { getCiv5UserFilePath } from '../../src/utils/game/civ5-user-files.js';

describe.skipIf(process.platform !== 'win32')('Civ5 user file paths', () => {
  it('uses the OS Documents path when it can be resolved', async () => {
    const path = await getCiv5UserFilePath('config.ini', async () => 'D:\\Documents');

    expect(path).toBe(join('D:\\Documents', 'My Games', "Sid Meier's Civilization 5", 'config.ini'));
  });

  it('falls back to the home Documents path when lookup fails', async () => {
    const path = await getCiv5UserFilePath('UserSettings.ini', async () => {
      throw new Error('documents lookup failed');
    });

    expect(path).toBe(join(homedir(), 'Documents', 'My Games', "Sid Meier's Civilization 5", 'UserSettings.ini'));
  });
});
