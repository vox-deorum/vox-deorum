/**
 * Tests for the workspace-traffic compaction in the step loop (src/infra/vox-execute.ts) when the
 * seat `files` setting is on: the once-per-run reminder at 75 percent of the continuity threshold,
 * dropping older bash output at the threshold only after that reminder, never touching the initial
 * prompt, and the single compact-and-retry on the first context-length error within one step. Same mocking idiom as vox-execute-step-budget.test.ts;
 * each agent reports an explicit options.continuityThreshold through the (real) continuityThreshold
 * resolver, and the thresholds are calibrated from countRequestTokens on the step's own messages,
 * so every case lands far from a threshold boundary regardless of how the filler tokenizes.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelMessage } from 'ai';

vi.mock('../../../src/utils/models/models.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/utils/models/models.js')>();
  return { ...actual, getModel: vi.fn(() => ({} as any)), buildProviderOptions: vi.fn(() => ({})) };
});
vi.mock('../../../src/utils/models/concurrency.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/utils/models/concurrency.js')>();
  return { ...actual, streamTextWithConcurrency: vi.fn() };
});

import { VoxContext } from '../../../src/infra/vox-context.js';
import { VoxAgent } from '../../../src/infra/vox-agent.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { streamTextWithConcurrency } from '../../../src/utils/models/concurrency.js';
import { countRequestTokens } from '../../../src/utils/models/token-counter.js';
import { compactionReminder, droppedOutputStub } from '../../../src/utils/prompts/message-history.js';
import { bashToolName } from '../../../src/utils/tools/tool-names.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';
import type { Model } from '../../../src/types/index.js';

const stc = vi.mocked(streamTextWithConcurrency);

/** An agent with a fixed step count, continuity threshold, and initial messages, using the base stopCheck. */
class CompactionAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'context compaction test agent';
  constructor(public readonly name: string, public override maxSteps: number, private readonly threshold: number,
    private readonly initial: ModelMessage[] = []) { super(); }
  /** Selects a mocked model whose options carry this agent's continuity threshold. */
  override getModel(): Model { return { provider: 'test', name: 'test', options: { continuityThreshold: this.threshold } } as Model; }
  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(): Promise<string> { return 'system'; }
  /** Supplies this agent's fixed initial messages, such as an earlier bash trace. */
  override async getInitialMessages(): Promise<ModelMessage[]> { return this.initial; }
}

/** Filler pairs per step output; enough that the fixed prompt overhead stays a small share of one step. */
const outputPairs = 3000;

/** The unique output text a step's bash result carries. */
function stepOutput(index: number): string {
  return `step-${index} output: ` + 'x '.repeat(outputPairs);
}

/** A bash tool-call message plus its tool result with the given output. */
function bashExchange(index: number, output: string): ModelMessage[] {
  return [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `call-${index}`, toolName: bashToolName, input: { command: `echo ${index}` } }] } as unknown as ModelMessage,
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: `call-${index}`, toolName: bashToolName, output: { type: 'text', value: output } }] } as unknown as ModelMessage,
  ];
}

/** The bash traffic one mocked step answers with: a tool-call message plus its large tool result. */
function stepMessages(index: number): ModelMessage[] {
  return bashExchange(index, stepOutput(index));
}

/** A short bash output carried in an initial prompt, as a live envoy's earlier trace would be. */
const initialOutput = 'initial trace output';

/** Estimated tokens one step's response adds to the next request, measured with the loop's own estimator. */
const stepTokens = countRequestTokens(stepMessages(1));

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

