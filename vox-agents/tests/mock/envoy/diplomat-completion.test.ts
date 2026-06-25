/**
 * Tests for the diplomat's conversation-completion rule. The diplomat may use supporting tools
 * for as many steps as needed, but completes only after speaking, calling the negotiator, or
 * closing the conversation. Envoy transcript persistence still runs on every checked step.
 */

import { describe, expect, it } from 'vitest';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import type { EnvoyThread } from '../../../src/types/index.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';

const diplomat = agentRegistry.get('diplomat') as any;

/** Build a diplomacy thread voiced by Germany's diplomat. */
function thread(): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    player1Identity: { name: 'Rome', leader: 'Caesar' },
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    diplomacy: true,
  };
}

/** Build the minimal AI SDK step shape consumed by Envoy and Diplomat stop checks. */
function step(text = '', toolNames: string[] = [], responseText = text) {
  return {
    text,
    toolCalls: toolNames.map(toolName => ({ toolName })),
    toolResults: [],
    response: {
      messages: [{ role: 'assistant', content: responseText }],
    },
  } as any;
}

const parameters = { turn: 7 } as any;

describe('Diplomat.stopCheck', () => {
  it('continues after supporting tools without text even beyond the generic maximum', () => {
    const input = thread();
    const context = createFakeVoxContext().asContext();
    const steps = [
      step('', ['get-briefing']),
      step('', ['get-diplomatic-events']),
      step('', ['call-diplomatic-analyst']),
      step('', ['get-briefing']),
    ];

    expect(diplomat.stopCheck(parameters, input, steps[3], steps, context)).toBe(false);
  });

  it.each(['call-negotiator', 'close-conversation'])(
    'stops when the current step calls %s regardless of its result',
    toolName => {
      const input = thread();
      const context = createFakeVoxContext().asContext();
      const terminal = step('', [toolName]);
      terminal.toolResults = [{ toolName, output: 'Failed or unavailable.' }];

      expect(diplomat.stopCheck(parameters, input, terminal, [terminal], context)).toBe(true);
    }
  );

  it('stops on non-whitespace free text but not whitespace-only text', () => {
    const context = createFakeVoxContext().asContext();
    const whitespace = step('   ');
    const spoken = step('We welcome further discussion.');

    expect(diplomat.stopCheck(parameters, thread(), whitespace, [whitespace], context)).toBe(false);
    expect(diplomat.stopCheck(parameters, thread(), spoken, [spoken], context)).toBe(true);
  });

  it('does not stop when a supporting tool is requested after free text', () => {
    const input = thread();
    const context = createFakeVoxContext().asContext();
    const spoken = step('That proposal has merit.');
    const laterTool = step('', ['call-diplomatic-analyst']);

    // A pending supporting tool after a short speech keeps the diplomat working...
    expect(diplomat.stopCheck(parameters, input, laterTool, [spoken, laterTool], context)).toBe(false);
    // ...and once that tool resolves and nothing is left pending, the earlier speech ends the turn.
    const done = step('');
    expect(diplomat.stopCheck(parameters, input, done, [spoken, laterTool, done], context)).toBe(true);
  });

  it('does not stop when a step both speaks and requests a supporting tool', () => {
    const context = createFakeVoxContext().asContext();
    const both = step('A brief word.', ['get-briefing']);

    expect(diplomat.stopCheck(parameters, thread(), both, [both], context)).toBe(false);
  });

  it.each(['call-negotiator', 'close-conversation'])(
    'stops when a previous step already called %s',
    toolName => {
      const input = thread();
      const context = createFakeVoxContext().asContext();
      const terminal = step('', [toolName]);
      const laterTool = step('', ['get-briefing']);

      expect(diplomat.stopCheck(parameters, input, laterTool, [terminal, laterTool], context)).toBe(true);
    }
  );

  it('persists every checked response through the envoy transcript behavior', () => {
    const input = thread();
    const context = createFakeVoxContext().asContext();
    const first = step('', ['get-briefing'], '   ');
    const second = step('', ['call-diplomatic-analyst'], '');

    expect(diplomat.stopCheck(parameters, input, first, [first], context)).toBe(false);
    expect(diplomat.stopCheck(parameters, input, second, [first, second], context)).toBe(false);
    expect(input.messages).toHaveLength(2);
    expect(input.messages.map(message => message.metadata.turn)).toEqual([7, 7]);
    expect(input.messages.map(message => message.message)).toEqual([
      first.response.messages[0],
      second.response.messages[0],
    ]);
  });
});
