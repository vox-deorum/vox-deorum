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
    // agent's default add-on as the last message — delivered as a system (operator) message.
    const last = messages[messages.length - 1];
    expect(last.role).toBe('system');
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

    // The hint + special add-on are delivered as a single system (operator) message.
    expect(last.role).toBe('system');
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

describe('LiveEnvoy.getInitialMessages past/ongoing split (cache-aware record)', () => {
  /** A hydrated row carrying a durable store id. */
  function hydrated(id: number, role: 'user' | 'assistant', content: string, turn: number): MessageWithMetadata {
    return { message: { role, content } as any, metadata: { datetime: new Date(0), turn, id } };
  }

  it('compiles rows at or before the open mark into one labeled block and keeps later rows native', async () => {
    const params = liveParams();
    const input = thread({
      pastMessageID: 2,
      messages: [
        hydrated(1, 'user', 'What are your borders?', 3),
        hydrated(2, 'assistant', 'They are settled.', 3),
        hydrated(4, 'user', 'Let us talk again.', 5),
        { message: { role: 'assistant', content: 'Gladly.' }, metadata: { datetime: new Date(0), turn: 5 } },
      ],
    });
    const ctx = createFakeVoxContext().asContext();

    const messages = await spokesperson.getInitialMessages(params, input, ctx);

    // ONE stable user message compiles the settled past: turn-aware, speaker-aware, breakpointed.
    const past = messages.find((m: any) => typeof m.content === 'string' && m.content.startsWith('The conversation so far'));
    expect(past).toBeDefined();
    expect(past.role).toBe('user');
    expect(past.content).toContain('# Turn 3');
    expect(past.content).toContain('> Rome, the leader (the counterpart): What are your borders?');
    expect(past.content).toContain('> Germany, the spokesperson (me): They are settled.');
    expect(past.content).not.toContain('Let us talk again.');
    expect(past.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });

    // Rows after the mark render as native messages with [Turn N] speaker labels.
    const ongoing = messages.filter((m: any) => typeof m.content === 'string' && m.content.startsWith('[Turn'));
    expect(ongoing.map((m: any) => m.content)).toEqual([
      '[Turn 5] Rome, the leader: Let us talk again.',
      '[Turn 5] Germany, the spokesperson: Gladly.',
    ]);
    // The last static breakpoint rides the LAST ongoing message only.
    expect(ongoing[1].providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    expect(ongoing[0].providerOptions?.anthropic?.cacheControl).toBeUndefined();
  });

  it('emits no past block when the thread has no open mark (everything ongoing)', async () => {
    const params = liveParams();
    const input = thread({ messages: [textMessage('hello there')] });
    const ctx = createFakeVoxContext().asContext();

    const messages = await spokesperson.getInitialMessages(params, input, ctx);
    expect(messages.some((m: any) => typeof m.content === 'string' && m.content.startsWith('The conversation so far'))).toBe(false);
    const joined = messages.map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    expect(joined).toContain('[Turn 5] Rome, the leader: hello there');
  });

  it('filters special tokens on both sides of the split without misaligning the boundary', async () => {
    const params = liveParams();
    const input = thread({
      pastMessageID: 1,
      messages: [
        hydrated(1, 'user', 'old line', 3),
        greetingMessage(), // live-pushed trigger: no id → ongoing; filtered from the prompt
        { message: { role: 'user', content: 'real question' }, metadata: { datetime: new Date(0), turn: 5 } },
      ],
    });
    const ctx = createFakeVoxContext().asContext();

    const messages = await spokesperson.getInitialMessages(params, input, ctx);
    const joined = JSON.stringify(messages);
    expect(joined).not.toContain('{{{Greeting}}}');
    const past = messages.find((m: any) => typeof m.content === 'string' && m.content.startsWith('The conversation so far'));
    expect(past.content).toContain('old line');
    expect(joined).toContain('real question');
  });
});

describe('Envoy.speakerLabel', () => {
  it('labels civ + role, falls back to civ alone, then to Player N', () => {
    const t = thread();
    expect(spokesperson.speakerLabel(t, 3)).toBe('Germany, the spokesperson');
    expect(spokesperson.speakerLabel(t, 1)).toBe('Rome, the leader'); // role already phrased with "the"
    const bare = thread({ player1Role: undefined });
    expect(spokesperson.speakerLabel(bare, 1)).toBe('Rome');
    const anon = thread({ player1Identity: undefined, player1Role: undefined });
    expect(spokesperson.speakerLabel(anon, 1)).toBe('Player 1');
  });
});