/** Record every request and answer with per-step bash traffic, throwing a context-length error on calls where `shouldThrow` says so. */
function recordBashSteps(shouldThrow: (call: number) => boolean = () => false): any[] {
  const configs: any[] = [];
  stc.mockImplementation(async (config: any) => {
    configs.push(config);
    if (shouldThrow(configs.length)) throw new Error('context length exceeded');
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

/** Run one agent execution in a fresh root run, passing the hook as the fifth execute argument. */
function run(ctx: VoxContext<StrategistParameters>, agent: string, onContextLengthError?: () => void) {
  return ctx.withRun({ parameters: makeStrategistParameters() }, () => ctx.execute(agent, {}, undefined, undefined, onContextLengthError));
}

/** How many messages in a recorded request are the compaction reminder. */
function remindersIn(config: any): number {
  return config.messages.filter((message: any) => message.content === compactionReminder).length;
}

/** The tool-result part with the given call id in a recorded request, or undefined. */
function resultOf(config: any, callId: string): any {
  for (const message of config.messages) {
    if (!Array.isArray(message.content)) continue;
    const part = message.content.find((p: any) => p.type === 'tool-result' && p.toolCallId === callId);
    if (part) return part;
  }
  return undefined;
}

/** Whether a recorded request still carries the tool-call part with the given call id. */
function hasToolCall(config: any, callId: string): boolean {
  return config.messages.some((message: any) => Array.isArray(message.content)
    && message.content.some((part: any) => part.type === 'tool-call' && part.toolCallId === callId));
}

/**
 * Agents per case. Each seat's quota equals the agent's step count, so the step limit is that
 * number and the request grows by roughly one stepTokens per step: 1.2x crosses 75 percent but
 * not the threshold after one step; 1.7x stays under 75 percent after one step and jumps past the
 * threshold after two, so it reminds first and compacts a step later; 100x never triggers a
 * size-driven action.
 */
const remind = new CompactionAgent('compact-remind', 2, Math.round(stepTokens * 1.2));
const atThreshold = new CompactionAgent('compact-threshold', 4, Math.round(stepTokens * 1.7), bashExchange(0, initialOutput));
const plain = new CompactionAgent('compact-plain', 3, Math.round(stepTokens * 1.2));
const overflow = new CompactionAgent('compact-overflow', 4, stepTokens * 100);
const secondOverflow = new CompactionAgent('compact-second-overflow', 3, stepTokens * 100);
const overflowNoFiles = new CompactionAgent('compact-overflow-no-files', 2, stepTokens * 100);

beforeAll(() => {
  agentRegistry.register(remind as any);
  agentRegistry.register(atThreshold as any);
  agentRegistry.register(plain as any);
  agentRegistry.register(overflow as any);
  agentRegistry.register(secondOverflow as any);
  agentRegistry.register(overflowNoFiles as any);
});

beforeEach(() => {
  stc.mockReset();
});

describe('workspace traffic compaction in the step loop', () => {
  describe('with files on', () => {
    it('should remind once when the request passes 75 percent of the threshold', async () => {
      const configs = recordBashSteps();
      await run(seat('compact-remind', remind.maxSteps), remind.name);
      expect(configs).toHaveLength(remind.maxSteps);
      // The first step is never measured; the reminder appears before the second step runs.
      expect(remindersIn(configs[0])).toBe(0);
      expect(remindersIn(configs.at(-1))).toBe(1);
    });

    it('should remind a step before the first compaction even when one step jumps past the threshold', async () => {
      const configs = recordBashSteps();
      await run(seat('compact-threshold', atThreshold.maxSteps), atThreshold.name);
      expect(configs).toHaveLength(atThreshold.maxSteps);
      // The first request past the threshold only warns; earlier output is still there to save.
      const warned = configs[2];
      expect(remindersIn(warned)).toBe(1);
      expect(resultOf(warned, 'call-1').output.value).toBe(stepOutput(1));
      expect(resultOf(warned, 'call-2').output.value).toBe(stepOutput(2));
    });

    it('should drop old bash output at the threshold and keep the latest step\'s and the initial prompt\'s', async () => {
      const configs = recordBashSteps();
      await run(seat('compact-threshold', atThreshold.maxSteps), atThreshold.name);
      const compacted = configs.at(-1);
      // Everything before the last step's response is stubbed; that response keeps its output.
      expect(resultOf(compacted, 'call-1').output.value).toBe(droppedOutputStub);
      expect(resultOf(compacted, 'call-2').output.value).toBe(droppedOutputStub);
      expect(resultOf(compacted, 'call-3').output.value).toBe(stepOutput(3));
      // The dropped call itself stays, so its result keeps a valid pair.
      expect(hasToolCall(compacted, 'call-1')).toBe(true);
      // Bash traffic in the initial prompt is never compacted.
      expect(resultOf(compacted, 'call-0').output.value).toBe(initialOutput);
    });

    it('should compact and retry once on the first overflow within the same step', async () => {
      const onContextLengthError = vi.fn();
      const prepareStep = vi.spyOn(overflow, 'prepareStep');
      const configs = recordBashSteps((call) => call === 3);
      await run(seat('compact-overflow', overflow.maxSteps), overflow.name, onContextLengthError);
      // One extra call for the retry, and the run continues to its step limit.
      expect(configs).toHaveLength(overflow.maxSteps + 1);
      // The retry sends the compacted history: earlier bash output stubbed, the latest kept.
      const failed = configs[2];
      const retry = configs[3];
      expect(resultOf(retry, 'call-1').output.value).toBe(droppedOutputStub);
      expect(resultOf(retry, 'call-2').output.value).toBe(stepOutput(2));
      // The retry reuses the failed step's preparation instead of running another step.
      expect(prepareStep).toHaveBeenCalledTimes(overflow.maxSteps);
      expect(retry.messages.at(-1)).toEqual(failed.messages.at(-1));
      expect(onContextLengthError).not.toHaveBeenCalled();
      prepareStep.mockRestore();
    });

    it('should fail as before on a second overflow', async () => {
      const onContextLengthError = vi.fn();
      const configs = recordBashSteps((call) => call >= 3);
      const result = await run(seat('compact-second-overflow', secondOverflow.maxSteps), secondOverflow.name, onContextLengthError);
      // Three calls plus exactly one retry, then the old handling: undefined and the hook.
      expect(configs).toHaveLength(4);
      expect(result).toBeUndefined();
      expect(onContextLengthError).toHaveBeenCalledTimes(1);
    });
  });

  describe('without files', () => {
    it('should not compact without files', async () => {
      const configs = recordBashSteps();
      await run(seat('compact-plain'), plain.name);
      expect(configs).toHaveLength(plain.maxSteps);
      const last = configs.at(-1);
      expect(resultOf(last, 'call-1').output.value).toBe(stepOutput(1));
      expect(resultOf(last, 'call-2').output.value).toBe(stepOutput(2));
      expect(configs.every((config) => remindersIn(config) === 0)).toBe(true);
    });

    it('should not retry an overflow without files', async () => {
      const onContextLengthError = vi.fn();
      const configs = recordBashSteps((call) => call === 2);
      const result = await run(seat('compact-overflow-no-files'), overflowNoFiles.name, onContextLengthError);
      expect(configs).toHaveLength(2);
      expect(result).toBeUndefined();
      expect(onContextLengthError).toHaveBeenCalledTimes(1);
    });

    it('should report the overflowing step and split its request size', async () => {
      const ctx = seat('compact-overflow-no-files');
      const warn = vi.spyOn(ctx.logger, 'warn');
      recordBashSteps((call) => call === 2);
      await run(ctx, overflowNoFiles.name, vi.fn());
      const report = warn.mock.calls.map((call) => call[1] as any).find((meta) => meta?.Step !== undefined);
      expect(report.Step).toBe(2);
      // The initial prompt is only the system text; the history holds step 1's bash traffic.
      expect(report.InitialTokens).toBeGreaterThan(0);
      expect(report.HistoryTokens).toBeGreaterThanOrEqual(stepTokens);
      expect(report.HistoryTokens).toBeGreaterThan(report.InitialTokens);
    });
  });
});
