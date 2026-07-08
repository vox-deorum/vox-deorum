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

  it.each(['send-message', 'call-negotiator', 'close-conversation'])(
    'stops when the current step calls the completion tool %s regardless of its result',
    toolName => {
      const input = thread();
      const context = createFakeVoxContext().asContext();
      const terminal = step('', [toolName]);
      terminal.toolResults = [{ toolName, output: 'Failed or unavailable.' }];

      expect(diplomat.stopCheck(parameters, input, terminal, [terminal], context)).toBe(true);
    }
  );

  it('stops when a step speaks and hands off in the same step (send-message + call-negotiator)', () => {
    const context = createFakeVoxContext().asContext();
    // The model may speak and hand the deal to the negotiator in one step; either alone ends the turn,
    // so the pair certainly does.
    const both = step('', ['send-message', 'call-negotiator']);

    expect(diplomat.stopCheck(parameters, thread(), both, [both], context)).toBe(true);
  });

  it('stops at the hard step ceiling even with a support tool still pending', () => {
    const input = thread();
    const context = createFakeVoxContext().asContext();
    // Ten consecutive support-tool steps with nothing spoken: a runaway loop. The ceiling (maxSteps=10)
    // is checked before the keep-working branch, so even a pending support tool cannot extend it.
    const steps = Array.from({ length: 10 }, () => step('', ['get-briefing']));

    expect(diplomat.stopCheck(parameters, input, steps[8], steps.slice(0, 9), context)).toBe(false);
    expect(diplomat.stopCheck(parameters, input, steps[9], steps, context)).toBe(true);
  });

  it('does not end the turn on raw free text: the diplomat speaks only through send-message', () => {
    const context = createFakeVoxContext().asContext();
    const whitespace = step('   ');
    const spoken = step('We welcome further discussion.');

    // Tools are forced (toolChoice="required"), so raw free text is never an authoritative reply
    // (see LiveEnvoy.suppressFreeText): neither an empty line nor a spoken one ends the turn.
    expect(diplomat.stopCheck(parameters, thread(), whitespace, [whitespace], context)).toBe(false);
    expect(diplomat.stopCheck(parameters, thread(), spoken, [spoken], context)).toBe(false);
  });

  it('keeps working after free text, whether a supporting tool is pending or not', () => {
    const input = thread();
    const context = createFakeVoxContext().asContext();
    const spoken = step('That proposal has merit.');
    const laterTool = step('', ['call-diplomatic-analyst']);

    // A pending supporting tool after a short speech keeps the diplomat working...
    expect(diplomat.stopCheck(parameters, input, laterTool, [spoken, laterTool], context)).toBe(false);
    // ...and once that tool resolves with nothing pending, the earlier free text still does not end
    // the turn — only a completion tool (send-message / negotiator / closure) or the ceiling does.
    const done = step('');
    expect(diplomat.stopCheck(parameters, input, done, [spoken, laterTool, done], context)).toBe(false);
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

describe('Diplomat.stopCheck malformed terminal retry (retryMalformedTerminalCalls)', () => {
  /** A step whose named calls can be individually marked invalid (malformed input that never ran). */
  function invalidStep(calls: Array<{ toolName: string; invalid?: boolean }>, text = '') {
    return {
      text,
      toolCalls: calls,
      toolResults: [],
      response: { messages: [{ role: 'assistant', content: text }] },
    } as any;
  }
  const context = () => createFakeVoxContext().asContext();

  it('keeps working when the only completion call is malformed (below the ceiling)', () => {
    // A malformed call-negotiator never executed; the turn stays open so the model can redo the handoff
    // rather than ending on an action that never happened.
    const bad = invalidStep([{ toolName: 'call-negotiator', invalid: true }]);
    expect(diplomat.stopCheck(parameters, thread(), bad, [bad], context())).toBe(false);
  });

  it('keeps working when a valid send-message and a malformed call-negotiator share a step', () => {
    // The mixed step the toggle targets: the line was spoken, but the handoff was malformed. Before the
    // toggle the valid send-message ended the turn and dropped the handoff; now the turn stays open.
    const mixed = invalidStep([{ toolName: 'send-message' }, { toolName: 'call-negotiator', invalid: true }]);
    expect(diplomat.stopCheck(parameters, thread(), mixed, [mixed], context())).toBe(false);
  });

  it('still stops at the hard step ceiling even when the last completion call is malformed', () => {
    // The retry is bounded by maxSteps (10): below it the malformed call keeps the turn open; at it, stop.
    const bad = () => invalidStep([{ toolName: 'call-negotiator', invalid: true }]);
    const nine = Array.from({ length: 9 }, bad);
    expect(diplomat.stopCheck(parameters, thread(), nine[8], nine, context())).toBe(false);
    const ten = Array.from({ length: 10 }, bad);
    expect(diplomat.stopCheck(parameters, thread(), ten[9], ten, context())).toBe(true);
  });

  it('is unchanged for a well-formed completion step (still stops)', () => {
    const spoke = invalidStep([{ toolName: 'send-message' }]);
    expect(diplomat.stopCheck(parameters, thread(), spoke, [spoke], context())).toBe(true);
  });
});
