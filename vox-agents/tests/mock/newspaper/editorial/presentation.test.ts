/** Check configurable presentation decisions with controlled authored inputs. */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialPublicationState } from '../../../../src/newspaper/contracts/publication.js';
import { builtInCatalogueDirectory, editorialConfigSchema, loadEditorialConfig, type EditorialConfig } from '../../../../src/newspaper/editorial/config.js';
import { evaluateCondition, type ConditionContext } from '../../../../src/newspaper/editorial/conditions.js';
import { computeFeedback } from '../../../../src/newspaper/editorial/feedback.js';
import { selectHeuristic } from '../../../../src/newspaper/editorial/heuristic.js';
import { chooseDesign, createEditorialStreams, presentIssue } from '../../../../src/newspaper/editorial/presentation.js';
import { eligibleVariants, type EditorialCandidate } from '../../../../src/newspaper/editorial/templates.js';
import { validateEditorialIssue } from '../../../../src/newspaper/editorial/validation.js';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readFile: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

/** Build a complete small catalogue whose choices can be varied independently. */
function createConfig(): EditorialConfig {
  return editorialConfigSchema.parse({
    version: 1,
    defaults: {
      frequencyStandardTurns: 5, llmEnabled: false, publicationTitle: 'Publication',
      maxItems: 4, frontPageItems: 3, importanceMax: 100, decayPerTurn: 0.9,
      seriesWeight: 1, noveltyBonus: 1, varietyBonus: 1, designStickiness: 0.8,
      feedback: { window: 50, series: 3, tag: 1, bound: 10 },
    },
    triggers: [
      { id: 'war', detector: 'incomingWar', threshold: 0, scale: 1, tags: ['military', 'foreign'] },
      { id: 'peace', detector: 'peace', threshold: 0, scale: 1, tags: ['diplomacy'] },
    ],
    templates: [{
      id: 'coverage', triggerIds: ['war'], tags: ['military'], weight: { base: 1 },
      variants: [
        { id: 'first', headline: '{{name}} A', body: ['First {{name}}', 'Second {{name}}'], weight: { base: 1 } },
        { id: 'second', headline: '{{name}} B', body: ['Other {{name}}'], weight: { base: 2 } },
      ],
    }],
    pages: [
      { id: 'front', label: 'Front', tags: [], minimum: 1, order: 0, front: true },
      { id: 'military', label: 'Military', tags: ['military'], minimum: 1, order: 1 },
    ],
    designs: [{
      id: 'early-account', version: '1', title: 'Account', weight: { base: 1 },
      presentation: { schemaVersion: 1, rendererFamily: 'victorian', tokens: { paperColor: '#eeeecc' } },
      layouts: [
        { id: 'ordinary', variant: 'ordinary', weight: { base: 1 } },
        { id: 'breaking', variant: 'breaking', weight: { base: 1 } },
      ],
    }],
  });
}

/** Build a prequalified candidate as supplied by the template matcher. */
function createCandidate(config: EditorialConfig, id: string, urgent = false): EditorialCandidate {
  return {
    id, subject: id, period: { from: 1, to: 5 }, triggerIds: [`trigger/${id}`],
    templateIds: ['coverage'], contributingIds: [], seriesKeys: [`series/${id}`],
    tags: [urgent ? 'military' : 'economy'], importance: urgent ? 1 : 20, urgent,
    short: false, weight: 1, variants: config.templates[0].variants,
    values: { name: id }, sources: [], summary: `Observation ${id}`, fingerprint: id,
  };
}

/** Use the real presentation boundary with deterministic independent choice streams. */
function render(config: EditorialConfig, candidates: EditorialCandidate[], seed = 'campaign/receiver/5') {
  const streams = createEditorialStreams(seed, config);
  return presentIssue({
    issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
    selected: candidates, state: createInitialPublicationState(), config, context: { values: {} },
    proseRandom: streams.prose, presentationRandom: streams.presentation,
  })!;
}

