/** Shared fixtures for file-mode tests: a temporary records store and a fake file-mode context. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SeatRecords } from '../../../src/knowledge/records.js';
import type { GameState, StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { WorkspaceStore } from '../../../src/utils/workspace/workspace-store.js';
import { bashToolName } from '../../../src/utils/tools/tool-names.js';
import type { ResolvedFilesConfig } from '../../../src/types/index.js';

/** A temporary seat store with a records writer, removed by `dispose`. */
export interface TempRecords {
  store: WorkspaceStore;
  records: SeatRecords;
  dispose: () => void;
}

/** Open a temporary workspace store for one test. */
export function openTempRecords(): TempRecords {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-directions-'));
  const store = WorkspaceStore.open(path.join(dir, 'seat.db'));
  return {
    store,
    records: new SeatRecords(store),
    dispose: () => {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A small processed-turn state, enough for the records writer. */
export function recordableState(turn: number): GameState {
  return {
    turn,
    reports: {},
    players: { '0': { Civilization: 'Rome', Leader: 'Caesar', IsMajor: true } },
    cities: { Caesar: { Roma: { Population: 5 } } },
    military: { 'Unit Stats': [{ Type: 'Warrior' }] },
    victory: { Domination: 'Rome leads' },
    events: { [String(turn)]: [{ Type: 'TileRevealed' }] },
  } as unknown as GameState;
}

/** Parameters for the records writer. */
export function recordParameters(): StrategistParameters {
  return { playerID: 0, gameID: 'g1', turn: 1, workingMemory: {}, gameStates: {}, metadata: { YouAre: { Name: 'Rome', Leader: 'Caesar' } } } as unknown as StrategistParameters;
}

/**
 * Put a fake context in file mode: files on, bash registered, and the run's tools resolved as the
 * execution loop would. Pass `tools` to resolve a declared list instead of all registered tools,
 * and `files` to set the seat's folders.
 */
export function enableFileMode<T extends object>(context: T, store?: WorkspaceStore, tools?: string[], files: Partial<ResolvedFilesConfig> = {}): T {
  Object.assign(context, {
    files,
    store,
    prompts: false,
    tools: { ...((context as { tools?: object }).tools ?? {}), [bashToolName]: {} },
    currentRunTools: { tools },
  });
  return context;
}
