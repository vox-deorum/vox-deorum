/**
 * Tests for StrategistSession's autoplay reconciliation on game switch and
 * crash recovery (src/strategist/strategist-session.ts). Civ V serializes the
 * autoplay counter and slot statuses into saves, so handleGameSwitched must
 * align the engine with the session config in both directions: an interactive
 * (autoPlay: false) session loading/taking over an auto-playing game cancels
 * autoplay and hands seat 0 to the human; an autoplay session loading a human
 * save activates autoplay. The turn-0 fresh-start activation is unchanged.
 *
 * Driven entirely through the shared mcpClient fixture; vox-civilization is
 * mocked and timers are made instant.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, textResult, structuredResult } from '../../helpers/mock-mcp-client.js';

const modelMocks = vi.hoisted(() => ({
  ensureModelsResolved: vi.fn(async () => undefined),
  selectModelReference: vi.fn(),
  selectEvaluatorReference: vi.fn(),
}));

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

vi.mock('../../../src/infra/vox-civilization.js', () => ({
  voxCivilization: {
    onGameExit: vi.fn(),
    onGameBound: vi.fn(),
    killGame: vi.fn(async () => {}),
    restoreRandomSeeds: vi.fn(async () => {}),
    updateSkipAnimations: vi.fn(async () => {}),
    setAiObserver: vi.fn(),
    setUseDX11: vi.fn(),
    getGameExecutable: vi.fn(() => 'CivilizationV_DX11.exe'),
    startGame: vi.fn(async () => false),
  },
}));

vi.mock('../../../src/utils/models/resolution.js', () => ({
  ensureModelsResolved: modelMocks.ensureModelsResolved,
  selectModelReference: modelMocks.selectModelReference,
  selectEvaluatorReference: modelMocks.selectEvaluatorReference,
}));

// Make the session's settle waits instant (post-player-creation and strategic-view delays).
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }));

import { StrategistSession } from '../../../src/strategist/strategist-session.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { voxCivilization } from '../../../src/infra/vox-civilization.js';
import { VoxPlayer } from '../../../src/strategist/vox-player.js';
import { VoxContext } from '../../../src/infra/vox-context.js';
import { VoxSpanExporter } from '../../../src/utils/telemetry/vox-exporter.js';
import { sqliteExporter } from '../../../src/instrumentation.js';
import { contextRegistry } from '../../../src/infra/context-registry.js';
import { WorkspaceStore } from '../../../src/utils/workspace/workspace-store.js';
import { hasGameReference, writeGameReference } from '../../../src/knowledge/reference.js';
import { config as rootConfig } from '../../../src/utils/config.js';
import {
  autoPlayTurnLimit,
  buildStrategicViewLua,
} from '../../../src/utils/game/control-lua.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
  modelMocks.ensureModelsResolved.mockClear();
  modelMocks.selectModelReference.mockReset();
  modelMocks.selectEvaluatorReference.mockReset();
  mcp.respondWith('set-metadata', textResult(true));
  mcp.respondWith('pause-game', textResult(true));
  mcp.respondWith('lua-executor', structuredResult({ Success: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Construct a session past the start() ceremony: production 'none' no-ops all
 * OBS paths, an empty llmPlayers map skips VoxPlayer creation, and a seedless
 * claim short-circuits seed verification. handleGameSwitched bails while
 * 'stopped', so tests begin from 'starting' as a real launch would.
 */
function session(autoPlay: boolean) {
  const config = {
    name: 'test',
    type: 'strategist',
    production: 'none',
    autoPlay,
    gameMode: 'start',
    llmPlayers: {},
  } as any;
  const manager = { attachGameID: vi.fn(async () => {}) } as any;
  const claim = { seatingMap: {}, rotation: 0, seedIndex: 0 } as any;
  const s = new StrategistSession(config, manager, claim);
  (s as any).state = 'starting';
  return s;
}

const gameSwitched = (s: StrategistSession, turn: number, gameID = 'G1') =>
  (s as any).handleGameSwitched({ gameID, turn }) as Promise<void>;

