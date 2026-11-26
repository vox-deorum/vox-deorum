/**
 * @module newspaper/desk/generate
 *
 * Runs one in-memory writing batch for the Newspaper Writing Desk. Each request
 * covers chunks of variants that share a style and is sent to every selected
 * chat model, either a configured alias or a provider-qualified model ID.
 * The newest 30 candidates per variant stay in memory until cleared or the
 * variant is settled or reopened. Stopping a job drops only later replies.
 */
import { config } from '../../agents/config/load.js';
import { buildProviderOptions, getModel, getModelConfig } from '../../agents/models/models.js';
import { formatModelReference, parseModelReference } from '../../agents/models/model-reference.js';
import { ensureModelsResolved, getRuntimeModel } from '../../agents/models/resolution.js';
import { synthesizeModelConfig } from '../../agents/models/rules.js';
import { stripJsonFence } from '../../agents/models/text-cleaning.js';
import { streamTextWithConcurrency, withModelConfig } from '../../agents/models/concurrency.js';
import type { ConcurrencyContext } from '../../agents/models/concurrency.js';
import type { StepTokenUsage } from '../../agents/telemetry/model-usage.js';
import { openAgentSpan, openStepSpan, recordSpanError } from '../../agents/runtime/vox-telemetry.js';
import type {
  DeskCandidate,
  DeskGenerateRequest,
  DeskJob,
  DeskRef,
  DeskText,
} from '../../types/api.js';
import { isKnownNonChatModel } from '../../types/constants.js';
import { createLogger } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errors.js';
import { Output } from 'ai';
import type { ModelMessage, StepResult, ToolSet } from 'ai';
import { context, ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api';
import { deskTracer } from '../../instrumentation.js';
import { z } from 'zod';
// @ts-expect-error - jaison doesn't have type definitions
import jaison from 'jaison';
import {
  briefView,
  chunkByStyle,
  findDeskVariant,
  renderBrief,
} from './brief.js';
import { deskChoicesLimit, deskRefKey } from './batch.js';
import { DeskError, readDeskCatalogue } from './catalogue.js';
import type { DeskCatalogue } from './catalogue.js';
import { normalizeParagraphs } from './paragraphs.js';
import { repairCopy } from './repair.js';
import { deskMessages, deskTelemetryContextId, recordDeskReply, recordDeskUsage } from './telemetry.js';
import type { DeskRequestOutcome } from './telemetry.js';
import { candidateWarnings, templateVariables } from './variables.js';

/** Newest candidates kept for each variant. */
export const deskCandidateLimit = 30;

/** One model call prepared by a job. */
export interface DeskWriteRequest {
  model: string;
  refs: DeskRef[];
  choices: number;
  prompt: string;
  signal: AbortSignal;
  messages: ModelMessage[];
  /** Preserve the full step for telemetry, including steps that fail parsing. */
  recordReply: (step: StepResult<ToolSet>) => void;
}

/** A prepared model request before it is assigned the job's cancellation signal. */
interface DeskTask {
  model: string;
  chunk: DeskRef[];
  choices: number;
  prompt: string;
}

/** Raw choices returned by a model for one request. */
export interface DeskWriteReply {
  variants: {
    templateId: string;
    variantId: string;
    choices: WriterChoice[];
  }[];
  tokens?: { input?: number; output?: number };
}

/** Injectable model-call seam used by the desk and by tests. */
export type DeskWriter = (request: DeskWriteRequest) => Promise<DeskWriteReply>;

/** Thrown when a second batch is started while one is still running. */
export class DeskJobRunningError extends DeskError {
  readonly code = 'desk-job-running';

  /** Report a conflict when a batch is already in flight. */
  constructor() {
    super(409, 'A writing desk job is already running. Stop it before starting another.');
    this.name = 'DeskJobRunningError';
  }
}

const logger = createLogger('newspaper-desk');
const telemetryHost = { tracer: deskTracer, id: deskTelemetryContextId };
const writerAgentName = 'newspaper-writer';

const structuredChoiceSchema = z.object({
  headline: z.string(),
  subheadline: z.string().nullable(),
  byline: z.string().nullable(),
  body: z.array(z.string()).describe('Each string is one paragraph.'),
});
const writerChoiceSchema = structuredChoiceSchema.partial({ subheadline: true, byline: true });
type WriterChoice = z.infer<typeof writerChoiceSchema>;

const rawVariantSchema = z.object({
  templateId: z.string().min(1),
  variantId: z.string().min(1),
  choices: z.array(z.unknown()),
});
/** Describe the provider response format. The parser validates each choice separately. */
const writerReplySchema = z.object({ variants: z.array(rawVariantSchema.extend({ choices: z.array(structuredChoiceSchema) })) });
const rawReplySchema = z.object({ variants: z.array(z.unknown()) });

/** Candidates for every variant, keyed by the stable template/variant tuple. */
const candidates = new Map<string, DeskCandidate[]>();
/** Mutation epoch per variant, so work started before a clear cannot land afterwards. */
const generations = new Map<string, number>();
/** The current or most recent job, including a stopped or failed one. */
let currentJob: DeskJob | null = null;
/** The controller for the running job, if any. */
let currentController: AbortController | null = null;
/** Batches still draining, including stopped batches superseded by a new job. */
const pendingRuns = new Set<Promise<void>>();
/** Monotonic job counter, so IDs stay unique without a UUID dependency. */
let jobCounter = 0;

/** Read the configured aliases that can answer chat requests. */
export function deskModelNames(): string[] {
  return Object.keys(config.llms).filter(isChatModelReference);
}

/**
 * Follow one alias chain or provider-qualified reference and reject embedding,
 * evaluation and cyclic targets. A discovered provider-qualified model passes
 * the preflight check until resolution records whether it is a chat model.
 */
function isChatModelReference(name: string): boolean {
  const visited = new Set<string>();
  let current = name;
  for (;;) {
    if (visited.has(current)) return false;
    visited.add(current);
    if (current === 'embedder' || current === 'evaluator' || current.endsWith('.evaluator')) return false;
    const entry = Object.hasOwn(config.llms, current) ? config.llms[current] : undefined;
    if (entry === undefined) {
      const { fullKey, provider, name } = parseModelReference(current);
      if (fullKey !== current) {
        current = fullKey;
        continue;
      }
      const definition = getRuntimeModel(fullKey) ?? synthesizeModelConfig(fullKey);
      return definition !== undefined && !isKnownNonChatModel(provider, name) && definition.options?.embeddingSize === undefined;
    }
    if (typeof entry === 'string') {
      current = entry;
      continue;
    }
    return !isKnownNonChatModel(entry.provider, entry.name) && entry.options?.embeddingSize === undefined;
  }
}

/** Return a copy of a variant's candidates, newest last. */
export function getCandidates(ref: DeskRef): DeskCandidate[] {
  return [...(candidates.get(deskRefKey(ref)) ?? [])];
}

/** Drop a variant's candidates and invalidate any result already in flight for it. */
export function clearCandidates(ref: DeskRef): void {
  const key = deskRefKey(ref);
  generations.set(key, (generations.get(key) ?? 0) + 1);
  candidates.delete(key);
}

/**
 * Drop every candidate in memory, regardless of the current filters or
 * selection, and report how many rows were removed. Job history, telemetry and
 * stock files are untouched. A stopped job is safe to clear because later
 * replies are ignored once its signal is aborted.
 */
export function clearAllCandidates(): number {
  if (currentJob?.status === 'running')
    throw new DeskError(409, 'A writing desk job is running. Stop it before clearing candidates.');
  let cleared = 0;
  for (const rows of candidates.values()) cleared += rows.length;
  candidates.clear();
  return cleared;
}

/** Read the mutation epoch captured for a reference. */
function currentGeneration(ref: DeskRef): number {
  return generations.get(deskRefKey(ref)) ?? 0;
}

/** Return the current or most recent job. */
export function getCurrentJob(): DeskJob | null {
  return currentJob;
}

/** Wait for dispatched desk work to finish, including canceled requests. */
export async function waitForJob(): Promise<void> {
  await Promise.all(pendingRuns);
}

/** Normalize one writer reply choice into editable desk text. */
function cleanText(choice: WriterChoice): DeskText | undefined {
  const headline = choice.headline.trim();
  const body = normalizeParagraphs(choice.body);
  if (!headline || body.length === 0) return undefined;
  const subheadline = choice.subheadline?.trim();
  const byline = choice.byline?.trim();
  return {
    headline,
    ...(subheadline ? { subheadline } : {}),
    ...(byline ? { byline } : {}),
    body,
  };
}

/** Compare the editable fields to flag duplicate choices. */
function choiceKey(choice: DeskText): string {
  return JSON.stringify([choice.headline, choice.subheadline, choice.byline, choice.body]);
}

/** Keep at most the configured number of candidates for a variant. */
function storeCandidate(ref: DeskRef, candidate: DeskCandidate): void {
  const key = deskRefKey(ref);
  const kept = candidates.get(key) ?? [];
  kept.push(candidate);
  if (kept.length > deskCandidateLimit) kept.splice(0, kept.length - deskCandidateLimit);
  candidates.set(key, kept);
}

/** Add one writer reply's valid choices to memory and report partial answers. */
function applyReply(
  job: DeskJob,
  task: DeskTask,
  catalogue: DeskCatalogue,
  generationsAtStart: ReadonlyMap<string, number>,
  reply: DeskWriteReply,
): DeskRequestOutcome {
  const wanted = new Set(task.chunk.map(deskRefKey));
  const grouped = new Map<string, WriterChoice[]>();
  for (const variant of reply.variants) {
    const key = deskRefKey(variant);
    if (!wanted.has(key)) continue;
    const entry = grouped.get(key) ?? [];
    entry.push(...variant.choices);
    grouped.set(key, entry);
  }
  let discarded = 0;
  let short = 0;
  for (const ref of task.chunk) {
    const key = deskRefKey(ref);
    const found = findDeskVariant(catalogue, ref);
    if (generationsAtStart.get(key) !== currentGeneration(ref) || !found || found.variant.settled) {
      discarded++;
      continue;
    }
    const variables = templateVariables(found.template, catalogue, found.variant);
    const entry = grouped.get(key);
    if (!entry?.length) {
      short++;
      job.errors.push({
        model: task.model,
        refs: [ref],
        message: 'The model returned no choices for this variant.',
      });
      continue;
    }
    const seen = new Set(getCandidates(ref).map(choiceKey));
    let stored = 0;
    for (const [index, raw] of entry.entries()) {
      const cleaned = cleanText(raw);
      if (!cleaned) continue;
      const text = repairCopy(cleaned, variables);
      const duplicate = seen.has(choiceKey(text));
      seen.add(choiceKey(text));
      const warnings = candidateWarnings(text, found.variant, variables);
      if (duplicate) warnings.push('This choice duplicates another candidate.');
      storeCandidate(ref, {
        id: `${job.id}:${task.model}:${key}:${index}`,
        model: task.model,
        ...text,
        warnings,
        createdAt: new Date().toISOString(),
      });
      stored++;
      if (stored === task.choices) break;
    }
    if (stored < task.choices) {
      short++;
      job.errors.push({
        model: task.model,
        refs: [ref],
        message: `The model returned ${stored} usable choices instead of ${task.choices}.`,
      });
    }
  }
  if (discarded === task.chunk.length) return 'discarded';
  return short || discarded ? 'partial' : 'complete';
}

/** Run one prepared request and record its progress on the job. */
async function runTask(
  job: DeskJob,
  task: DeskTask,
  catalogue: DeskCatalogue,
  generationsAtStart: ReadonlyMap<string, number>,
  signal: AbortSignal,
  writer: DeskWriter,
): Promise<void> {
  const messages = deskMessages(task.prompt);
  const run = openAgentSpan(telemetryHost, writerAgentName, undefined, {
    refs: task.chunk, choices: task.choices, model: task.model,
  }, ROOT_CONTEXT);
  const step = openStepSpan(telemetryHost, writerAgentName, undefined, 1, trace.setSpan(ROOT_CONTEXT, run));
  const spans = [run, step];
  const attributes = {
    'desk.job.id': job.id,
    'desk.model.alias': task.model,
    'desk.variant.ids': task.chunk.map(ref => `${ref.templateId}/${ref.variantId}`),
    'desk.choices': task.choices,
  };
  for (const span of spans) span.setAttributes(attributes);
  step.setAttribute('step.messages', JSON.stringify(messages));
  let outcome: DeskRequestOutcome = 'canceled';
  let usage: Partial<StepTokenUsage> | undefined;
  try {
    signal.throwIfAborted();
    const model = formatModelReference(getModelConfig(task.model));
    for (const span of spans) span.setAttribute('model', model);
    const reply = await context.with(trace.setSpan(ROOT_CONTEXT, step), () => writer({
      model: task.model,
      refs: task.chunk,
      choices: task.choices,
      prompt: task.prompt,
      signal,
      messages,
      /** Capture the provider reply at the application boundary, before parsing. */
      recordReply: result => {
        try {
          usage = recordDeskReply(step, messages, result);
        } catch (error) {
          logger.warn('Could not record the Writing Desk reply', { job: job.id, error: errorMessage(error) });
        }
      },
    }));
    usage ??= { inputTokens: reply.tokens?.input, outputTokens: reply.tokens?.output };
    if (!signal.aborted) {
      if (reply.tokens) {
        job.tokens.input += reply.tokens.input ?? 0;
        job.tokens.output += reply.tokens.output ?? 0;
      }
      outcome = applyReply(job, task, catalogue, generationsAtStart, reply);
      step.setAttribute('step.should_stop', true);
      for (const span of spans) span.setStatus({ code: SpanStatusCode.OK });
    }
  } catch (error) {
    if (!signal.aborted) {
      outcome = 'failed';
      const message = errorMessage(error);
      for (const span of spans) recordSpanError(span, error);
      job.failed++;
      job.errors.push({ model: task.model, refs: [...task.chunk], message });
    }
  } finally {
    if (job.status === 'running') job.done++;
    for (const span of spans) {
      if (usage) recordDeskUsage(span, usage);
      span.setAttribute('desk.outcome', outcome);
    }
    step.end();
    run.end();
  }
}

/** Run the prepared requests without letting one failure cancel the others. */
async function runTasks(
  job: DeskJob,
  tasks: DeskTask[],
  catalogue: DeskCatalogue,
  generationsAtStart: ReadonlyMap<string, number>,
  signal: AbortSignal,
  writer: DeskWriter,
): Promise<void> {
  await Promise.allSettled(tasks.map(task => runTask(job, task, catalogue, generationsAtStart, signal, writer)));
  if (job.status === 'running') job.status = 'done';
}

/** Build the model calls for one job without running them. */
function prepareTasks(
  request: DeskGenerateRequest,
  catalogue: DeskCatalogue,
): DeskTask[] {
  const refs = new Map<string, DeskRef>();
  for (const ref of request.refs) refs.set(deskRefKey(ref), ref);
  const chunks = chunkByStyle([...refs.values()], catalogue);
  return chunks.flatMap(chunk => {
    const prompt = renderBrief(briefView(chunk, catalogue, request.choices));
    return request.models.map(model => ({ model, chunk, choices: request.choices, prompt }));
  });
}

/** Reject names that cannot write copy: unknown aliases and non-chat models. */
function assertChatModels(models: string[]): void {
  const rejected = models.filter(model => !isChatModelReference(model));
  if (rejected.length > 0)
    throw new DeskError(400,
      `Cannot write newspaper copy with ${rejected.map(model => `'${model}'`).join(', ')}. `
      + 'Choose a configured chat alias or a provider/model chat model.');
}

/**
 * Start one writing batch. The job is installed before the first await, so two
 * callers cannot both pass the running check, and work prepared before a clear
 * is discarded when it finishes.
 */
export async function startJob(
  request: DeskGenerateRequest,
  writer: DeskWriter = writeWithModel,
): Promise<DeskJob> {
  if (currentJob?.status === 'running') throw new DeskJobRunningError();
  if (!Array.isArray(request.refs) || request.refs.length === 0)
    throw new DeskError(400, 'Choose at least one variant before generating.');
  if (!Array.isArray(request.models) || request.models.length === 0)
    throw new DeskError(400, 'Choose at least one model before generating.');
  if (!Number.isInteger(request.choices) || request.choices < 1 || request.choices > deskChoicesLimit)
    throw new DeskError(400, `Choices must be a whole number from 1 to ${deskChoicesLimit}.`);
  const models = [...new Set(request.models)];
  assertChatModels(models);
  request = { ...request, models };

  const generationsAtStart = new Map(
    request.refs.map(ref => [deskRefKey(ref), currentGeneration(ref)] as const),
  );
  const job: DeskJob = {
    id: `desk-${Date.now()}-${++jobCounter}`,
    status: 'running',
    total: 0,
    done: 0,
    failed: 0,
    tokens: { input: 0, output: 0 },
    errors: [],
  };
  const controller = new AbortController();
  currentJob = job;
  currentController = controller;

  let catalogue: DeskCatalogue;
  let tasks: ReturnType<typeof prepareTasks>;
  try {
    catalogue = await readDeskCatalogue();
    if (!catalogue.available)
      throw new DeskError(503, catalogue.reason ?? 'The stock newspaper catalogue is not available.');
    tasks = controller.signal.aborted ? [] : prepareTasks(request, catalogue);
    if (tasks.length > 0) {
      try {
        await ensureModelsResolved(models);
      } catch (error) {
        throw new DeskError(400, errorMessage(error));
      }
      // Discovery can reveal that a provider-qualified reference is an embedding model.
      assertChatModels(models);
    }
  } catch (error) {
    job.status = 'stopped';
    job.errors.push({ model: '', refs: [...request.refs], message: errorMessage(error) });
    throw error;
  }

  job.total = tasks.length;
  if (job.status === 'stopped' || tasks.length === 0) {
    if (job.status === 'running') job.status = 'done';
    return job;
  }
  const run = runTasks(job, tasks, catalogue, generationsAtStart, controller.signal, writer)
    .catch(error => {
      job.status = 'stopped';
      job.errors.push({ model: '', refs: [...request.refs], message: errorMessage(error) });
    });
  pendingRuns.add(run);
  void run.then(() => pendingRuns.delete(run));
  return job;
}

/** Stop the running job and discard any result that arrives afterwards. */
export function stopJob(): DeskJob | null {
  if (currentJob?.status === 'running') {
    currentJob.status = 'stopped';
    currentController?.abort();
  }
  return currentJob;
}

/** Call one model with the prepared brief and parse its JSON reply. */
async function writeWithModel(request: DeskWriteRequest): Promise<DeskWriteReply> {
  const modelConfig = getModelConfig(request.model);
  let lastStep: StepResult<ToolSet> | undefined;
  try {
    const result = await streamTextWithConcurrency(
      withModelConfig({
        model: getModel(modelConfig),
        providerOptions: buildProviderOptions(modelConfig),
        maxRetries: 0,
        abortSignal: request.signal,
        messages: request.messages,
        // Keep a finished step even if the stream wrapper detects an error afterward.
        onStepEnd: step => { lastStep = step; },
        output: Output.object({ schema: writerReplySchema }),
        stopWhen: () => true,
      }, modelConfig),
      { logger, timeoutRefresh: undefined } satisfies ConcurrencyContext,
      { useBatchManager: false },
    );
    lastStep = result.steps.at(-1) ?? lastStep;
  } finally {
    if (lastStep) request.recordReply(lastStep);
  }
  const text = typeof lastStep?.text === 'string' ? stripJsonFence(lastStep.text).trim() : '';
  const variants = parseWriterVariants(text);
  if (!variants) throw new Error(`Model '${request.model}' returned no parsable choices.`);
  return {
    variants,
    tokens: {
      input: lastStep?.usage?.inputTokens ?? 0,
      output: lastStep?.usage?.outputTokens ?? 0,
    },
  };
}

/** Keep valid choices even when another part of the model's reply is malformed. */
function parseWriterVariants(text: string): DeskWriteReply['variants'] | undefined {
  let raw: unknown;
  try {
    if (!text) return undefined;
    raw = jaison(text);
  } catch {
    return undefined;
  }
  const reply = rawReplySchema.safeParse(raw);
  if (!reply.success) return undefined;
  return reply.data.variants.flatMap(value => {
    const variant = rawVariantSchema.safeParse(value);
    if (!variant.success) return [];
    const choices = variant.data.choices.flatMap(choice => {
      const parsed = writerChoiceSchema.safeParse(choice);
      return parsed.success ? [parsed.data] : [];
    });
    return [{ ...variant.data, choices }];
  });
}
