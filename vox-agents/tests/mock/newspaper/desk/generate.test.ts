import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../../src/agents/config/load.js';
import type { DeskCandidate, DeskGenerateRequest, DeskRef, DeskStyle, DeskText } from '../../../../src/types/api.js';
import { deskWritingRulesPath, type DeskCatalogue, type DeskTemplate, type DeskVariant } from '../../../../src/newspaper/desk/catalogue.js';
import type { DeskWriteReply, DeskWriter } from '../../../../src/newspaper/desk/generate.js';
import {
  DeskJobRunningError,
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
}));

vi.mock('../../../../src/agents/models/concurrency.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/agents/models/concurrency.js')>(),
  streamTextWithConcurrency: mocks.stream,
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

describe('newspaper desk generation', () => {
  beforeEach(() => {
    mocks.catalogue = catalogue();
    mocks.stream.mockReset();
    config.llms[modelA] = { provider: 'openai', name: modelA };
    config.llms[modelB] = { provider: 'openai', name: modelB };
  });

  it('should preserve valid drafts across variants when part of a model reply is malformed', async () => {
    const one = { templateId: 'press-news', variantId: 'one' };
    const two = { templateId: 'press-news', variantId: 'two' };
    mocks.stream.mockResolvedValue({ steps: [{ text: JSON.stringify({ variants: [
      { ...one, choices: [{ headline: 'Missing body' }, { headline: 'A report', byline: null, body: ['', 'The news.'] }] },
      { ...two, choices: [null, { headline: 'Another report', body: ['Other news.'] }] },
    ] }) }] });
    await startJob(request([one, two]));
    await waitForJob();
    expect(getCandidates(one)).toEqual([expect.objectContaining({ headline: 'A report', body: ['The news.'] })]);
    expect(getCandidates(two)).toEqual([expect.objectContaining({ headline: 'Another report', body: ['Other news.'] })]);
    expect(getCurrentJob()).toMatchObject({ total: 1, done: 1, failed: 0 });
  });

  afterEach(async () => {
    stopJob();
    await waitForJob();
    for (const ref of [
      { templateId: 'press-news', variantId: 'one' },
      { templateId: 'press-news', variantId: 'two' },
      { templateId: 'press-news', variantId: 'old' },
      { templateId: 'report-news', variantId: 'one' },
    ]) clearCandidates(ref);
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

  it('should finish large batches without a total request cap', async () => {
    const large = template('large-batch', ['science'], Array.from({ length: 101 }, (_, index) =>
      variant(`report-${index}`, { ...report, stance: `stance-${index}` })));
    mocks.catalogue = { ...catalogue(), templates: [large] };
    const refs = large.variants.map(({ id }) => ({ templateId: large.id, variantId: id }));
    const writer = vi.fn<DeskWriter>(async input => replyFor(input));
    try {
      const job = await startJob(request(refs, 1, [modelA, modelB]), writer);
      await waitForJob();
      expect(job).toMatchObject({ status: 'done', total: 202, done: 202, failed: 0 });
      expect(writer).toHaveBeenCalledTimes(202);
      expect(getCandidates(refs.at(-1)!)).toHaveLength(2);
    } finally {
      for (const ref of refs) clearCandidates(ref);
    }
  });

  it('should reject a model that is not a configured chat alias', async () => {
    const ref = { templateId: 'press-news', variantId: 'one' };
    await expect(startJob(request([ref], 1, ['desk-test-missing']), async request => replyFor(request)))
      .rejects.toMatchObject({ status: 400 });
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
    await waitForJob();
    expect(job.status).toBe('stopped');
    expect(getCandidates(ref)).toEqual([]);
  });

  it('should discard results prepared before a variant is cleared', async () => {
    let release!: (reply: DeskWriteReply) => void;
    const pending = new Promise<DeskWriteReply>(resolve => { release = resolve; });
    const writer: DeskWriter = () => pending;
    const ref = { templateId: 'press-news', variantId: 'one' };
    await startJob(request([ref]), writer);
    clearCandidates(ref);
    release(replyFor({ refs: [ref], choices: 1 }));
    await waitForJob();
    expect(getCandidates(ref)).toEqual([]);
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
