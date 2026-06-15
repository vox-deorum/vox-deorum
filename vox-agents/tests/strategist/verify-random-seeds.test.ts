/**
 * Tests for StrategistSession.verifyRandomSeeds (src/strategist/strategist-session.ts) —
 * the reproducibility gate that compares the session's configured fixed seeds against
 * Civ's observed pregame `syncRandSeed`/`mapRandSeed` metadata.
 *
 * The comparison reads through the real getMetadata wrapper, so it's driven entirely by
 * the shared mcpClient fixture (no live server). vox-civilization is mocked so the
 * mismatch branch's killGame() is observable and the constructor's onGameExit() is inert.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, textResult } from '../helpers/mock-mcp-client.js';

vi.mock('../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

vi.mock('../../src/infra/vox-civilization.js', () => ({
  voxCivilization: {
    onGameExit: vi.fn(),
    killGame: vi.fn(async () => {}),
    restoreRandomSeeds: vi.fn(async () => {}),
  },
}));

import { StrategistSession } from '../../src/strategist/strategist-session.js';
import { voxCivilization } from '../../src/infra/vox-civilization.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
  vi.mocked(voxCivilization.killGame).mockClear();
});

/** Construct a session with the given configured seeds; other ceremony is stubbed. */
function session(seeds?: { sync?: number; map?: number }) {
  const config = { type: 'strategist', production: 'none' } as any;
  const claim = { seeds } as any;
  return new StrategistSession(config, {} as any, claim);
}

/** Program get-metadata to answer per-key, mirroring Civ's pregame seed store. */
function observedSeeds(values: { syncRandSeed?: unknown; mapRandSeed?: unknown }) {
  mcp.onTool('get-metadata', (args) => {
    const key = args.Key as keyof typeof values;
    const value = values[key];
    return textResult(value === undefined ? '' : (value as any));
  });
}

/** Reach the private method + protected state for assertions. */
const verify = (s: StrategistSession) => (s as any).verifyRandomSeeds() as Promise<boolean>;
const stateOf = (s: StrategistSession) => (s as any).state as string;

describe('verifyRandomSeeds', () => {
  it('short-circuits to true without reading metadata when no seeds are fixed', async () => {
    const s = session(undefined);

    expect(await verify(s)).toBe(true);
    expect(mcp.calls('get-metadata')).toHaveLength(0);
    expect(voxCivilization.killGame).not.toHaveBeenCalled();
  });

  it('passes when observed seeds match the configured seeds', async () => {
    observedSeeds({ syncRandSeed: 111, mapRandSeed: 222 });
    const s = session({ sync: 111, map: 222 });

    expect(await verify(s)).toBe(true);
    expect(mcp.calls('get-metadata')).toHaveLength(2);
    expect(stateOf(s)).not.toBe('error');
    expect(voxCivilization.killGame).not.toHaveBeenCalled();
  });

  it('only checks the seeds that were actually fixed', async () => {
    // map seed omitted from config → its observed value is irrelevant.
    observedSeeds({ syncRandSeed: 111, mapRandSeed: 999 });
    const s = session({ sync: 111 });

    expect(await verify(s)).toBe(true);
    expect(stateOf(s)).not.toBe('error');
  });

  it('fails the session on a seed mismatch: error state, abort, killGame', async () => {
    observedSeeds({ syncRandSeed: 111, mapRandSeed: 777 });
    const s = session({ sync: 111, map: 222 });

    expect(await verify(s)).toBe(false);
    expect(stateOf(s)).toBe('error');
    expect((s as any).errorMessage).toMatch(/map expected 222, observed 777/);
    expect((s as any).abortController.signal.aborted).toBe(true);
    expect(voxCivilization.killGame).toHaveBeenCalledTimes(1);
  });

  it('reports a missing observed seed as "(missing)" in the failure message', async () => {
    observedSeeds({ syncRandSeed: undefined, mapRandSeed: 222 });
    const s = session({ sync: 111, map: 222 });

    expect(await verify(s)).toBe(false);
    expect((s as any).errorMessage).toMatch(/sync expected 111, observed \(missing\)/);
  });

  it('unblocks the session finish promise on failure', async () => {
    observedSeeds({ syncRandSeed: 0, mapRandSeed: 0 });
    const s = session({ sync: 111 });

    // finishPromise resolves via victoryResolve?.() on the failure path.
    let resolved = false;
    (s as any).finishPromise.then(() => {
      resolved = true;
    });

    expect(await verify(s)).toBe(false);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});