describe('editorial configuration overlays', () => {
  it('should replace primitive arrays while merging catalogue entries and authored variants by identity', async () => {
    const base = createConfig();
    const overlayDirectory = path.resolve('controlled-editorial-overlay');
    const documents = new Map<string, unknown>();
    for (const section of ['defaults', 'triggers', 'templates', 'pages', 'designs'] as const) {
      documents.set(path.resolve(builtInCatalogueDirectory(), `${section}.json`), base[section]);
    }
    documents.set(path.join(overlayDirectory, 'defaults.json'), { feedback: { tag: 0.25 } });
    documents.set(path.join(overlayDirectory, 'triggers.json'), [{ id: 'war', tags: [] }]);
    documents.set(path.join(overlayDirectory, 'templates.json'), [{
      id: 'coverage', triggerIds: ['peace'], tags: ['replacement'],
      variants: [{ id: 'first', body: ['Replacement {{name}}'] }],
    }]);
    documents.set(path.join(overlayDirectory, 'pages.json'), [{
      id: 'economy', label: 'Economy', tags: ['economy'], minimum: 1, order: 2,
    }]);
    vi.mocked(readFile).mockImplementation(async (filename) => {
      const value = documents.get(path.resolve(String(filename)));
      if (value === undefined) throw Object.assign(new Error('Absent overlay'), { code: 'ENOENT' });
      return JSON.stringify(value);
    });

    const loaded = await loadEditorialConfig(overlayDirectory);
    expect(loaded.defaults.feedback).toEqual({ ...base.defaults.feedback, tag: 0.25 });
    expect(loaded.triggers[0]).toEqual({ ...base.triggers[0], tags: [] });
    expect(loaded.triggers[1]).toEqual(base.triggers[1]);
    expect(loaded.templates[0]).toMatchObject({ triggerIds: ['peace'], tags: ['replacement'], weight: base.templates[0].weight });
    expect(loaded.templates[0].variants).toEqual([
      { ...base.templates[0].variants[0], body: ['Replacement {{name}}'] }, base.templates[0].variants[1],
    ]);
    expect(loaded.pages.map(page => page.id)).toEqual(['front', 'military', 'economy']);
    expect(loaded.designs).toEqual(base.designs);
  });
});

describe('editorial eligibility', () => {
  it('should preserve unknown technology history through negation and composition', () => {
    const condition = { op: 'not', condition: { op: 'technology', id: 'writing' } } as const;
    expect(evaluateCondition(condition, { values: {} })).toBe('unknown');
    expect(evaluateCondition({ op: 'all', conditions: [{ op: 'always' }, condition] }, { values: {} })).toBe('unknown');
    expect(evaluateCondition(condition, { values: {}, technologies: [], technologyHistoryComplete: true })).toBe(true);
    expect(evaluateCondition(condition, { values: {}, technologies: ['writing'] })).toBe(false);
  });

  it.each([
    { values: {} },
    { values: {}, technologies: [], technologyHistoryComplete: true },
  ] satisfies ConditionContext[])('should keep an early design eligible before Writing or with incomplete history: %j', context => {
    const config = createConfig();
    config.designs.push({ ...structuredClone(config.designs[0]), id: 'written-journal', condition: { op: 'technology', id: 'writing' }, weight: { base: 100, adjustments: [] } });
    expect(chooseDesign(config, context, null, () => 0.99)?.id).toBe('early-account');
    expect(chooseDesign(config, { values: {}, technologies: ['writing'] }, null, () => 0.99)?.id).toBe('written-journal');
  });

  it('should exclude unavailable authored variants and honor only known-true weight adjustments', () => {
    const template = createConfig().templates[0];
    template.variants = [
      { ...template.variants[0], id: 'eligible', condition: { op: 'eq', field: 'enabled', value: true } },
      { ...template.variants[0], id: 'unknown', condition: { op: 'not', condition: { op: 'technology', id: 'writing' } } },
      { ...template.variants[0], id: 'nonpositive', weight: { base: 1, adjustments: [{ condition: { op: 'eq', field: 'enabled', value: true }, add: -2 }] } },
      { ...template.variants[0], id: 'unknown-weight', weight: { base: 0, adjustments: [{ condition: { op: 'technology', id: 'writing' }, add: 10 }] } },
      { ...template.variants[0], id: 'missing-fact', body: ['{{unavailable}}'] },
    ];
    const context = { values: { enabled: true } };
    expect(eligibleVariants(template, context, { name: 'Subject' }).map(variant => variant.id)).toEqual(['eligible']);
    expect(eligibleVariants(template, { values: { enabled: false } }, { name: 'Subject' }).map(variant => variant.id)).toEqual(['nonpositive']);
  });
});

