import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { config } from '../../../../src/agents/config/load.js';
import { flushDeskTelemetry, sqliteExporter } from '../../../../src/instrumentation.js';
import type { DeskCandidate, DeskGenerateRequest, DeskRef, DeskStyle, DeskText } from '../../../../src/types/api.js';
import type { Model } from '../../../../src/types/config.js';
import { deskWritingRulesPath, type DeskCatalogue, type DeskTemplate, type DeskVariant } from '../../../../src/newspaper/desk/catalogue.js';
import type { DeskWriteReply, DeskWriter } from '../../../../src/newspaper/desk/generate.js';
import {
  DeskJobRunningError,
  clearAllCandidates,
  clearCandidates,
  deskModelNames,
  getCandidates,
  getCurrentJob,
  startJob,
  stopJob,
  waitForJob,
} from '../../../../src/newspaper/desk/generate.js';

const mocks = vi.hoisted(() => ({
  catalogue: undefined as unknown,
  stream: vi.fn(),
  ensureModelsResolved: vi.fn(),
  runtimeModels: new Map<string, Model>(),
}));

vi.mock('../../../../src/agents/models/concurrency.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/agents/models/concurrency.js')>(),
  streamTextWithConcurrency: mocks.stream,
}));

vi.mock('../../../../src/agents/models/resolution.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/agents/models/resolution.js')>(),
  ensureModelsResolved: mocks.ensureModelsResolved,
  getRuntimeModel: (name: string) => mocks.runtimeModels.get(name),
}));

vi.mock('../../../../src/newspaper/desk/catalogue.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/newspaper/desk/catalogue.js')>(),
  readDeskCatalogue: async () => mocks.catalogue,
}));

vi.mock('../../../../src/newspaper/desk/variables.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/newspaper/desk/variables.js')>();
  return {
    ...actual,
    templateVariables: () => [],
    candidateWarnings: () => [],
  };
});

const modelA = 'desk-test-model-a';
const modelB = 'desk-test-model-b';
const press: DeskStyle = { voice: 'press', stance: 'neutral', genre: 'report' };
const report: DeskStyle = { voice: 'general', stance: 'neutral', genre: 'report' };

/** Build one fake editable variant. */
function variant(id: string, style: DeskStyle, settled = false): DeskVariant {
  return {
    id,
    style,
    text: { headline: `Headline ${id}`, body: [`Body ${id}`] },
    settled,
    revision: `revision-${id}`,
    links: [],
  };
}

/** Build one fake template with a single trigger context. */
function template(id: string, tags: string[], variants: DeskVariant[]): DeskTemplate {
  return {
    id,
    file: `${id}.json`,
    tags,
    triggerSummary: `Summary ${id}`,
    triggers: ['trigger-a'],
    formats: {},
    variants,
  };
}

/** Build the catalogue seam used by generation. */
function catalogue(): DeskCatalogue {
  return {
    available: true,
    directory: '.',
    writingPath: deskWritingRulesPath,
    templates: [
      template('press-news', ['science'], [
        variant('one', press),
        variant('two', press),
        variant('old', press, true),
      ]),
      template('report-news', ['culture'], [variant('one', report)]),
    ],
    triggers: [{ id: 'trigger-a', subject: 'player', when: 'true' }],
  };
}

/** Build one editable choice with a distinct headline. */
function choice(label: string): DeskText {
  return { headline: `Headline ${label}`, body: [`Body ${label}`] };
}

/** Answer every ref in one request with the requested number of choices. */
function replyFor(request: { refs: DeskRef[]; choices: number }): DeskWriteReply {
  return {
    variants: request.refs.map(ref => ({
      templateId: ref.templateId,
      variantId: ref.variantId,
      choices: Array.from({ length: request.choices }, (_, index) => choice(`${ref.variantId}-${index}`)),
    })),
    tokens: { input: 10, output: 20 },
  };
}

const request = (refs: DeskRef[], choices = 1, models = [modelA]): DeskGenerateRequest => ({
  refs,
  models,
  choices,
});