const luaScripts = () => mcp.calls('lua-executor').map((c) => String(c.args.Script));

describe('handleGameSwitched autoplay reconciliation', () => {
  it('interactive load/takeover: clears the override, cancels autoplay, returns seat 0', async () => {
    const s = session(false);
    await gameSwitched(s, 214);

    const scripts = luaScripts();
    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    // Override (cleared — no human-strategist seat) must precede LoadScreenClose.
    expect(script.indexOf('Game.SetObserverUIOverridePlayer(-1)')).toBeGreaterThanOrEqual(0);
    expect(script.indexOf('Game.SetObserverUIOverridePlayer(-1)')).toBeLessThan(
      script.indexOf('Events.LoadScreenClose()')
    );
    expect(script).toContain('if Game.GetAIAutoPlay() > 0 then');
    expect(script).toContain('Game.SetAIAutoPlay(0, 0);');
    expect(script).toContain('elseif Game.GetActivePlayer() ~= 0 then');
    // Interactive sessions never enter strategic view.
    expect(script).not.toContain('ToggleStrategicView');
  });

  it('autoplay load: activates autoplay only if the save has it off, then enters strategic view', async () => {
    const s = session(true);
    await gameSwitched(s, 214);

    // The strategic-view switch runs detached, so wait for it to be sent.
    await vi.waitFor(() => expect(luaScripts()).toHaveLength(2));
    const scripts = luaScripts();
    expect(scripts[0]).toContain('if Game.GetAIAutoPlay() == 0 then');
    expect(scripts[0]).toContain(`Game.SetAIAutoPlay(${autoPlayTurnLimit}, -1);`);
    expect(scripts[1]).toBe(buildStrategicViewLua(false));
  });

  it('autoplay fresh start (turn 0): activates autoplay and enters strategic view', async () => {
    const s = session(true);
    await gameSwitched(s, 0);

    await vi.waitFor(() => expect(luaScripts()).toHaveLength(2));
    const scripts = luaScripts();
    expect(scripts[0]).toContain(`Game.SetAIAutoPlay(${autoPlayTurnLimit}, -1);`);
    // The turn-0 branch activates unconditionally — no reconcile guard.
    expect(scripts[0]).not.toContain('if Game.GetAIAutoPlay()');
    expect(scripts[1]).toBe(buildStrategicViewLua(true));
  });

  it('should finish the game switch when the strategic-view call never answers', async () => {
    const strategicView = buildStrategicViewLua(true);
    mcp.onTool('lua-executor', (args) =>
      args.Script === strategicView ? new Promise(() => {}) : structuredResult({ Success: true })
    );
    const s = session(true);
    const obsCall = vi.spyOn(s as any, 'obsCall');

    await gameSwitched(s, 0);

    // Steps after the switch still ran, and the switch itself was attempted.
    expect(obsCall).toHaveBeenCalledWith('startProduction', expect.any(Function));
    await vi.waitFor(() => expect(luaScripts()).toContain(strategicView));
  });

  it('should warn and carry on when the strategic-view call fails', async () => {
    const strategicView = buildStrategicViewLua(true);
    mcp.onTool('lua-executor', (args) =>
      args.Script === strategicView
        ? structuredResult({ Success: false, Error: { Code: 'LUA_EXECUTION_ERROR', Message: 'boom' } })
        : structuredResult({ Success: true })
    );
    const s = session(true);
    const obsCall = vi.spyOn(s as any, 'obsCall');

    await expect(gameSwitched(s, 0)).resolves.toBeUndefined();
    expect(obsCall).toHaveBeenCalledWith('startProduction', expect.any(Function));
    await vi.waitFor(() => expect(luaScripts()).toContain(strategicView));
  });

  it('ignores a repeated GameSwitched for the same game', async () => {
    const s = session(false);
    await gameSwitched(s, 214);
    const before = mcp.calls('lua-executor').length;

    await gameSwitched(s, 215);
    expect(mcp.calls('lua-executor')).toHaveLength(before);
  });
});