describe('LiveEnvoy.prepareStep', () => {
  it('restricts active tools to send-message in special (greeting) mode', async () => {
    const params = liveParams();
    const input = thread({ messages: [greetingMessage()] });
    const ctx = createFakeVoxContext().asContext();

    // With the tool force honored on the deployed model an empty set would be uncompliable; the
    // greeting speaks through send-message like any other reply.
    const config = await spokesperson.prepareStep(params, input, null, [], [], ctx);
    expect(config.activeTools).toEqual(['send-message']);
  });

  it('does not restrict active tools in normal mode', async () => {
    const params = liveParams();
    const input = thread({ messages: [textMessage('hello')] });
    const ctx = createFakeVoxContext().asContext();

    const config = await spokesperson.prepareStep(params, input, null, [], [], ctx);
    expect(config.activeTools).not.toEqual(['send-message']);
  });
});

describe('LiveEnvoy prompt-cache reuse between runs at the same turn', () => {
  // A committed (hydrated) row carrying a durable store id — the settled past.
  const stored = (id: number, role: 'user' | 'assistant', content: string, turn = 5): MessageWithMetadata =>
    ({ message: { role, content } as any, metadata: { datetime: new Date(0), turn, id } });
  // A live-pushed row (no store id yet): the counterpart's incoming question, last ongoing row of a run.
  const incoming = (content: string): MessageWithMetadata =>
    ({ message: { role: 'user', content }, metadata: { datetime: new Date(0), turn: 5 } });
  // A committed reply row appended after a run (optionally carrying the run's memory-only native trace).
  const reply = (content: string, trace?: unknown[]): MessageWithMetadata =>
    ({ message: { role: 'assistant', content }, metadata: { datetime: new Date(0), turn: 5, ...(trace ? { trace: trace as any } : {}) } });

  const R1_INCOMING = 'What is your view on the pact?';
  const BOUNDARY = `[Turn 5] Rome, the leader: ${R1_INCOMING}`; // R1's last committed row, rendered
  const bpOf = (m: any) => m?.providerOptions?.anthropic?.cacheControl;
  const byContent = (msgs: any[], content: string) => msgs.find((m: any) => m.content === content);

  /** A thread at turn 5 with a settled past (ids ≤ mark) and the counterpart's incoming question. */
  const openThread = () => thread({
    pastMessageID: 2,
    messages: [
      stored(1, 'user', 'What are your borders?', 3),
      stored(2, 'assistant', 'They are settled.', 3),
      incoming(R1_INCOMING),
    ],
  });

  it("reuses the whole record up to the previous run's last committed row (single-step)", async () => {
    const params = liveParams();
    const ctx = createFakeVoxContext().asContext();
    const input = openThread();

    const r1 = await spokesperson.getInitialMessages(params, input, ctx);
    // Commit R1 (single-step): the run collapses to one archived reply appended after the question.
    input.messages.push(reply('We seek a lasting peace.'));
    // R2 at the SAME turn: a new question arrives; every prior row is untouched.
    input.messages.push(incoming('And the border along the river?'));
    const r2 = await spokesperson.getInitialMessages(params, input, ctx);

    // Everything BEFORE R1's last committed row — game context (+its breakpoint), game state, and the
    // compiled past block (+its breakpoint) — is deep-equal, so those cache anchors R1 wrote still hit.
    const b1 = r1.findIndex((m: any) => m.content === BOUNDARY);
    const b2 = r2.findIndex((m: any) => m.content === BOUNDARY);
    expect(r2.slice(0, b2)).toEqual(r1.slice(0, b1));
    // R1's last committed row itself is byte-identical in content — so the cache R1 wrote up to and
    // including it is reusable by R2.
    expect(r2[b2].content).toEqual(r1[b1].content);

    // The moving anchor is simply "the last committed row of THIS run": R1 breakpoints its incoming
    // question, R2 its own new one. Lookup matches by content, so this relocation costs nothing.
    expect(bpOf(byContent(r1, BOUNDARY))).toEqual({ type: 'ephemeral' });
    expect(bpOf(byContent(r2, BOUNDARY))).toBeUndefined();
    expect(bpOf(byContent(r2, '[Turn 5] Rome, the leader: And the border along the river?'))).toEqual({ type: 'ephemeral' });
  });

  it('keeps the prefix stable when the previous run was multi-step (its reply carries reasoning)', async () => {
    const params = liveParams();
    const ctx = createFakeVoxContext().asContext();
    const input = openThread();

    const r1 = await spokesperson.getInitialMessages(params, input, ctx);
    // R1 was a get-briefing → send-message run: the chat-turn commit collapses the tool traffic to one
    // archived reply and retains the full native trajectory on its (memory-only) metadata.
    const trace = [
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'They sound wary.', providerOptions: { anthropic: { signature: 's1' } } },
        { type: 'tool-call', toolName: 'get-briefing', toolCallId: 'b1', input: {} },
      ] },
      { role: 'tool', content: [
        { type: 'tool-result', toolName: 'get-briefing', toolCallId: 'b1', output: { type: 'text', value: 'Military: strong.' } },
      ] },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'Offer reassurance.' }] },
    ];
    input.messages.push(reply('We seek a lasting peace.', trace));
    input.messages.push(incoming('And the border along the river?'));
    const r2 = await spokesperson.getInitialMessages(params, input, ctx);

    // The cacheable prefix up to R1's incoming question is byte-identical despite R1 being multi-step:
    // the retained trace sits AFTER the boundary, so it cannot perturb what R1 already cached.
    const b1 = r1.findIndex((m: any) => m.content === BOUNDARY);
    const b2 = r2.findIndex((m: any) => m.content === BOUNDARY);
    expect(r2.slice(0, b2)).toEqual(r1.slice(0, b1));
    expect(r2[b2].content).toEqual(r1[b1].content);

    // The retained trajectory replays verbatim ahead of the collapsed reply: the signed get-briefing
    // reasoning + call, its PAIRED tool-result, then the turn/speaker-prefixed spoken row. Unprefixed
    // and byte-stable, so a later run caches it consistently too.
    const briefingCall = r2.find((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === 'tool-call' && p.toolName === 'get-briefing'));
    expect(briefingCall.role).toBe('assistant');
    expect(briefingCall.content[0].providerOptions).toEqual({ anthropic: { signature: 's1' } });
    expect(JSON.stringify(briefingCall)).not.toContain('[Turn');
    expect(r2.some((m: any) => m.role === 'tool' && Array.isArray(m.content) && m.content.some((p: any) => p.type === 'tool-result' && p.toolCallId === 'b1'))).toBe(true);
    expect(byContent(r2, '[Turn 5] Germany, the spokesperson: We seek a lasting peace.')).toBeDefined();
    // Expected best-effort gap (see convertToModelMessages): a carryOverTrace miss on re-hydration
    // drops the trace and renders this row as plain [text], costing a one-time cache miss we accept.
  });
});

