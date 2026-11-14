/**
 * Tests for cache-breakpoint placement in the step loop (src/agents/runtime/vox-execute.ts) when the seat
 * `files` setting is on: the initial prompt gets exactly one breakpoint on its last message, the
 * prefix through that breakpoint stays byte-stable across steps, a prompt that is already marked or
 * already carries MAX_CACHE_BREAKPOINTS gains no second marker, runs without files add nothing, and
 * the agent's own initial message objects are never mutated. Same mocking idiom as
 * vox-execute-compaction.test.ts; the continuity threshold is set far above any request size here so
 * no step ever reminds early or compacts, isolating the breakpoint behavior under test.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';

vi.mock('../../../src/agents/models/models.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/agents/models/models.js')>();
  return { ...actual, getModel: vi.fn(() => ({} as any)), buildProviderOptions: vi.fn(() => ({})) };
});
vi.mock('../../../src/agents/models/concurrency.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/agents/models/concurrency.js')>();
  return { ...actual, streamTextWithConcurrency: vi.fn() };
});

import { VoxContext } from '../../../src/agents/runtime/vox-context.js';
import { VoxAgent } from '../../../src/agents/runtime/vox-agent.js';
import { agentRegistry } from '../../../src/agents/runtime/agent-registry.js';
import { streamTextWithConcurrency } from '../../../src/agents/models/concurrency.js';
import { bashToolName } from '../../../src/agents/tools/tool-names.js';
import {
  cacheBreakpoint,
  countCacheBreakpoints,
  hasCacheBreakpoint,
  MAX_CACHE_BREAKPOINTS,
} from '../../../src/agents/models/cache-breakpoint.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';
import type { Model } from '../../../src/types/index.js';

const stc = vi.mocked(streamTextWithConcurrency);

/** An agent with a fixed step count and initial messages, declaring bash, using the base stopCheck. */
class CachingAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'context caching test agent';
  constructor(public readonly name: string, public override maxSteps: number, private readonly initial: ModelMessage[] = []) { super(); }
  /** Selects a mocked model whose continuity threshold is far above any request size here. */
  override getModel(): Model { return { provider: 'test', name: 'test', options: { continuityThreshold: 10_000_000 } } as Model; }
  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(): Promise<string> { return 'system'; }
  /** Supplies this agent's fixed initial messages. */
  override async getInitialMessages(): Promise<ModelMessage[]> { return this.initial; }
  /** Declares bash as the run's tool, so the files-on run carries a stable declared set. */
  override getActiveTools(): string[] { return [bashToolName]; }
}

/** A uniquely identifiable unmarked initial message. */
function initialMessage(label: string): ModelMessage {
  return { role: 'user', content: `initial ${label}` };
}

/** A copy of a message carrying a cache breakpoint, as a caller would mark one. */
function marked(message: ModelMessage): ModelMessage {
  return { ...message, providerOptions: { ...message.providerOptions, ...cacheBreakpoint } } as ModelMessage;
}

/** The bash traffic one mocked step answers with: a tool-call message plus its tool result. */
function stepMessages(index: number): ModelMessage[] {
  return [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `call-${index}`, toolName: bashToolName, input: { command: `echo ${index}` } }] } as unknown as ModelMessage,
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: `call-${index}`, toolName: bashToolName, output: { type: 'text', value: `step-${index} output` } }] } as unknown as ModelMessage,
  ];
}

/**
 * A mocked step result carrying step `index`'s bash traffic. It reports the bash call, as a real
 * bash step does, so the empty-reply rescue never runs; bash is not terminal, so the base
 * stopCheck runs to the step limit.
 */
function bashStep(index: number) {
  return {
    steps: [{
      text: '',
      content: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      response: { messages: stepMessages(index) },
      toolCalls: [{ type: 'tool-call', toolCallId: `call-${index}`, toolName: bashToolName, input: { command: `echo ${index}` } }],
      toolResults: [],
    }],
  } as any;
}

