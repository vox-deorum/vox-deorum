/**
 * Tests for the LiveEnvoy base behavior — exercised through the concrete Spokesperson
 * agent resolved from the registry (the canonical load entry, avoiding the circular-import
 * hazard of importing the abstract module directly). LiveEnvoy's lifecycle hooks are public
 * or protected; we reach them through a loosely-typed handle (as in diplomat-prompts.test.ts).
 *
 * Covered: getInitialMessages (shared game context, special-message filtering, normal-mode
 * hint append, special-mode prompt append by reference), prepareStep (clears tools in special
 * mode), and getExtraTools (exposes get-briefing). Identity/context derive from the typed
 * parameters; buildGameContextMessages requires a seeded game state near parameters.turn.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import type { EnvoyThread, MessageWithMetadata } from '../../../src/types/index.js';
import { specialMessages } from '../../../src/envoy/envoy.js';
import { buildGameContextMessages } from '../../../src/strategist/strategy-parameters.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';

const spokesperson = agentRegistry.get('spokesperson') as any;

/** Germany(3) ↔ leader(1) thread; the agent voices seat 3. */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'spokesperson',
    player1Identity: { name: 'Rome', leader: 'Caesar' },
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

/** A normal text message from the audience. */
function textMessage(content: string): MessageWithMetadata {
  return { message: { role: 'user', content }, metadata: { datetime: new Date(0), turn: 5 } };
}

/** The {{{Greeting}}} special trigger message. */
function greetingMessage(): MessageWithMetadata {
  return { message: { role: 'user', content: '{{{Greeting}}}' }, metadata: { datetime: new Date(0), turn: 5 } };
}

/**
 * Parameters with a seeded game state near turn 5, so buildGameContextMessages (used by the
 * shared game context) has a state to render and does not throw.
 */
function liveParams(overrides: Record<string, unknown> = {}) {
  return {
    playerID: 3,
    turn: 5,
    metadata: { YouAre: { Name: 'Germany', Leader: 'Bismarck' } },
    gameStates: {
      5: {
        turn: 5,
        reports: {},
        players: { '1': { Civilization: 'France', Leader: 'Napoleon' } },
        options: {},
      },
    },
    ...overrides,
  };
}

describe('LiveEnvoy.getInitialMessages', () => {
  it('uses the shared game context and appends the hint in normal mode', async () => {
    const params = liveParams();
    const input = thread({ messages: [textMessage('What are your intentions?')] });
    const ctx = createFakeVoxContext().asContext();

    const messages = await spokesperson.getInitialMessages(params, input, ctx);

    // The shared game context message is the same one buildGameContextMessages produces.
    const expectedContext = buildGameContextMessages(params as any)[0];
    expect(messages[0]).toEqual(expectedContext);

    // Normal mode appends the hint (anchors on identity/audience/turn) followed by the
    // agent's default add-on as the last message.
    const last = messages[messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content.startsWith(spokesperson.getHint(params, input))).toBe(true);
    expect(last.content).toContain(spokesperson.getDefaultAddon(params, input));

    // The audience text turn is preserved between context and hint.
    const joined = messages.map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    expect(joined).toContain('What are your intentions?');
  });

  it('filters special-message tokens out of normal transcript history', async () => {
    const params = liveParams();
    const input = thread({
      messages: [
        greetingMessage(), // a prior special token in history
        textMessage('Real question here'),
      ],
    });
    const ctx = createFakeVoxContext().asContext();

    const messages = await spokesperson.getInitialMessages(params, input, ctx);
    const joined = messages.map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n');

    // The special token must not leak into the model context as a visible turn.
    expect(joined).not.toContain('{{{Greeting}}}');
    expect(joined).toContain('Real question here');
  });

  it('appends the greeting special prompt BY REFERENCE in special mode', async () => {
    const params = liveParams();
    const input = thread({ messages: [textMessage('earlier'), greetingMessage()] });
    const ctx = createFakeVoxContext().asContext();

    const messages = await spokesperson.getInitialMessages(params, input, ctx);
    const last = messages[messages.length - 1];

    expect(last.role).toBe('user');
    // The exact prompt string comes from the shared greeting config, included verbatim.
    expect(last.content).toContain(specialMessages['{{{Greeting}}}']);

    // The hint is now always present, even in special mode — followed by the greeting prompt.
    expect(last.content).toContain(spokesperson.getHint(params, input));
    expect(last.content).not.toBe(spokesperson.getHint(params, input));
  });

  it('exposes the {{{Greeting}}} trigger as a base-class default prompt string', () => {
    expect(specialMessages).toHaveProperty('{{{Greeting}}}');
    expect(typeof specialMessages['{{{Greeting}}}']).toBe('string');
    expect(specialMessages['{{{Greeting}}}']).toBeTruthy();
  });
});

describe('LiveEnvoy.prepareStep', () => {
  it('clears active tools in special (greeting) mode', async () => {
    const params = liveParams();
    const input = thread({ messages: [greetingMessage()] });
    const ctx = createFakeVoxContext().asContext();

    const config = await spokesperson.prepareStep(params, input, null, [], [], ctx);
    expect(config.activeTools).toEqual([]);
  });

  it('does not clear active tools in normal mode', async () => {
    const params = liveParams();
    const input = thread({ messages: [textMessage('hello')] });
    const ctx = createFakeVoxContext().asContext();

    const config = await spokesperson.prepareStep(params, input, null, [], [], ctx);
    expect(config.activeTools).not.toEqual([]);
  });
});

describe('LiveEnvoy.getExtraTools', () => {
  it('exposes the get-briefing internal tool', () => {
    const ctx = createFakeVoxContext().asContext();
    const tools = spokesperson.getExtraTools(ctx);
    expect(tools).toHaveProperty('get-briefing');
  });
});