describe('LiveEnvoy.stopCheck (shared completion logic via Spokesperson)', () => {
  const parameters = { turn: 5 } as any;

  /** Minimal AI SDK step shape consumed by Envoy + LiveEnvoy stop checks. */
  function step(text = '', toolNames: string[] = []) {
    return {
      text,
      toolCalls: toolNames.map(toolName => ({ toolName })),
      toolResults: [],
      response: { messages: [{ role: 'assistant', content: text }] },
    } as any;
  }

  it('stops once the spokesperson speaks through send-message', () => {
    const ctx = createFakeVoxContext().asContext();
    const spoke = step('', ['send-message']);
    expect(spokesperson.stopCheck(parameters, thread(), spoke, [spoke], ctx)).toBe(true);
  });

  it('keeps working while a support tool is pending, below the ceiling', () => {
    const ctx = createFakeVoxContext().asContext();
    const briefing = step('', ['get-briefing']);
    expect(spokesperson.stopCheck(parameters, thread(), briefing, [briefing], ctx)).toBe(false);
  });

  it('stops at the shared hard step ceiling (maxSteps = 10)', () => {
    const ctx = createFakeVoxContext().asContext();
    const steps = Array.from({ length: 10 }, () => step('', ['get-briefing']));
    expect(spokesperson.stopCheck(parameters, thread(), steps[9], steps, ctx)).toBe(true);
  });

  it('strips echoed turn markers and self labels from spoken output before recording it', () => {
    const ctx = createFakeVoxContext().asContext();
    const input = thread();
    const echoStep = {
      text: '', toolCalls: [{ toolName: 'send-message' }], toolResults: [],
      response: { messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: '[Turn 5] Germany, the spokesperson: narration' },
          { type: 'tool-call', toolCallId: 't1', toolName: 'send-message', input: { Message: '[Turn 5] Germany, the spokesperson: We accept.' } },
        ],
      }] },
    } as any;

    spokesperson.stopCheck({ turn: 5 } as any, input, echoStep, [echoStep], ctx);

    // Both the text part and the delivered/archived Message argument lose the scaffolding echo.
    const recorded = input.messages[0].message.content as any[];
    expect(recorded[0].text).toBe('narration');
    expect(recorded[1].input.Message).toBe('We accept.');
  });

  it('does not stop on raw free text: a live envoy speaks only through send-message', () => {
    const ctx = createFakeVoxContext().asContext();
    const spoken = step('We share your hope for peace.');
    // Tools are forced (toolChoice="required"), so raw free text is never an authoritative reply
    // (see LiveEnvoy.suppressFreeText) and does not end the turn; only a completion tool does.
    expect(spokesperson.stopCheck(parameters, thread(), spoken, [spoken], ctx)).toBe(false);
  });
});

