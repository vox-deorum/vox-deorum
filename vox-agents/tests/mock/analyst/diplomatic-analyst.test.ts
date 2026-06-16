/**
 * Tests for the DiplomaticAnalyst prompt builders (`getSystem` / `getInitialMessages`).
 *
 * The agent is resolved through the registry (the canonical load entry) to avoid the
 * circular-import hazard of importing the agent module in isolation; the prompt methods are
 * protected/public-on-instance, so we reach them through a loosely-typed handle.
 *
 * Per the assertion-stability rule we assert that dynamic values from parameters/input are
 * present and that the stable MCP tool IDs appear by reference — never the surrounding prose
 * or exact sentence order.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import {
  createFakeVoxContext,
  makeStrategistParameters,
  makeGameState,
} from '../../helpers/fake-vox-context.js';

const analyst = agentRegistry.get('diplomatic-analyst') as any;

/** Parameters with a seeded game state at turn 5 so buildGameContextMessages can run. */
function paramsWithState(overrides: Record<string, unknown> = {}) {
  return makeStrategistParameters({
    gameStates: { 5: makeGameState(5, { players: {} } as any) },
    ...overrides,
  });
}

const input = {
  Context: 'Border skirmish near the eastern frontier.',
  Content: 'Germany proposes a non-aggression pact.',
  Memo: 'The diplomat believes this is a stalling tactic.',
};

describe('DiplomaticAnalyst.getSystem', () => {
  it('embeds the dynamic Leader/Name from parameters.metadata.YouAre', async () => {
    const ctx = createFakeVoxContext();
    const params = paramsWithState();
    const system = await analyst.getSystem(params, input, ctx.asContext());

    expect(system).toContain('Rome');
    expect(system).toContain('Caesar');
  });

  it('falls back to defaults when metadata.YouAre is absent', async () => {
    const ctx = createFakeVoxContext();
    const params = paramsWithState({ metadata: {} as any });
    const system = await analyst.getSystem(params, input, ctx.asContext());

    expect(system).toContain('your civilization');
    expect(system).toContain('your leader');
    expect(system).not.toContain('Caesar');
  });

  it('references the stable MCP tool IDs get-briefing and get-diplomatic-events', async () => {
    const ctx = createFakeVoxContext();
    const params = paramsWithState();
    const system = await analyst.getSystem(params, input, ctx.asContext());

    expect(system).toContain('get-briefing');
    expect(system).toContain('get-diplomatic-events');
  });
});

describe('DiplomaticAnalyst.getInitialMessages', () => {
  it('prepends the shared game-context messages', async () => {
    const ctx = createFakeVoxContext();
    const params = paramsWithState();
    const messages = await analyst.getInitialMessages(params, input, ctx.asContext());

    // First message is the system game-context block; the report message follows.
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('# Your Civilization');
  });

  it('includes the three AnalystInput values (Context, Content, Memo)', async () => {
    const ctx = createFakeVoxContext();
    const params = paramsWithState();
    const messages = await analyst.getInitialMessages(params, input, ctx.asContext());

    const reportMessage = messages[messages.length - 1];
    expect(reportMessage.role).toBe('user');
    expect(reportMessage.content).toContain(input.Context);
    expect(reportMessage.content).toContain(input.Content);
    expect(reportMessage.content).toContain(input.Memo);
  });
});