/** Record every request and answer with per-step bash traffic. */
function recordBashSteps(): any[] {
  const configs: any[] = [];
  stc.mockImplementation(async (config: any) => {
    configs.push(config);
    return bashStep(configs.length);
  });
  return configs;
}

/** A seat context with the given files quota, or no files when the quota is undefined. */
function seat(id: string, quota?: number): VoxContext<StrategistParameters> {
  const ctx = new VoxContext<StrategistParameters>({}, id);
  if (quota !== undefined) ctx.files = { game: 'write', shared: {}, quota };
  ctx.registerAgentTools();
  return ctx;
}

/** Run one agent execution in a fresh root run. */
function run(ctx: VoxContext<StrategistParameters>, agent: string) {
  return ctx.withRun({ parameters: makeStrategistParameters() }, () => ctx.execute(agent, {}));
}

/** The zero-based index of the last initial message in a request: the system message plus that many initial messages. */
function lastInitialIndex(initialCount: number): number {
  return initialCount;
}

/** The prefix of a recorded request through the message at the given index, inclusive. */
function prefixThrough(config: any, index: number): ModelMessage[] {
  return config.messages.slice(0, index + 1);
}

/**
 * Agents per case. `multi` runs at quota 3 (maxSteps 1 plus files raised to the quota) so the run
 * spans three steps from a two-message initial prompt; `preset` starts with its last initial message
 * already marked; `saturated` starts at the breakpoint ceiling on messages other than the last;
 * `plain` keeps an unmarked prompt for the files-off case.
 */
const multiInitial = [initialMessage('a'), initialMessage('b')];
const multi = new CachingAgent('cache-multi', 1, multiInitial);
const presetInitial = [initialMessage('a'), marked(initialMessage('b'))];
const preset = new CachingAgent('cache-preset', 2, presetInitial);
const saturatedInitial = [
  marked(initialMessage('1')), marked(initialMessage('2')), marked(initialMessage('3')),
  marked(initialMessage('4')), initialMessage('last'),
];
const saturated = new CachingAgent('cache-saturated', 2, saturatedInitial);
const plain = new CachingAgent('cache-plain', 2, [initialMessage('a'), initialMessage('b')]);

beforeAll(() => {
  agentRegistry.register(multi as any);
  agentRegistry.register(preset as any);
  agentRegistry.register(saturated as any);
  agentRegistry.register(plain as any);
});

beforeEach(() => {
  stc.mockReset();
});