describe('Envoy.convertToModelMessages (send-message archival → context)', () => {
  /** An assistant message-with-metadata carrying the given content. */
  function assistant(content: unknown, turn = 4): MessageWithMetadata {
    return { message: { role: 'assistant', content } as any, metadata: { datetime: new Date(0), turn } };
  }

  /** A tool message-with-metadata carrying the given tool-result parts. */
  function toolMessage(content: unknown, turn = 4): MessageWithMetadata {
    return { message: { role: 'tool', content } as any, metadata: { datetime: new Date(0), turn } };
  }

  it('keeps the send-message tool-call part but drops its "Message delivered." tool-result', () => {
    const messages: MessageWithMetadata[] = [
      assistant([
        { type: 'text', text: 'I will respond.' },
        { type: 'tool-call', toolCallId: 't1', toolName: 'send-message', input: { Message: 'We accept.' } },
      ]),
      toolMessage([
        { type: 'tool-result', toolCallId: 't1', toolName: 'send-message', output: { type: 'text', value: 'Message delivered.' } },
      ]),
    ];

    const result = spokesperson.convertToModelMessages(messages);

    // The tool message is dropped entirely (its only result was the send-message confirmation).
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    const parts = result[0].content as any[];
    // The send-message tool-call part survives so the model's history shows it spoke by calling it.
    expect(parts.some(p => p.type === 'tool-call' && p.toolName === 'send-message')).toBe(true);
    expect(parts.some(p => p.type === 'text')).toBe(true);
    // The confirmation never resurfaces as a user line.
    const joined = JSON.stringify(result);
    expect(joined).not.toContain('Message delivered.');
  });

  it('replays the memory-only native trace verbatim ahead of a normalized reply row', () => {
    const trace = [
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'They seem worried.', providerOptions: { anthropic: { signature: 's1' } } },
        { type: 'tool-call', toolName: 'get-briefing', toolCallId: 'b1', input: {} },
      ] },
      { role: 'tool', content: [
        { type: 'tool-result', toolName: 'get-briefing', toolCallId: 'b1', output: { type: 'text', value: 'Military: strong.' } },
      ] },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'Press the advantage.' }] },
    ];
    const messages: MessageWithMetadata[] = [{
      message: { role: 'assistant', content: 'We accept your terms.' },
      metadata: { datetime: new Date(0), turn: 4, trace: trace as never },
    }];

    const result = spokesperson.convertToModelMessages(messages);

    // The trace rows replay verbatim (UNprefixed, signatures + tool_use/tool_result pairing intact),
    // then the collapsed spoken row with its [Turn N] prefix appended last.
    expect(result.map((m: any) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'assistant']);
    expect((result[0].content as any)[0].providerOptions).toEqual({ anthropic: { signature: 's1' } });
    expect((result[0].content as any)[1]).toMatchObject({ type: 'tool-call', toolName: 'get-briefing', toolCallId: 'b1' });
    expect((result[1].content as any)[0]).toMatchObject({ type: 'tool-result', toolCallId: 'b1' });
    expect(JSON.stringify(result[0])).not.toContain('[Turn');
    const spokenRow = result[result.length - 1];
    expect(spokenRow.content).toBe('[Turn 4] We accept your terms.');
    // The cached row and its trace are never mutated by rendering.
    expect(messages[0].message.content).toBe('We accept your terms.');
    expect((messages[0].metadata.trace as any)[0].content[0].text).toBe('They seem worried.');
  });

  it('keeps native reasoning parts of raw assistant rows (observer threads)', () => {
    const messages: MessageWithMetadata[] = [
      assistant([
        { type: 'reasoning', text: 'thinking...' },
        { type: 'text', text: 'Spoken aloud.' },
      ]),
    ];

    const result = spokesperson.convertToModelMessages(messages);

    const parts = result[0].content as any[];
    expect(parts.some((p: any) => p.type === 'reasoning' && p.text === 'thinking...')).toBe(true);
    expect(parts.some((p: any) => p.type === 'text')).toBe(true);
  });

  it('still summarizes a non-send-message tool-result, dropping only the send-message one', () => {
    const messages: MessageWithMetadata[] = [
      toolMessage([
        { type: 'tool-result', toolCallId: 't1', toolName: 'send-message', output: { type: 'text', value: 'Message delivered.' } },
        { type: 'tool-result', toolCallId: 't2', toolName: 'get-briefing', output: { type: 'text', value: 'Military: strong.' } },
      ]),
    ];

    const result = spokesperson.convertToModelMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain('Military: strong.');
    expect(result[0].content).not.toContain('Message delivered.');
  });
});

describe('LiveEnvoy.getExtraTools', () => {
  it('exposes the get-briefing internal tool', () => {
    const ctx = createFakeVoxContext().asContext();
    const tools = spokesperson.getExtraTools(ctx);
    expect(tools).toHaveProperty('get-briefing');
  });
});