describe('model preflight', () => {
  it('preflights reachable support and diplomacy agents without resolving unused seat overrides', async () => {
    const overrides = {
      'selected-strategist': 'openai/strategist',
      'simple-briefer': 'openai/simple-briefer',
      diplomat: 'openai/diplomat',
      'specialized-briefer': 'openai/specialized-briefer',
      'diplomatic-analyst': 'openai/diplomatic-analyst',
      negotiator: 'openai/negotiator',
      'unused-agent': 'openai/unused',
    };
    const agents = {
      'selected-strategist': { modelSize: 'small', modelDependencies: ['simple-briefer'] },
      'simple-briefer': { modelSize: 'small' },
      diplomat: { modelSize: 'default', modelDependencies: ['specialized-briefer', 'diplomatic-analyst'], usesSeatNegotiator: true },
      'specialized-briefer': { modelSize: 'small' },
      'diplomatic-analyst': { modelSize: 'small' },
      negotiator: { modelSize: 'default' },
    };
    modelMocks.selectModelReference.mockImplementation((name) => overrides[name as keyof typeof overrides]);
    vi.spyOn(agentRegistry, 'get').mockImplementation((name) => agents[name as keyof typeof agents] as never);
    vi.spyOn(agentRegistry, 'has').mockImplementation((name) => name in agents);
    vi.mocked(voxCivilization.startGame).mockResolvedValue(false);

    const s = new StrategistSession({
      name: 'preflight',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      llmPlayers: { 0: { strategist: 'selected-strategist', llms: overrides } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('Failed to start Civilization V');

    for (const name of ['selected-strategist', 'simple-briefer', 'diplomat', 'specialized-briefer', 'diplomatic-analyst', 'negotiator']) {
      for (const tier of ['small', 'default', 'large']) {
        expect(modelMocks.selectModelReference).toHaveBeenCalledWith(name, tier, overrides);
      }
    }
    expect(modelMocks.selectModelReference).not.toHaveBeenCalledWith('unused-agent', expect.anything(), overrides);
    // Triage off everywhere: no evaluator lookup is needed.
    expect(modelMocks.selectEvaluatorReference).not.toHaveBeenCalled();
    expect(modelMocks.ensureModelsResolved).toHaveBeenCalledWith([
      'openai/strategist',
      'openai/simple-briefer',
      'openai/diplomat',
      'openai/specialized-briefer',
      'openai/diplomatic-analyst',
      'openai/negotiator',
    ], overrides);
  });

  it('preflights the strategist evaluator for pacing triage but skips other agents without a triage hook', async () => {
    const llms = { 'selected-strategist': 'openai/strategist' };
    modelMocks.selectModelReference.mockImplementation((name: string, size?: string) =>
      (size === 'small' || size === 'large') ? `${name}.${size}` : llms[name as keyof typeof llms] ?? name);
    modelMocks.selectEvaluatorReference.mockImplementation(() => 'evaluator');
    vi.spyOn(agentRegistry, 'get').mockImplementation((name) => (
      name === 'selected-strategist' ? { modelSize: 'default' } : undefined) as never);
    vi.mocked(voxCivilization.startGame).mockResolvedValue(false);

    const s = new StrategistSession({
      name: 'hookless-triage-preflight',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      triage: true,
      llmPlayers: { 0: { strategist: 'selected-strategist', llms } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('Failed to start Civilization V');

    // Pacing triages the strategist; the hookless diplomat stand-in is never looked up.
    expect(modelMocks.selectEvaluatorReference).toHaveBeenCalledTimes(1);
    expect(modelMocks.selectEvaluatorReference).toHaveBeenCalledWith('selected-strategist', llms);
    expect(modelMocks.ensureModelsResolved).toHaveBeenCalledWith([
      'selected-strategist.small',
      'openai/strategist',
      'selected-strategist.large',
      'evaluator',
      'diplomat.small',
      'diplomat',
      'diplomat.large',
    ], llms);
  });

  it('preflights the evaluator reference for a hooked agent the seat triage lists', async () => {
    const llms = { diplomat: 'openai/diplomat' };
    modelMocks.selectModelReference.mockImplementation((name: string, size?: string) =>
      (size === 'small' || size === 'large') ? `${name}.${size}` : `${name}-ref`);
    modelMocks.selectEvaluatorReference.mockImplementation((name: string) =>
      name === 'diplomat' ? 'diplomat.evaluator' : undefined);
    vi.spyOn(agentRegistry, 'get').mockImplementation((name) => (
      name === 'diplomat' ? { modelSize: 'default', triage: vi.fn() } : undefined) as never);
    vi.mocked(voxCivilization.startGame).mockResolvedValue(false);

    const s = new StrategistSession({
      name: 'diplomat-triage-preflight',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      // The seat setting wins over the session's, so only this seat's diplomat triages.
      triage: false,
      llmPlayers: { 0: { strategist: 'null-strategist', triage: ['diplomat'], llms } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('Failed to start Civilization V');

    expect(modelMocks.selectEvaluatorReference).toHaveBeenCalledTimes(1);
    expect(modelMocks.selectEvaluatorReference).toHaveBeenCalledWith('diplomat', llms);
    expect(modelMocks.ensureModelsResolved).toHaveBeenCalledWith([
      'null-strategist.small',
      'null-strategist-ref',
      'null-strategist.large',
      'diplomat.small',
      'diplomat-ref',
      'diplomat.large',
      'diplomat.evaluator',
    ], llms);
  });

  it('omits the evaluator reference when the triaged agent has no evaluator registered', async () => {
    const llms = {};
    modelMocks.selectModelReference.mockImplementation((name: string, size?: string) =>
      (size === 'small' || size === 'large') ? `${name}.${size}` : `${name}-ref`);
    modelMocks.selectEvaluatorReference.mockReturnValue(undefined);
    vi.spyOn(agentRegistry, 'get').mockImplementation((name) => (
      name === 'diplomat' ? { modelSize: 'default', triage: vi.fn() } : undefined) as never);
    vi.mocked(voxCivilization.startGame).mockResolvedValue(false);

    const s = new StrategistSession({
      name: 'triage-without-evaluator',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      triage: ['diplomat'],
      llmPlayers: { 0: { strategist: 'null-strategist', llms } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('Failed to start Civilization V');

    expect(modelMocks.selectEvaluatorReference).toHaveBeenCalledWith('diplomat', llms);
    expect(modelMocks.ensureModelsResolved).toHaveBeenCalledWith([
      'null-strategist.small',
      'null-strategist-ref',
      'null-strategist.large',
      'diplomat.small',
      'diplomat-ref',
      'diplomat.large',
    ], llms);
  });

  it('rejects a seat role that is not an agent name before launching the game', async () => {
    modelMocks.selectModelReference.mockImplementation((name: string) => name);
    vi.spyOn(agentRegistry, 'get').mockImplementation(() => undefined as never);
    vi.mocked(voxCivilization.startGame).mockClear();

    const s = new StrategistSession({
      name: 'object-diplomat',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      llmPlayers: { 0: { strategist: 'null-strategist', diplomat: { options: { triage: true } } as never } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('llmPlayers.0.diplomat');
    expect(voxCivilization.startGame).not.toHaveBeenCalled();
  });

  it('rejects a malformed triage setting before launching the game', async () => {
    vi.mocked(voxCivilization.startGame).mockClear();

    const s = new StrategistSession({
      name: 'invalid-triage',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      llmPlayers: { 0: { strategist: 'null-strategist', triage: 'diplomat' as never } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('llmPlayers.0.triage');
    expect(voxCivilization.startGame).not.toHaveBeenCalled();
  });

  it('should reject an invalid seat prompt folder before launching the game', async () => {
    vi.mocked(voxCivilization.startGame).mockClear();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-prompts-'));
    fs.writeFileSync(path.join(dir, 'not-a-built-in.md'), 'Unknown\n');

    try {
      const s = new StrategistSession({
        name: 'invalid-prompts',
        type: 'strategist',
        autoPlay: false,
        gameMode: 'start',
        llmPlayers: { 0: { strategist: 'null-strategist', prompts: dir } },
      }, {} as never, null);

      await expect(s.start()).rejects.toThrow('not-a-built-in.md');
      expect(voxCivilization.startGame).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('recoverGame', () => {
  it('re-issues the unified non-fresh transition after a crash relaunch', async () => {
    const s = session(false);
    (s as any).state = 'recovering';
    await (s as any).recoverGame();

    const scripts = luaScripts();
    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    // Same ordering invariant as handleGameSwitched: override before
    // LoadScreenClose (the mod's screen-bar gate re-evaluates on that event),
    // autoplay reconcile last.
    expect(script.indexOf('Game.SetObserverUIOverridePlayer(-1)')).toBeGreaterThanOrEqual(0);
    expect(script.indexOf('Game.SetObserverUIOverridePlayer(-1)')).toBeLessThan(
      script.indexOf('Events.LoadScreenClose()')
    );
    expect(script).toContain('Game.SetAIAutoPlay(0, 0);');
    expect((s as any).state).toBe('running');
  });

  it('is a no-op outside the recovering state', async () => {
    const s = session(false);
    await (s as any).recoverGame();
    expect(luaScripts()).toHaveLength(0);
  });
});

describe('handleDLLConnected', () => {
  it('should reset event dedup only once per disconnected-to-connected transition', async () => {
    const s = session(false);
    const resetEventDedup = vi.spyOn((s as any).ingameBridge, 'resetEventDedup');

    await (s as any).handleDLLConnected({});
    await (s as any).handleDLLConnected({});
    expect(resetEventDedup).toHaveBeenCalledOnce();

    (s as any).dllConnected = false;
    await (s as any).handleDLLConnected({});
    expect(resetEventDedup).toHaveBeenCalledTimes(2);
  });

  it('should clear each player\'s startup acknowledgement and refresh failures only on a disconnected-to-connected transition', async () => {
    const s = session(false);
    const clearStartupAcknowledgement = vi.fn();
    const resetRefreshFailures = vi.fn();
    (s as any).activePlayers.set(0, { clearStartupAcknowledgement, resetRefreshFailures });

    await (s as any).handleDLLConnected({});
    await (s as any).handleDLLConnected({});
    expect(clearStartupAcknowledgement).toHaveBeenCalledOnce();
    expect(resetRefreshFailures).toHaveBeenCalledOnce();

    (s as any).dllConnected = false;
    await (s as any).handleDLLConnected({});
    expect(clearStartupAcknowledgement).toHaveBeenCalledTimes(2);
    expect(resetRefreshFailures).toHaveBeenCalledTimes(2);
  });
});

describe('handleGameSwitched player preparation', () => {
  const referenceTools = ['get-technology', 'get-policy', 'get-building', 'get-unit'];
  let telemetryDir: string;
  let savedTelemetryDir: string | undefined;
  let execute: ReturnType<typeof vi.spyOn>;
  /** Whether the seat store held the reference when each loop started. */
  let referenceAtStart: boolean[];
  /** Players a session started, closed after each test. */
  const preparedPlayers: VoxPlayer[] = [];
  /** IDs of every context registered during a test. */
  let registeredContexts: string[];
  /** The folder each context ID registered through the spied `createContext`. */
  const folders = new Map<string, string>();

  beforeEach(() => {
    savedTelemetryDir = rootConfig.telemetryDir;
    telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-prepare-'));
    rootConfig.telemetryDir = telemetryDir;
    folders.clear();
    vi.spyOn(VoxSpanExporter.getInstance(), 'createContext').mockImplementation(async (id, folder) => { folders.set(id, folder); });
    vi.spyOn(sqliteExporter, 'getDatabasePath').mockImplementation((id: string) => path.join(telemetryDir, folders.get(id) ?? 'unknown', `${id}.db`));
    vi.spyOn(VoxSpanExporter.getInstance(), 'closeContext').mockResolvedValue(undefined);
    vi.spyOn(VoxContext.prototype, 'registerTools').mockResolvedValue(undefined);
    registeredContexts = [];
    const register = contextRegistry.register.bind(contextRegistry);
    vi.spyOn(contextRegistry, 'register').mockImplementation((context) => {
      registeredContexts.push(context.id);
      register(context);
    });
    referenceAtStart = [];
    execute = vi.spyOn(VoxPlayer.prototype, 'execute').mockImplementation(async function (this: VoxPlayer) {
      referenceAtStart.push(this.context.store !== undefined && hasGameReference(this.context.store));
    });
    vi.mocked(voxCivilization.killGame).mockClear();
    for (const tool of referenceTools) {
      mcp.respondWith(tool, structuredResult({ Count: 2, Items: [{ Type: `${tool}-A`, Name: 'Alpha' }, { Type: `${tool}-B`, Name: 'Beta' }] }));
    }
  });

  afterEach(() => {
    // Close every store the session left open so the temporary folder can be removed.
    for (const player of preparedPlayers) player.closeStore();
    preparedPlayers.length = 0;
    rootConfig.telemetryDir = savedTelemetryDir as string;
    try {
      fs.rmSync(telemetryDir, { recursive: true, force: true });
    } catch {
      // A store left open by a failed test can keep the folder locked on Windows.
    }
  });


  /** A session with two seats, both file-enabled unless `files` is false. */
  function preparedSession(files: boolean, strategist = 'simple-strategist') {
    const s = new StrategistSession({
      name: 'prepare',
      type: 'strategist',
      production: 'none',
      autoPlay: false,
      gameMode: 'start',
      files: files ? 'write' : false,
      llmPlayers: { 0: { strategist }, 1: { strategist: 'simple-strategist' } },
    } as any, { attachGameID: vi.fn(async () => {}) } as any, { seatingMap: {}, rotation: 0, seedIndex: 0 } as any);
    (s as any).state = 'starting';
    return s;
  }

  /** The seat's telemetry database path under its strategist folder. */
  function seatDbPath(gameID: string, playerID: number, strategist: string): string {
    return path.join(telemetryDir, strategist, `${gameID}-player-${playerID}.db`);
  }

  /** The registered contexts still in the registry. */
  function liveContexts(): string[] {
    return registeredContexts.filter((id) => contextRegistry.get(id) !== undefined);
  }

  /** Remember the players a session started, for cleanup. */
  function rememberPlayers(s: StrategistSession): void {
    preparedPlayers.push(...(s as any).activePlayers.values());
  }

  it('should write the reference once with four calls before any loop starts', async () => {
    const s = preparedSession(true);
    await gameSwitched(s, 10, 'G-prep');
    rememberPlayers(s);

    for (const tool of referenceTools) {
      expect(mcp.calls(tool)).toHaveLength(1);
      expect(mcp.calls(tool)[0].args).toEqual({ MaxResults: 5000, Detailed: true });
    }
    expect(execute).toHaveBeenCalledTimes(2);
    expect(referenceAtStart).toEqual([true, true]);
    expect((s as any).state).toBe('running');
  });

  it('should make no reference calls when no seat has files enabled', async () => {
    const s = preparedSession(false);
    await gameSwitched(s, 10, 'G-prep');
    rememberPlayers(s);

    for (const tool of referenceTools) expect(mcp.calls(tool)).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(referenceAtStart).toEqual([false, false]);
  });

  it('should skip the reference calls when an earlier session already wrote it to every seat', async () => {
    for (const playerID of [0, 1]) {
      const store = WorkspaceStore.open(seatDbPath('G-prep', playerID, 'simple-strategist'));
      await writeGameReference([store]);
      store.close();
    }
    mcp.callLog = [];
    const s = preparedSession(true);
    await gameSwitched(s, 10, 'G-prep');
    rememberPlayers(s);

    for (const tool of referenceTools) expect(mcp.calls(tool)).toHaveLength(0);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(referenceAtStart).toEqual([true, true]);
  });

  it('should replace stale references before starting any player loop', async () => {
    for (const playerID of [0, 1]) {
      const store = WorkspaceStore.open(seatDbPath('G-prep', playerID, 'simple-strategist'));
      store.commit({ kind: 'reference', turn: null, author: 'host', changes: [{ path: 'reference/units.md', type: 'file', content: 'stale' }] });
      store.close();
    }
    const s = preparedSession(true);
    execute.mockImplementation(async function (this: VoxPlayer) {
      expect(this.context.store!.readFile('reference/.format-version')).toBeDefined();
      expect(this.context.store!.readFile('reference/units.md')).toBeUndefined();
      expect(this.context.store!.readFile('reference/units/ancient.md')).toBeDefined();
    });

    await gameSwitched(s, 10, 'G-prep');
    rememberPlayers(s);

    for (const tool of referenceTools) expect(mcp.calls(tool)).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('should put the session in error, start no loops, and release opened seats when the reference fails', async () => {
    mcp.respondWith('get-unit', structuredResult({ Count: 0, Items: [], Error: 'database not ready' }));
    const close = vi.spyOn(WorkspaceStore.prototype, 'close');
    const s = preparedSession(true);

    await gameSwitched(s, 10, 'G-prep');

    expect((s as any).state).toBe('error');
    expect(voxCivilization.killGame).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect((s as any).activePlayers.size).toBe(0);
    expect(close).toHaveBeenCalledTimes(2);
    expect(registeredContexts).toHaveLength(2);
    expect(liveContexts()).toEqual([]);
    for (const playerID of [0, 1]) {
      const store = WorkspaceStore.open(seatDbPath('G-prep', playerID, 'simple-strategist'), { readonly: true });
      expect(hasGameReference(store)).toBe(false);
      store.close();
    }
  });

  it('should put the session in error, start no loops, and release opened seats when a store cannot open', async () => {
    const realOpen = WorkspaceStore.open.bind(WorkspaceStore);
    let opens = 0;
    vi.spyOn(WorkspaceStore, 'open').mockImplementation((dbPath, options) => {
      if (++opens === 2) throw new Error('SQLITE_CANTOPEN');
      return realOpen(dbPath, options);
    });
    const close = vi.spyOn(WorkspaceStore.prototype, 'close');
    const s = preparedSession(true);

    await gameSwitched(s, 10, 'G-prep');

    expect((s as any).state).toBe('error');
    expect(voxCivilization.killGame).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(liveContexts()).toEqual([]);
    for (const tool of referenceTools) expect(mcp.calls(tool)).toHaveLength(0);
  });

  it('should start no loops and release prepared seats when the session stops during preparation', async () => {
    let answer!: () => void;
    const pending = new Promise<void>((resolve) => { answer = resolve; });
    mcp.onTool('get-unit', async () => {
      await pending;
      return structuredResult({ Count: 1, Items: [{ Type: 'UNIT_A', Name: 'Alpha' }] });
    });
    const close = vi.spyOn(WorkspaceStore.prototype, 'close');
    const s = preparedSession(true);

    const switching = gameSwitched(s, 10, 'G-prep');
    await vi.waitFor(() => expect(mcp.calls('get-unit')).toHaveLength(1));
    // What shutdown does before its first await.
    (s as any).state = 'stopping';
    (s as any).abortController.abort();
    answer();
    await switching;

    expect(execute).not.toHaveBeenCalled();
    expect((s as any).activePlayers.size).toBe(0);
    expect(close).toHaveBeenCalledTimes(2);
    expect(liveContexts()).toEqual([]);
  });

  it('should label the proactive human turn-0 notification as a startup notification', async () => {
    const notifyTurn = vi.spyOn(VoxPlayer.prototype, 'notifyTurn');
    const s = preparedSession(false, 'human-strategist');

    await gameSwitched(s, 0, 'G-prep');
    rememberPlayers(s);

    expect(notifyTurn).toHaveBeenCalledWith(0, 'startup');
  });
});
