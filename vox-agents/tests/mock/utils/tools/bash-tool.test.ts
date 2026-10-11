/** Tests for the workspace bash tool and its registration on VoxContext (src/utils/tools/bash-tool.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VoxContext } from '../../../../src/infra/vox-context.js';
import type { AgentParameters } from '../../../../src/infra/vox-agent.js';
import { config } from '../../../../src/utils/config.js';
import { bashToolName } from '../../../../src/utils/tools/bash-tool.js';
import { workspaceNodeSupported } from '../../../../src/utils/workspace/player-workspace.js';
import { WorkspaceStore } from '../../../../src/utils/workspace/workspace-store.js';

const files = { game: 'write' as const, shared: {}, quota: 20 };

describe('bash tool', () => {
  let telemetryDir: string;
  let savedTelemetryDir: string;
  const stores: WorkspaceStore[] = [];

  /** Open a seat store in the test folder. */
  function openStore(name: string): WorkspaceStore {
    const store = WorkspaceStore.open(path.join(telemetryDir, `${name}.db`));
    stores.push(store);
    return store;
  }

  beforeEach(() => {
    savedTelemetryDir = config.telemetryDir;
    telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-bash-tool-'));
    config.telemetryDir = telemetryDir;
  });

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    config.telemetryDir = savedTelemetryDir;
    fs.rmSync(telemetryDir, { recursive: true, force: true });
  });

  it('should be registered only on contexts with files on', () => {
    const plain = new VoxContext<AgentParameters>({}, 'bash-off');
    plain.registerAgentTools();
    expect(plain.tools[bashToolName]).toBeUndefined();
    expect(plain.workspace('g1', 0)).toBeUndefined();

    const seat = new VoxContext<AgentParameters>({}, 'bash-on');
    seat.files = files;
    seat.registerAgentTools();
    expect(seat.tools[bashToolName]).toBeDefined();
  });

  it('should describe the same shell for every files setting and leave folders to the records directions', () => {
    const descriptions = (['write', 'read', false] as const).map((game) => {
      const seat = new VoxContext<AgentParameters>({}, `bash-description-${game}`);
      seat.files = { ...files, game, shared: game ? { lessons: game } : {} };
      seat.registerAgentTools();
      return (seat.tools[bashToolName] as any).description as string;
    });
    expect(new Set(descriptions).size).toBe(1);
    expect(descriptions[0]).not.toContain('/workspace/game');
    expect(descriptions[0]).not.toContain('lessons');
  });

  it('should share one workspace per player across calls over the attached store', () => {
    const seat = new VoxContext<AgentParameters>({}, 'bash-share');
    seat.files = files;
    expect(seat.workspace('g1', 0)).toBeUndefined();

    seat.store = openStore('first');
    expect(seat.workspace('g1', 0)).toBe(seat.workspace('g1', 0));
    expect(seat.workspace('g1', 1)).not.toBe(seat.workspace('g1', 0));
    expect(seat.workspace('g1', 0)!.store).toBe(seat.store);

    const before = seat.workspace('g1', 0);
    seat.store = openStore('second');
    expect(seat.workspace('g1', 0)).not.toBe(before);
    expect(seat.workspace('g1', 0)!.store).toBe(seat.store);
  });

  it('should return a failure result for a game ID that cannot name a folder', async () => {
    const seat = new VoxContext<AgentParameters>({}, 'bash-bad-game');
    seat.files = files;
    seat.store = openStore('bad');
    seat.registerAgentTools();
    const tool = seat.tools[bashToolName] as any;

    const result = await seat.withRun({ parameters: { playerID: 2, gameID: '../g7', turn: 1 } }, () =>
      tool.execute({ Command: 'echo hi' }, { toolCallId: 'c1', messages: [] }),
    );
    expect(result).toMatchObject({ stdout: '', exitCode: 1 });
  });

  it.skipIf(!workspaceNodeSupported())('should run commands in the workspace of the run parameters and commit notes', async () => {
    const seat = new VoxContext<AgentParameters>({}, 'bash-run');
    seat.files = files;
    seat.store = openStore('run');
    seat.registerAgentTools();
    const tool = seat.tools[bashToolName] as any;

    const result = await seat.withRun({ parameters: { playerID: 2, gameID: 'g7', turn: 4 } }, () =>
      tool.execute({ Command: 'echo noted > game/a.md && cat game/a.md' }, { toolCallId: 'c1', messages: [] }),
    );
    expect(result).toMatchObject({ stdout: 'noted\n', exitCode: 0 });
    expect(Buffer.from(seat.store.readFile('game/a.md')!).toString('utf8')).toBe('noted\n');
    expect(seat.store.history().at(-1)).toMatchObject({ kind: 'notes', turn: 4 });
  });
});