describe('editorial presentation', () => {
  it('should retain a competitive eligible design and replace one that loses weight or eligibility', () => {
    const config = createConfig();
    config.designs[0].weight.base = 8;
    config.designs.push({ ...structuredClone(config.designs[0]), id: 'stronger', weight: { base: 10, adjustments: [] } });
    expect(chooseDesign(config, { values: {} }, 'early-account', () => 0.99)?.id).toBe('early-account');
    config.designs[0].weight.base = 7;
    expect(chooseDesign(config, { values: {} }, 'early-account', () => 0.99)?.id).toBe('stronger');
    config.designs[0].weight.base = 100;
    config.designs[0].condition = { op: 'technology', id: 'writing' };
    expect(chooseDesign(config, { values: {} }, 'early-account', () => 0)?.id).toBe('stronger');
  });

  it('should preserve selected prose when only layouts and presentation weights change', () => {
    const original = createConfig();
    const tuned = structuredClone(original);
    tuned.designs[0].layouts = [
      ...tuned.designs[0].layouts,
      { id: 'analysis', variant: 'analysis', weight: { base: 1000, adjustments: [] } },
    ];
    tuned.pages[1].order = 20;
    for (const seed of ['first-seed', 'second-seed', 'third-seed']) {
      const candidates = [createCandidate(original, 'home'), createCandidate(original, 'trade')];
      const before = render(original, candidates, seed);
      const after = render(tuned, candidates, seed);
      expect(after.variants).toEqual(before.variants);
      expect(after.issue.items).toEqual(before.issue.items);
      expect(before.issue.pages[0].layout).toBe('ordinary');
      expect(after.issue.pages[0].layout).toBe('analysis');
    }
  });

  it('should place an incoming threat ahead of higher scoring domestic coverage on a breaking front page', () => {
    const config = createConfig();
    const state = createInitialPublicationState();
    const candidates = [createCandidate(config, 'domestic'), createCandidate(config, 'war', true)];
    const selected = selectHeuristic(candidates, state, config, computeFeedback(state, config));
    const result = render(config, selected.selected);
    const front = result.issue.pages[0];
    expect(result.itemCandidates.get(front.itemIds[0])?.id).toBe('war');
    expect(front.layout).toBe('breaking');
    expect(new Set(front.itemIds.map(id => result.itemCandidates.get(id)?.subject)).size).toBe(2);
    expect(() => validateEditorialIssue(result.issue, result.itemCandidates, config, { values: {} })).not.toThrow();
  });

  it('should reject conditional or nonpositive layouts even when their base selection weight dominates', () => {
    const config = createConfig();
    config.designs[0].layouts.push(
      { id: 'unavailable', variant: 'analysis', condition: { op: 'technology', id: 'writing' }, weight: { base: 10000, adjustments: [] } },
      { id: 'disabled', variant: 'analysis', weight: { base: 10000, adjustments: [{ condition: { op: 'always' }, add: -10000 }] } },
    );
    const result = render(config, [createCandidate(config, 'domestic')]);
    expect(result.issue.pages[0].layout).toBe('ordinary');
    expect(result.layouts.front).toBe('ordinary');
  });
});