describe('prompt cache breakpoint in the step loop', () => {
  describe('with files on', () => {
    it('should put exactly one breakpoint on the last initial message of every step request', async () => {
      const configs = recordBashSteps();
      await run(seat('cache-multi', 3), multi.name);
      expect(configs).toHaveLength(3);
      const bp = lastInitialIndex(multiInitial.length);
      for (const config of configs) {
        expect(countCacheBreakpoints(config.messages)).toBe(1);
        expect(hasCacheBreakpoint(config.messages[bp])).toBe(true);
        expect(config.messages[bp].content).toBe('initial b');
      }
    });

    it('should keep the prompt prefix through the breakpoint byte-stable across steps', async () => {
      const configs = recordBashSteps();
      await run(seat('cache-multi', 3), multi.name);
      const bp = lastInitialIndex(multiInitial.length);
      const first = prefixThrough(configs[0], bp);
      for (const config of configs) {
        expect(prefixThrough(config, bp)).toEqual(first);
      }
    });

    it('should keep the steps-left reminder and all step traffic after the breakpoint', async () => {
      const configs = recordBashSteps();
      await run(seat('cache-multi', 3), multi.name);
      const bp = lastInitialIndex(multiInitial.length);
      // The first request is the marked initial prompt plus its closing reminder, nothing else.
      expect(configs[0].messages).toHaveLength(bp + 2);
      // Later requests only grow after the breakpoint; nothing at or before it differs.
      expect(configs[2].messages.length).toBeGreaterThan(configs[0].messages.length);
      expect(prefixThrough(configs[2], bp)).toEqual(prefixThrough(configs[0], bp));
      // Each request closes with its own unmarked reminder: the countdown text changes with the
      // step while the prefix stays identical, so the varying part can never sit in the cache.
      const closings = configs.map((config) => config.messages.at(-1));
      expect(closings.every((message: any) => message.role === 'user' && !hasCacheBreakpoint(message))).toBe(true);
      expect(closings[0].content).not.toBe(closings[2].content);
    });

    it('should declare the same run tools including bash on every step', async () => {
      const configs = recordBashSteps();
      await run(seat('cache-multi', 3), multi.name);
      expect(configs).toHaveLength(3);
      for (const config of configs) {
        expect(config.activeTools).toContain(bashToolName);
        expect(Object.keys(config.tools)).toContain(bashToolName);
      }
      expect(configs[1].activeTools).toEqual(configs[0].activeTools);
      expect(configs[2].activeTools).toEqual(configs[0].activeTools);
      // The bash definition the provider receives is the same, with no per-step budget in it.
      const bashDefinition = (config: any) => ({
        description: config.tools[bashToolName].description,
        inputSchema: JSON.stringify(config.tools[bashToolName].inputSchema),
      });
      expect(bashDefinition(configs[2])).toEqual(bashDefinition(configs[0]));
    });

    it('should add no second breakpoint when the last initial message is already marked', async () => {
      const configs = recordBashSteps();
      await run(seat('cache-preset', preset.maxSteps), preset.name);
      expect(configs).toHaveLength(preset.maxSteps);
      const bp = lastInitialIndex(presetInitial.length);
      // The input prompt already carries one breakpoint; the count must stay at that one.
      expect(countCacheBreakpoints(presetInitial)).toBe(1);
      for (const config of configs) {
        expect(countCacheBreakpoints(config.messages)).toBe(1);
        expect(hasCacheBreakpoint(config.messages[bp])).toBe(true);
      }
    });

    it('should add no breakpoint when the initial prompt already carries the maximum', async () => {
      const configs = recordBashSteps();
      await run(seat('cache-saturated', saturated.maxSteps), saturated.name);
      expect(configs).toHaveLength(saturated.maxSteps);
      expect(countCacheBreakpoints(saturatedInitial)).toBe(MAX_CACHE_BREAKPOINTS);
      const bp = lastInitialIndex(saturatedInitial.length);
      for (const config of configs) {
        // The ceiling holds: the four input markers are kept and no fifth is added on the last.
        expect(countCacheBreakpoints(config.messages)).toBe(MAX_CACHE_BREAKPOINTS);
        expect(hasCacheBreakpoint(config.messages[bp])).toBe(false);
      }
    });

    it('should leave the agent\'s own initial message objects unmutated', async () => {
      const configs = recordBashSteps();
      await run(seat('cache-multi', 3), multi.name);
      // The agent's array elements never gain the marker, even after the run.
      expect(multiInitial.every((message) => !hasCacheBreakpoint(message))).toBe(true);
      expect(multiInitial[1].providerOptions).toBeUndefined();
      // The request carries an annotated copy of the last initial message instead.
      const bp = lastInitialIndex(multiInitial.length);
      expect(configs[0].messages[bp]).not.toBe(multiInitial[1]);
      expect(configs[0].messages[bp].content).toBe(multiInitial[1].content);
      expect(hasCacheBreakpoint(configs[0].messages[bp])).toBe(true);
    });
  });

  describe('without files', () => {
    it('should add no breakpoint to an unmarked initial prompt', async () => {
      const configs = recordBashSteps();
      await run(seat('cache-plain'), plain.name);
      expect(configs).toHaveLength(plain.maxSteps);
      for (const config of configs) {
        expect(countCacheBreakpoints(config.messages)).toBe(0);
      }
    });
  });
});
