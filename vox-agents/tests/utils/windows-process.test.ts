import { describe, expect, it, vi } from 'vitest';
import {
  findProcessByImageName,
  isProcessRunning,
  killProcess,
  type CommandRunner
} from '../../src/utils/game/windows-process.js';

describe.skipIf(process.platform !== 'win32')('Windows process utilities', () => {
  it('parses a matching tasklist CSV process ID', async () => {
    const runner: CommandRunner = async () => ({
      stdout: [
        '"Image Name","PID","Session Name","Session#","Mem Usage"',
        '"CivilizationV.exe","1234","Console","1","1,234 K"'
      ].join('\r\n')
    });

    await expect(findProcessByImageName('CivilizationV.exe', runner)).resolves.toBe(1234);
  });

  it('returns null when tasklist has no matching image', async () => {
    const runner: CommandRunner = async () => ({
      stdout: [
        '"Image Name","PID","Session Name","Session#","Mem Usage"',
        '"notepad.exe","99","Console","1","1,234 K"'
      ].join('\n')
    });

    await expect(findProcessByImageName('CivilizationV.exe', runner)).resolves.toBeNull();
  });

  it('detects a running PID', async () => {
    const runner: CommandRunner = async () => ({
      stdout: [
        '"Image Name","PID","Session Name","Session#","Mem Usage"',
        '"CivilizationV.exe","1234","Console","1","1,234 K"'
      ].join('\n')
    });

    await expect(isProcessRunning(1234, runner)).resolves.toBe(true);
  });

  it('returns false when PID lookup fails', async () => {
    const runner: CommandRunner = async () => {
      throw new Error('tasklist failed');
    };

    await expect(isProcessRunning(1234, runner)).resolves.toBe(false);
  });

  it('calls taskkill for the requested PID', async () => {
    const runner = vi.fn<CommandRunner>(async () => ({ stdout: '' }));

    await killProcess(1234, runner);

    expect(runner).toHaveBeenCalledWith('taskkill /F /PID 1234');
  });
});
