/** Check configurable presentation decisions with controlled authored inputs. */
import { describe, expect, it } from 'vitest';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { editorialConfigSchema, type EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import {
  prepareEditorialExpressions, type EditorialTerms,
} from '../../../../../src/newspaper/editorial/config/expressions.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { evaluatePresentation } from '../../../../../src/newspaper/editorial/presentation/eligibility.js';
import { computeFeedback } from '../../../../../src/newspaper/editorial/selection/feedback.js';
import { selectHeuristic } from '../../../../../src/newspaper/editorial/selection/heuristic.js';
import { createEditorialStreams } from '../../../../../src/newspaper/editorial/shared/determinism.js';
import { chooseDesign, presentIssue } from '../../../../../src/newspaper/editorial/presentation/issue.js';
import type { EditorialCandidate } from '../../../../../src/newspaper/editorial/selection/templates.js';
import { validateEditorialIssue } from '../../../../../src/newspaper/editorial/presentation/validation.js';

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
    constants: { distances: {}, spans: { long: 40 }, sizes: {}, shares: {}, types: {}, shortcuts: {} },
    triggers: [
      { id: 'war', subject: 'world', when: 'true', tags: ['military', 'foreign'] },
      { id: 'peace', subject: 'world', when: 'true', tags: ['diplomacy'] },
    ],
    templates: [{
      id: 'coverage', triggers: ['war'], tags: ['military'], weight: { base: 1 },
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
      presentation: { schemaVersion: 1, rendererFamily: 'broadsheet', tokens: { paperColor: '#eeeecc' } },
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
    id, subject: id, period: { from: 1, to: 5 }, triggerIds: [`trigger/${id}`], ruleIds: ['trigger'],
    templateIds: ['coverage'], seriesKeys: [`series/${id}`],
    tags: [urgent ? 'military' : 'economy'], importance: urgent ? 1 : 20, urgent,
    short: false, weight: 1, variants: config.templates[0].variants, variantWeights: { first: 1, second: 2 }, variantSources: {},
    values: { name: id }, sources: [], fingerprint: id,
  };
}

/** Evaluate choices using a receiver snapshot and a foreign snapshot with a known era. */
async function choices(config: EditorialConfig, receiverEra?: string) {
  const facts = buildNewspaperFacts({
    request: { receiverPlayerID: 0, previousCheckTurn: 1, cutoffTurn: 5 },
    players: [
      { subjectID: 0, values: receiverEra ? { Era: receiverEra } : {}, source: { table: 'PlayerSummaries', id: 1, turn: 5, createdAt: 1 } },
      { subjectID: 1, values: { Era: 'Modern Era' }, source: { table: 'PlayerSummaries', id: 2, turn: 5, createdAt: 2 } },
    ],
    cities: [], comparisons: { players: [], cities: [] }, events: [],
  });
  return evaluatePresentation(config, await prepareEditorialExpressions(config), { facts });
}

/** Use the real presentation boundary with deterministic independent choice streams. */
async function render(
  config: EditorialConfig, candidates: EditorialCandidate[], seed = 'campaign/receiver/5',
  terms: EditorialTerms = new Map(),
) {
  const streams = createEditorialStreams(seed, config);
  const weights = await choices(config);
  const result = presentIssue({
    issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
    selected: candidates, state: createInitialPublicationState(), config, weights,
    proseRandom: streams.prose, presentationRandom: streams.presentation, terms,
  })!;
  return { ...result, weights };
}

describe('editorial eligibility', () => {
  it('should require a visible receiver era before selecting the modern design', async () => {
    const config = createConfig();
    config.designs.push({
      ...structuredClone(config.designs[0]), id: 'modern-journal', when: "self.era === 'Modern Era'", weight: { base: 100, adjustments: [] },
    });
    const unknown = await choices(config);
    expect(chooseDesign(config, unknown, null, () => 0.99)?.id).toBe('early-account');
    const modern = await choices(config, 'Modern Era');
    expect(chooseDesign(config, modern, null, () => 0.99)?.id).toBe('modern-journal');
  });
});

describe('masthead terms', () => {
  it('should leave out a design while its title or motto has an unresolved term', async () => {
    const config = createConfig();
    config.designs[0].title = 'The {{terms.capital}} Herald';
    config.designs.push({
      ...structuredClone(config.designs[0]), id: 'fallback', title: 'Fallback', motto: undefined,
    });
    const weights = await choices(config);
    expect(chooseDesign(config, weights, 'early-account', () => 0, new Map())?.id).toBe('fallback');

    const capital: EditorialTerms = new Map([['capital', { value: 'Paris', sources: [] }]]);
    expect(chooseDesign(config, weights, 'early-account', () => 0.99, capital)?.id).toBe('early-account');

    config.designs[0].title = 'Stable title';
    config.designs[0].motto = 'A journal of {{terms.master}}';
    expect(chooseDesign(config, weights, 'early-account', () => 0.99, capital)?.id).toBe('fallback');
    const master: EditorialTerms = new Map([
      ['capital', { value: 'Paris', sources: [] }],
      ['master', { value: 'Persia', sources: [] }],
    ]);
    expect(chooseDesign(config, weights, 'early-account', () => 0.99, master)?.id).toBe('early-account');
  });

  it('should resolve the masthead and source note without attributing terms to unrelated articles', async () => {
    const config = createConfig();
    config.designs[0].title = 'The {{terms.ruler}} Times';
    config.designs[0].motto = '{{terms.amount}} voices';
    const source = { table: 'PlayerSummaries' as const, id: 99, turn: 5, createdAt: 500 };
    const terms: EditorialTerms = new Map([
      ['ruler', { value: 'Party', sources: [source] }],
      ['amount', { value: 0, sources: [source] }],
    ]);
    const result = await render(config, [createCandidate(config, 'home')], 'masthead', terms);

    expect(result.issue.publication).toMatchObject({ title: 'The Party Times', motto: '0 voices' });
    expect(result.issue.items[0].sourceNote).toEqual([
      { type: 'text', text: 'From the editors of The Party Times' },
    ]);
    expect(result.mastheadSources).toEqual([source]);
    const printed = result.itemCandidates.get(result.issue.items[0].id)!;
    expect(printed.sources).not.toEqual(expect.arrayContaining([source]));
  });
});

describe('editorial presentation', () => {
  it('should gently discourage repeated genres and allow mixed voices in one issue', async () => {
    const config = createConfig();
    config.styles = { voice: [{ id: 'general' }, { id: 'wire' }], stance: [{ id: 'neutral' }],
      genre: [{ id: 'report' }, { id: 'letter' }], rules: [] };
    config.defaults.styleRepeat = { voice: 1, stance: 1, genre: 0.5 };
    Object.assign(config.templates[0].variants[1], { voice: 'wire', stance: 'neutral', genre: 'letter' });
    const candidates = ['first', 'second', 'third'].map(id => createCandidate(config, id));
    candidates[0].variantWeights = { first: 1, second: 0 };
    candidates[1].variantWeights = candidates[2].variantWeights = { first: 1, second: 1 };
    const weights = await choices(config);
    /** Supply a draw between the adjusted and unadjusted thresholds to show the configured factor applies. */
    function publish() {
      const draws = [0.5, 0.4, 0.1];
      return presentIssue({
        issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
        selected: candidates, state: createInitialPublicationState(), config, weights,
        proseRandom: () => draws.shift()!, presentationRandom: () => 0,
      })!;
    }
    const styles = [
      { voice: 'general', stance: 'neutral', genre: 'report' },
      { voice: 'wire', stance: 'neutral', genre: 'letter' },
      { voice: 'general', stance: 'neutral', genre: 'report' },
    ];
    expect(Object.values(publish().styles)).toEqual(styles);
    expect(Object.values(publish().styles)).toEqual(styles);
  });

  it('should favor a voice already drawn when its repeat factor is above one', async () => {
    const config = createConfig();
    config.styles = { voice: [{ id: 'general' }, { id: 'wire' }], stance: [{ id: 'neutral' }],
      genre: [{ id: 'report' }, { id: 'letter' }], rules: [] };
    config.defaults.styleRepeat = { voice: 2, stance: 1, genre: 1 };
    Object.assign(config.templates[0].variants[1], { voice: 'wire', stance: 'neutral', genre: 'letter' });
    const candidates = ['first', 'second'].map(id => createCandidate(config, id));
    candidates[0].variantWeights = { first: 1, second: 0 };
    candidates[1].variantWeights = { first: 1, second: 1 };
    const weights = await choices(config);
    /** A draw at the midpoint selects the repeated voice once its weight is doubled. */
    const draws = [0.5, 0.5];
    const result = presentIssue({
      issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
      selected: candidates, state: createInitialPublicationState(), config, weights,
      proseRandom: () => draws.shift()!, presentationRandom: () => 0,
    })!;
    expect(Object.values(result.styles)).toEqual([
      { voice: 'general', stance: 'neutral', genre: 'report' },
      { voice: 'general', stance: 'neutral', genre: 'report' },
    ]);
  });

  it('should follow unadjusted weights when every repeat factor is one', async () => {
    const config = createConfig();
    config.styles = { voice: [{ id: 'general' }, { id: 'wire' }], stance: [{ id: 'neutral' }],
      genre: [{ id: 'report' }, { id: 'letter' }], rules: [] };
    config.defaults.styleRepeat = { voice: 1, stance: 1, genre: 1 };
    Object.assign(config.templates[0].variants[1], { voice: 'wire', stance: 'neutral', genre: 'letter' });
    const candidates = ['first', 'second'].map(id => createCandidate(config, id));
    candidates[0].variantWeights = { first: 1, second: 0 };
    candidates[1].variantWeights = { first: 1, second: 1 };
    const weights = await choices(config);
    /** The second draw sits just under the even split, so any discount on the repeated style would flip it. */
    const draws = [0.5, 0.45];
    const result = presentIssue({
      issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
      selected: candidates, state: createInitialPublicationState(), config, weights,
      proseRandom: () => draws.shift()!, presentationRandom: () => 0,
    })!;
    expect(Object.values(result.styles)).toEqual([
      { voice: 'general', stance: 'neutral', genre: 'report' },
      { voice: 'general', stance: 'neutral', genre: 'report' },
    ]);
  });

  it('should omit sections fully covered by the front page and retain sections with additional stories', async () => {
    const config = createConfig();
    const candidates = ['home', 'trade', 'culture', 'war'].map(id => createCandidate(config, id));
    candidates[3].tags = ['military'];
    expect((await render(config, candidates)).issue.pages.map(page => page.id)).toEqual(['front', 'military']);

    candidates[0].tags = ['military'];
    candidates[3].tags = ['economy'];
    const covered = await render(config, candidates);
    expect(covered.issue.pages.map(page => page.id)).toEqual(['front']);
    expect(covered.layouts).not.toHaveProperty('military');

    config.defaults.frontPageItems = 2;
    candidates[2].tags = ['military'];
    config.pages[1].minimum = 3;
    expect((await render(config, candidates)).issue.pages.map(page => page.id)).toEqual(['front']);

    config.pages[1].minimum = 2;
    const additional = await render(config, candidates);
    expect(additional.issue.pages.map(page => page.id)).toEqual(['front', 'military']);
    expect(additional.issue.pages[1].itemIds.map(id => additional.itemCandidates.get(id)?.id)).toEqual(['home', 'culture']);
  });

  it('should retain a competitive eligible design and replace one that loses weight or eligibility', async () => {
    const config = createConfig();
    config.designs[0].weight = { base: 7, adjustments: [{ when: 'self.id === 0', add: 1 }] };
    config.designs.push({ ...structuredClone(config.designs[0]), id: 'stronger', weight: { base: 10, adjustments: [] } });
    expect(chooseDesign(config, await choices(config), 'early-account', () => 0.99)?.id).toBe('early-account');
    config.designs[0].weight.adjustments[0].when = 'self.id === 1';
    expect(chooseDesign(config, await choices(config), 'early-account', () => 0.99)?.id).toBe('stronger');
    config.designs[0].weight.base = 100;
    config.designs[0].when = 'false';
    expect(chooseDesign(config, await choices(config), 'early-account', () => 0)?.id).toBe('stronger');
  });

  it('should omit unpublished section items when the section condition cannot read a visible fact', async () => {
    const config = createConfig();
    config.defaults.frontPageItems = 2;
    const candidates = ['home', 'trade', 'war'].map(id => createCandidate(config, id));
    candidates[2].tags = ['military'];
    const shown = await render(config, candidates);
    expect(shown.issue.items).toHaveLength(3);
    const visible = structuredClone(config);
    visible.pages[1].when = "self.era === 'Modern Era'";
    const hidden = await render(visible, candidates);
    expect(hidden.issue.pages.map(page => page.id)).toEqual(['front']);
    expect([...hidden.itemCandidates.values()].map(candidate => candidate.id)).toEqual(['home', 'trade']);
    expect(Object.keys(hidden.variants)).toHaveLength(2);
    expect(Object.keys(hidden.styles)).toEqual(hidden.issue.items.map(item => item.id));
    expect(() => validateEditorialIssue(hidden, visible, hidden.weights)).not.toThrow();
    expect(() => validateEditorialIssue(shown, visible, hidden.weights)).toThrow(/ineligible page/i);
  });

  it('should preserve selected prose when only layouts and presentation weights change', async () => {
    const original = createConfig();
    const tuned = structuredClone(original);
    tuned.designs[0].layouts = [
      ...tuned.designs[0].layouts,
      { id: 'analysis', variant: 'analysis', weight: { base: 1000, adjustments: [] } },
    ];
    tuned.pages[1].order = 20;
    for (const seed of ['first-seed', 'second-seed', 'third-seed']) {
      const candidates = [createCandidate(original, 'home'), createCandidate(original, 'trade')];
      const before = await render(original, candidates, seed);
      const after = await render(tuned, candidates, seed);
      expect(after.variants).toEqual(before.variants);
      expect(after.issue.items).toEqual(before.issue.items);
      expect(before.issue.pages[0].layout).toBe('ordinary');
      expect(after.issue.pages[0].layout).toBe('analysis');
    }
  });

  it('should place an incoming threat ahead of higher scoring domestic coverage on a breaking front page', async () => {
    const config = createConfig();
    const state = createInitialPublicationState();
    const candidates = [createCandidate(config, 'domestic'), createCandidate(config, 'war', true)];
    const selected = selectHeuristic(candidates, state, config, computeFeedback(state, config));
    const result = await render(config, selected.selected);
    const front = result.issue.pages[0];
    expect(result.itemCandidates.get(front.itemIds[0])?.id).toBe('war');
    expect(front.layout).toBe('breaking');
    expect(new Set(front.itemIds.map(id => result.itemCandidates.get(id)?.subject)).size).toBe(2);
    expect(() => validateEditorialIssue(result, config, result.weights)).not.toThrow();
  });

  it('should reject conditional or nonpositive layouts even when their base selection weight dominates', async () => {
    const config = createConfig();
    config.designs[0].layouts.push(
      { id: 'unavailable', variant: 'analysis', when: 'false', weight: { base: 10000, adjustments: [] } },
      { id: 'disabled', variant: 'analysis', weight: { base: 10000, adjustments: [{ when: 'self.id === 0', add: -10000 }] } },
    );
    const result = await render(config, [createCandidate(config, 'domestic')]);
    expect(result.issue.pages[0].layout).toBe('ordinary');
    expect(result.layouts.front).toBe('ordinary');
  });
});