/** Read the stored batch and all its requests from the isolated test database. */
async function readTrace(jobId: string) {
  await waitForJob();
  await flushDeskTelemetry();
  const db = sqliteExporter.openDatabaseFile('newspaper/newspaper-desk-player-0.db');
  if (!db) throw new Error('No Writing Desk telemetry database was created.');
  try {
    const rows = await db.selectFrom('spans')
      .selectAll()
      .where(eb => eb(eb.ref('attributes', '->>').key('desk.job.id'), '=', jobId))
      .execute();
    const spans = rows.map(row => ({ ...row, attributes: JSON.parse(String(row.attributes)) }));
    const root = spans.find(span => span.parentSpanId === null);
    if (!root) throw new Error('No Writing Desk batch span was found.');
    const requests = spans.filter(span => span.parentSpanId === root.spanId);
    expect(requests).toHaveLength(spans.length - 1);
    for (const span of requests) expect(span.traceId).toBe(root.traceId);
    expect(spans.every(span => span.turn === null)).toBe(true);
    return { root, requests };
  } finally {
    await db.destroy();
  }
}

describe('newspaper desk generation', () => {
  beforeEach(() => {
    mocks.catalogue = catalogue();
    mocks.stream.mockReset();
    mocks.ensureModelsResolved.mockReset();
    mocks.ensureModelsResolved.mockResolvedValue(undefined);
    mocks.runtimeModels.clear();
    config.llms[modelA] = { provider: 'openai', name: modelA };
    config.llms[modelB] = { provider: 'openai', name: modelB };
  });

  it('should preserve valid drafts across variants when part of a model reply is malformed', async () => {
    const one = { templateId: 'press-news', variantId: 'one' };
    const two = { templateId: 'press-news', variantId: 'two' };
    const first = 'The news came at sunrise. The bells rang before noon.';
    mocks.stream.mockResolvedValue({ steps: [{ text: JSON.stringify({ variants: [
      { ...one, choices: [{ headline: 'Missing body' }, { headline: 'A report', byline: null,
        body: ['  ', `  ${first}\r\n \t\r\nLater, the road reopened.\r\nTravel resumed.  `, '', '  The next day, the first convoy arrived.'] }] },
      { ...two, choices: [null] },
    ] }) }] });
    const job = await startJob(request([one, two]));
    const { root, requests } = await readTrace(job.id);
    expect(getCandidates(one)).toEqual([expect.objectContaining({
      headline: 'A report',
      body: [first, 'Later, the road reopened.\nTravel resumed.', 'The next day, the first convoy arrived.'],
    })]);
    expect(getCandidates(two)).toEqual([]);
    expect(getCurrentJob()).toMatchObject({ total: 1, done: 1, failed: 0 });
    expect(root.attributes['desk.requests.partial']).toBe(1);
    expect(requests[0].attributes['desk.outcome']).toBe('partial');
  });

  it('should persist the batch hierarchy, model, full exchanges and available token counts', async () => {
    const ref = { templateId: 'press-news', variantId: 'one' };
    const text = JSON.stringify(replyFor({ refs: [ref], choices: 1 }));
    const replies = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'Working notes' }, { type: 'text', text }] }];
    mocks.stream.mockResolvedValue({ steps: [{
      text,
      response: {
        messages: replies.map(reply => ({
          ...reply,
          providerOptions: { private: 'omit' },
          content: reply.content.map(part => ({ ...part, providerMetadata: { private: 'omit' } })),
        })),
        headers: { private: 'omit' },
      },
      usage: { inputTokens: 25_000, outputTokens: 200, inputTokenDetails: { cacheReadTokens: 1024 },
        outputTokenDetails: { reasoningTokens: 70 } },
    }] });
    const job = await startJob(request([ref], 1, [modelA, modelB]));
    const { root, requests } = await readTrace(job.id);
    expect(root.attributes).toMatchObject({
      'desk.requests': 2, 'desk.requests.complete': 2,
      'tokens.input': 50_000, 'tokens.input.cached': 2048, 'tokens.reasoning': 140,
    });
    expect(root.attributes['tokens.output']).toBe(requests.reduce((total, span) => total + span.attributes['tokens.output'], 0));
    expect(requests.map(span => span.attributes['desk.model.alias']).sort()).toEqual([modelA, modelB]);
    for (const span of requests) {
      expect(span.attributes).toMatchObject({
        model: `openai/${span.attributes['desk.model.alias']}`, 'desk.variant.ids': ['press-news/one'],
        'desk.choices': 1, 'tokens.input': 25_000, 'tokens.input.cached': 1024,
        'tokens.reasoning': 70, 'desk.outcome': 'complete',
      });
      expect(span.attributes['tokens.output']).toBeGreaterThan(0);
      expect(JSON.parse(span.attributes['step.messages'])).toEqual(mocks.stream.mock.calls[0][0].messages);
      expect(JSON.parse(span.attributes['step.responses'])).toEqual(replies);
      expect(JSON.stringify(span.attributes)).not.toContain('"private"');
    }
  });

  it('should keep an unparseable response in a failed request trace', async () => {
    const raw = '  ```json\n"wrong reply shape"\n```  ';
    mocks.stream.mockResolvedValue({ steps: [{ text: raw }] });
    const job = await startJob(request([{ templateId: 'press-news', variantId: 'one' }]));
    const { root, requests } = await readTrace(job.id);
    expect(job.failed).toBe(1);
    expect(root.attributes['desk.requests.failed']).toBe(1);
    expect(requests[0]).toMatchObject({ statusCode: SpanStatusCode.ERROR, statusMessage: expect.any(String),
      attributes: { 'desk.outcome': 'failed' } });
    expect(JSON.parse(requests[0].attributes['step.responses'])[0].content[0].text).toBe(raw);
  });

  it('should keep good drafts when the response metadata cannot be serialized for telemetry', async () => {
    const ref = { templateId: 'press-news', variantId: 'one' };
    const text = JSON.stringify(replyFor({ refs: [ref], choices: 1 }));
    const part = { type: 'text', text, unexpected: {} };
    part.unexpected = part;
    mocks.stream.mockResolvedValue({ steps: [{ text, response: { messages: [{ role: 'assistant', content: [part] }] } }] });
    const job = await startJob(request([ref]));
    await waitForJob();
    expect(job.failed).toBe(0);
    expect(getCandidates(ref)).toHaveLength(1);
  });

  afterEach(async () => {
    stopJob();
    await waitForJob();
    clearAllCandidates();
    delete config.llms[modelA];
    delete config.llms[modelB];
    vi.restoreAllMocks();
  });

  it('should list configured chat models and exclude embedding and evaluation aliases', () => {
    config.llms['desk-test-embed'] = { provider: 'openai', name: 'embed', options: { embeddingSize: 8 } };
    config.llms['desk-test.evaluator'] = 'desk-test-model-a';
    try {
      const names = deskModelNames();
      expect(names).toEqual(expect.arrayContaining([modelA, modelB]));
      expect(names).not.toContain('desk-test-embed');
      expect(names).not.toContain('desk-test.evaluator');
    } finally {
      delete config.llms['desk-test-embed'];
      delete config.llms['desk-test.evaluator'];
    }
  });

  it('should finish and trace large batches without dropping requests', async () => {
    const large = template('large-batch', ['science'], Array.from({ length: 101 }, (_, index) =>
      variant(`report-${index}`, { ...report, stance: `stance-${index}` })));
    mocks.catalogue = { ...catalogue(), templates: [large] };
    const refs = large.variants.map(({ id }) => ({ templateId: large.id, variantId: id }));
    // A quick burst can exceed the standard telemetry buffer even with eight variants per request.
    const models = Array.from({ length: 21 }, (_, index) => `desk-burst-${index}`);
    for (const name of models) config.llms[name] = { provider: 'openai', name };
    const total = refs.length * models.length;
    const writer = vi.fn<DeskWriter>(async input => replyFor(input));
    try {
      const job = await startJob(request(refs, 1, models), writer);
      const { root, requests } = await readTrace(job.id);
      expect(job).toMatchObject({ status: 'done', total, done: total, failed: 0 });
      expect(root.attributes['desk.requests.complete']).toBe(total);
      expect(requests).toHaveLength(total);
      expect(writer).toHaveBeenCalledTimes(total);
      expect(getCandidates(refs.at(-1)!)).toHaveLength(models.length);
    } finally {
      for (const ref of refs) clearCandidates(ref);
      for (const model of models) delete config.llms[model];
    }
  });

  it('should reject a model that is not a configured chat alias', async () => {
    const ref = { templateId: 'press-news', variantId: 'one' };
    await expect(startJob(request([ref], 1, ['desk-test-missing']), async request => replyFor(request)))
      .rejects.toMatchObject({ status: 400 });
  });

  it('should accept a discovered provider-qualified chat model without a configured alias', async () => {
    const name = 'openai/desk-discovered-chat';
    const ref = { templateId: 'press-news', variantId: 'one' };
    mocks.ensureModelsResolved.mockImplementation(async () => {
      mocks.runtimeModels.set(name, { provider: 'openai', name: 'desk-discovered-chat' });
    });
    const writer = vi.fn<DeskWriter>(async input => replyFor(input));
    const job = await startJob(request([ref], 1, [name]), writer);
    await waitForJob();
    expect(mocks.ensureModelsResolved).toHaveBeenCalledWith([name]);
    expect(job).toMatchObject({ status: 'done', total: 1, done: 1, failed: 0 });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(getCandidates(ref)).toEqual([expect.objectContaining({ model: name })]);
  });

  it('should reject known non-chat and unsupported provider-qualified references before discovery', async () => {
    const ref = { templateId: 'press-news', variantId: 'one' };
    for (const name of ['typesafe/jev', 'unknown-provider/chat', 'openai/whisper-1', 'openrouter/other/embedder']) {
      await expect(startJob(request([ref], 1, [name]), async input => replyFor(input)))
        .rejects.toMatchObject({ status: 400 });
    }
    expect(mocks.ensureModelsResolved).not.toHaveBeenCalled();
  });

  it('should reject known embedding and evaluation aliases before discovery', async () => {
    config.llms['desk-test-embed'] = { provider: 'openai', name: 'embed', options: { embeddingSize: 8 } };
    config.llms['desk-test.evaluator'] = modelA;
    const ref = { templateId: 'press-news', variantId: 'one' };
    try {
      for (const name of ['desk-test-embed', 'desk-test.evaluator']) {
        await expect(startJob(request([ref], 1, [name]), async input => replyFor(input)))
          .rejects.toMatchObject({ status: 400 });
      }
      expect(mocks.ensureModelsResolved).not.toHaveBeenCalled();
    } finally {
      delete config.llms['desk-test-embed'];
      delete config.llms['desk-test.evaluator'];
    }
  });

  it('should reject a provider-qualified reference discovered to be an embedding model', async () => {
    const name = 'openai/desk-embedding-model';
    const ref = { templateId: 'press-news', variantId: 'one' };
    mocks.ensureModelsResolved.mockImplementation(async () => {
      mocks.runtimeModels.set(name, { provider: 'openai', name: 'desk-embedding-model', options: { embeddingSize: 8 } });
    });
    const writer = vi.fn<DeskWriter>(async input => replyFor(input));
    await expect(startJob(request([ref], 1, [name]), writer)).rejects.toMatchObject({ status: 400 });
    expect(writer).not.toHaveBeenCalled();
    expect(getCandidates(ref)).toEqual([]);
    expect(getCurrentJob()?.status).toBe('stopped');
  });

  it('should report a failed model discovery preflight as a desk error', async () => {
    const name = 'openai/desk-not-in-catalog';
    const ref = { templateId: 'press-news', variantId: 'one' };
    mocks.ensureModelsResolved.mockRejectedValue(new Error('not in the provider catalog'));
    await expect(startJob(request([ref], 1, [name]), async input => replyFor(input)))
      .rejects.toMatchObject({ status: 400 });
    expect(getCurrentJob()?.status).toBe('stopped');
  });

  it('should skip settled variants and send only unsettled refs to the writer', async () => {
    const writer = vi.fn<DeskWriter>(async request => replyFor(request));
    const job = await startJob(request([
      { templateId: 'press-news', variantId: 'one' },
      { templateId: 'press-news', variantId: 'old' },
    ]), writer);
    await waitForJob();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0][0].refs).toEqual([{ templateId: 'press-news', variantId: 'one' }]);
    expect(job.status).toBe('done');
    expect(job.total).toBe(1);
    expect(getCandidates({ templateId: 'press-news', variantId: 'old' })).toEqual([]);
  });

  it('should count one failed request while the others finish', async () => {
    const writer = vi.fn<DeskWriter>(async request => {
      if (request.model === modelA) throw new Error('model unavailable');
      return replyFor(request);
    });
    const job = await startJob(request(
      [{ templateId: 'press-news', variantId: 'one' }], 1, [modelA, modelB],
    ), writer);
    await waitForJob();
    expect(job.status).toBe('done');
    expect(job.total).toBe(2);
    expect(job.done).toBe(2);
    expect(job.failed).toBe(1);
    expect(job.errors).toEqual([expect.objectContaining({ model: modelA, message: 'model unavailable' })]);
    expect(getCandidates({ templateId: 'press-news', variantId: 'one' })).toHaveLength(1);
    expect(getCandidates({ templateId: 'press-news', variantId: 'one' })[0].model).toBe(modelB);
  });

  it('should discard results that finish after stop', async () => {
    let release!: (reply: DeskWriteReply) => void;
    const pending = new Promise<DeskWriteReply>(resolve => { release = resolve; });
    const writer: DeskWriter = () => pending;
    const ref = { templateId: 'press-news', variantId: 'one' };
    const job = await startJob(request([ref]), writer);
    expect(job.status).toBe('running');
    stopJob();
    release(replyFor({ refs: [ref], choices: 1 }));
    const { root, requests } = await readTrace(job.id);
    expect(job.status).toBe('stopped');
    expect(job.done).toBe(0);
    expect(root.attributes['desk.requests.canceled']).toBe(1);
    expect(requests[0].attributes['desk.outcome']).toBe('canceled');
    expect(getCandidates(ref)).toEqual([]);
  });

  it('should discard results prepared before a variant is cleared', async () => {
    let release!: (reply: DeskWriteReply) => void;
    const pending = new Promise<DeskWriteReply>(resolve => { release = resolve; });
    const writer: DeskWriter = () => pending;
    const ref = { templateId: 'press-news', variantId: 'one' };
    const job = await startJob(request([ref]), writer);
    clearCandidates(ref);
    release(replyFor({ refs: [ref], choices: 1 }));
    const { root, requests } = await readTrace(job.id);
    expect(root.attributes['desk.requests.discarded']).toBe(1);
    expect(requests[0].attributes['desk.outcome']).toBe('discarded');
    expect(getCandidates(ref)).toEqual([]);
  });

  it('should clear every candidate after a stopped run and keep the job history', async () => {
    const one = { templateId: 'press-news', variantId: 'one' };
    const two = { templateId: 'press-news', variantId: 'two' };
    const first = await startJob(request([one, two], 1, [modelA, modelB]), async input => replyFor(input));
    await waitForJob();
    expect(first.status).toBe('done');
    const before = getCandidates(one).length + getCandidates(two).length;
    expect(before).toBeGreaterThan(0);

    let release!: (reply: DeskWriteReply) => void;
    const pending = new Promise<DeskWriteReply>(resolve => { release = resolve; });
    const stopped = await startJob(request([one], 1, [modelB]), () => pending);
    stopJob();
    release(replyFor({ refs: [one], choices: 1 }));
    await waitForJob();
    expect(stopped.status).toBe('stopped');

    expect(clearAllCandidates()).toBe(before);
    expect(getCandidates(one)).toEqual([]);
    expect(getCandidates(two)).toEqual([]);
    expect(getCurrentJob()).toBe(stopped);
  });

  it('should refuse to clear candidates while a job is running', async () => {
    let release!: (reply: DeskWriteReply) => void;
    const pending = new Promise<DeskWriteReply>(resolve => { release = resolve; });
    const ref = { templateId: 'press-news', variantId: 'one' };
    const job = await startJob(request([ref]), () => pending);
    let error: unknown;
    try {
      clearAllCandidates();
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ status: 409 });
    expect(getCurrentJob()).toBe(job);
    stopJob();
    release(replyFor({ refs: [ref], choices: 1 }));
    await waitForJob();
    expect(clearAllCandidates()).toBe(0);
  });

  it('should reject a second job while the first is still preparing', async () => {
    let release!: (reply: DeskWriteReply) => void;
    const pending = new Promise<DeskWriteReply>(resolve => { release = resolve; });
    const ref = { templateId: 'press-news', variantId: 'one' };
    const first = startJob(request([ref]), () => pending);
    const second = startJob(request([ref]), async request => replyFor(request));
    await expect(second).rejects.toBeInstanceOf(DeskJobRunningError);
    await expect(second).rejects.toMatchObject({ status: 409 });
    expect((await first).status).toBe('running');
    stopJob();
    release(replyFor({ refs: [ref], choices: 1 }));
    await waitForJob();
  });

  it('should keep the requested choices per model and trim extras', async () => {
    const writer = vi.fn<DeskWriter>(async request => replyFor({ refs: request.refs, choices: 3 }));
    const ref = { templateId: 'press-news', variantId: 'one' };
    const job = await startJob(request([ref], 2, [modelA, modelB]), writer);
    await waitForJob();
    const candidates = getCandidates(ref);
    expect(job.status).toBe('done');
    expect(candidates).toHaveLength(4);
    expect(candidates.filter(candidate => candidate.model === modelA)).toHaveLength(2);
    expect(candidates.filter(candidate => candidate.model === modelB)).toHaveLength(2);
    expect(new Set(candidates.map((candidate: DeskCandidate) => candidate.id)).size).toBe(4);
    expect(job.tokens).toEqual({ input: 20, output: 40 });
  });

  it('should expose the current or most recent job', async () => {
    const ref = { templateId: 'press-news', variantId: 'one' };
    const job = await startJob(request([ref]), async request => replyFor(request));
    await waitForJob();
    expect(getCurrentJob()).toBe(job);
  });
});
