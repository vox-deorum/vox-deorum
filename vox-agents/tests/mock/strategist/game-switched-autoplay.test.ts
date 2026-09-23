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

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, textResult, structuredResult } from '../../helpers/mock-mcp-client.js';

const modelMocks = vi.hoisted(() => ({
  ensureModelsResolved: vi.fn(async () => undefined),
  selectModelReference: vi.fn(),
  selectEvaluatorReference: vi.fn(),
  triageEnabled: vi.fn(() => false),
}));

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

vi.mock('../../../src/infra/vox-civilization.js', () => ({
  voxCivilization: {
    onGameExit: vi.fn(),
    killGame: vi.fn(async () => {}),
    restoreRandomSeeds: vi.fn(async () => {}),
    updateSkipAnimations: vi.fn(async () => {}),
    setAiObserver: vi.fn(),
    startGame: vi.fn(async () => false),
  },
}));

vi.mock('../../../src/utils/models/resolution.js', () => ({
  ensureModelsResolved: modelMocks.ensureModelsResolved,
  selectModelReference: modelMocks.selectModelReference,
  selectEvaluatorReference: modelMocks.selectEvaluatorReference,
  triageEnabled: modelMocks.triageEnabled,
}));

// Make the session's settle waits instant (post-player-creation and strategic-view delays).
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }));

import { StrategistSession } from '../../../src/strategist/strategist-session.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { voxCivilization } from '../../../src/infra/vox-civilization.js';
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
  modelMocks.triageEnabled.mockReset();
  modelMocks.triageEnabled.mockReturnValue(false);
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

    const scripts = luaScripts();
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain('if Game.GetAIAutoPlay() == 0 then');
    expect(scripts[0]).toContain(`Game.SetAIAutoPlay(${autoPlayTurnLimit}, -1);`);
    expect(scripts[1]).toBe(buildStrategicViewLua(false));
  });

  it('autoplay fresh start (turn 0): activates autoplay and enters strategic view', async () => {
    const s = session(true);
    await gameSwitched(s, 0);

    const scripts = luaScripts();
    expect(scripts[0]).toContain(`Game.SetAIAutoPlay(${autoPlayTurnLimit}, -1);`);
    // The turn-0 branch activates unconditionally — no reconcile guard.
    expect(scripts[0]).not.toContain('if Game.GetAIAutoPlay()');
    expect(scripts[1]).toBe(buildStrategicViewLua(true));
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

    expect(modelMocks.selectModelReference).toHaveBeenCalledWith('selected-strategist', 'small', overrides);
    expect(modelMocks.selectModelReference).toHaveBeenCalledWith('specialized-briefer', 'small', overrides);
    for (const name of ['selected-strategist', 'simple-briefer', 'diplomat', 'specialized-briefer', 'diplomatic-analyst', 'negotiator']) {
      for (const tier of ['small', 'default', 'large']) {
        expect(modelMocks.selectModelReference).toHaveBeenCalledWith(name, tier, overrides);
      }
    }
    expect(modelMocks.selectModelReference).not.toHaveBeenCalledWith('unused-agent', expect.anything(), overrides);
    // Triage off everywhere: no evaluator lookup is needed.
    expect(modelMocks.triageEnabled).toHaveBeenCalledWith('diplomat', overrides);
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

  it('preflights tier and evaluator references for a strategist whose pacing turns triage on', async () => {
    const llms = { 'selected-strategist': 'openai/strategist' };
    modelMocks.selectModelReference.mockImplementation((name: string, size?: string) =>
      (size === 'small' || size === 'large') ? `${name}.${size}` : llms[name as keyof typeof llms] ?? name);
    modelMocks.selectEvaluatorReference.mockImplementation(() => 'evaluator');
    vi.spyOn(agentRegistry, 'get').mockImplementation((name) => (
      name === 'selected-strategist' ? { modelSize: 'default' } : undefined) as never);
    vi.mocked(voxCivilization.startGame).mockResolvedValue(false);

    const s = new StrategistSession({
      name: 'strategist-triage-preflight',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      llmPlayers: { 0: { strategist: 'selected-strategist', pacing: { triage: true }, llms } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('Failed to start Civilization V');

    // The seat strategist gates on pacing.triage, never on the options.triage helper.
    expect(modelMocks.triageEnabled).not.toHaveBeenCalledWith('selected-strategist', llms);
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

  it('preflights tier and evaluator references for a non-strategist agent whose assignment opts into triage', async () => {
    const llms = {
      diplomat: { provider: 'openai', name: 'diplomat', options: { triage: true } },
    };
    modelMocks.selectModelReference.mockImplementation((name: string, size?: string) =>
      (size === 'small' || size === 'large') ? `${name}.${size}` : `${name}-ref`);
    modelMocks.selectEvaluatorReference.mockImplementation((name: string) =>
      name === 'diplomat' ? 'diplomat.evaluator' : undefined);
    modelMocks.triageEnabled.mockImplementation((name: string) => name === 'diplomat');
    vi.spyOn(agentRegistry, 'get').mockImplementation(() => undefined as never);
    vi.mocked(voxCivilization.startGame).mockResolvedValue(false);

    const s = new StrategistSession({
      name: 'diplomat-triage-preflight',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      llmPlayers: { 0: { strategist: 'null-strategist', llms } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('Failed to start Civilization V');

    // The triaged diplomat grows small/large/evaluator references; the plain strategist does not.
    expect(modelMocks.triageEnabled).toHaveBeenCalledWith('diplomat', llms);
    expect(modelMocks.triageEnabled).not.toHaveBeenCalledWith('null-strategist', llms);
    expect(modelMocks.selectEvaluatorReference).toHaveBeenCalledWith('diplomat', llms);
    expect(modelMocks.selectEvaluatorReference).toHaveBeenCalledTimes(1);
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
    const llms = { diplomat: { provider: 'openai', name: 'diplomat', options: { triage: true } } };
    modelMocks.selectModelReference.mockImplementation((name: string, size?: string) =>
      (size === 'small' || size === 'large') ? `${name}.${size}` : `${name}-ref`);
    modelMocks.selectEvaluatorReference.mockReturnValue(undefined);
    modelMocks.triageEnabled.mockImplementation((name: string) => name === 'diplomat');
    vi.spyOn(agentRegistry, 'get').mockImplementation(() => undefined as never);
    vi.mocked(voxCivilization.startGame).mockResolvedValue(false);

    const s = new StrategistSession({
      name: 'triage-without-evaluator',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      llmPlayers: { 0: { strategist: 'null-strategist', llms } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('Failed to start Civilization V');

    expect(modelMocks.ensureModelsResolved).toHaveBeenCalledWith([
      'null-strategist.small',
      'null-strategist-ref',
      'null-strategist.large',
      'diplomat.small',
      'diplomat-ref',
      'diplomat.large',
    ], llms);
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
});
