/** Check configurable presentation decisions with controlled authored inputs. */
import { describe, expect, it } from 'vitest';
import {
  createInitialPublicationState, editorialDecisionRecordSchema, publicationStateSchema,
} from '../../../../../src/newspaper/contracts/publication.js';
import { editorialConfigSchema, editorialConfigVersion, type EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import {
  prepareEditorialExpressions, type EditorialTerms,
} from '../../../../../src/newspaper/editorial/config/expressions.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { evaluatePresentation, fittingFrontLayouts, prepareFrontLayouts } from '../../../../../src/newspaper/editorial/presentation/eligibility.js';
import { createProseDraw } from '../../../../../src/newspaper/editorial/shared/determinism.js';
import { choosePressRunDesign, presentIssue } from '../../../../../src/newspaper/editorial/presentation/issue.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import type { EditorialCandidate } from '../../../../../src/newspaper/editorial/selection/templates.js';
import { validateEditorialIssue } from '../../../../../src/newspaper/editorial/presentation/validation.js';

/** Build a complete small catalogue whose choices can be varied independently. */
function createConfig(): EditorialConfig {
  return editorialConfigSchema.parse({
    version: editorialConfigVersion,
    defaults: {
      frequencyStandardTurns: 5, llmEnabled: false, publicationTitle: 'Publication',
      maxItems: 10, importanceMax: 100, decayPerTurn: 0.9,
      seriesWeight: 1, noveltyBonus: 1, varietyBonus: 1,
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
      { id: 'front', label: 'Front', tags: [], order: 0, front: true },
      { id: 'military', label: 'Military', tags: ['military'], order: 1 },
    ],
    designs: [{
      id: 'early-account', version: '1', title: 'Account', weight: { base: 1 },
      presentation: { schemaVersion: 1, rendererFamily: 'broadsheet', tokens: { paperColor: '#eeeecc' } },
      layouts: [
        { id: 'ordinary', variant: 'ordinary', frontSlots: 4, sectionSlots: 2, weight: { base: 1 } },
        { id: 'breaking', variant: 'breaking', frontSlots: 4, weight: { base: 1 } },
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
  const ready = [...candidates, ...['market', 'schools', 'science', 'industry'].slice(candidates.length).map(id => createCandidate(config, id))];
  const weights = await choices(config);
  const result = (await presentIssue({
    checkId: seed,
    issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
    selected: ready, state: createInitialPublicationState(), config, weights,
    proseRandom: createProseDraw(seed, config), terms,
  }))!;
  return { ...result, weights };
}

describe('editorial eligibility', () => {
  it('should require a visible receiver era before selecting the modern design', async () => {
    const config = createConfig();
    config.designs.push({
      ...structuredClone(config.designs[0]), id: 'modern-journal', when: "self.era === 'Modern Era'", weight: { base: 100, adjustments: [] },
    });
    const unknown = await choices(config);
    expect([...prepareFrontLayouts(config, unknown).keys()].map(design => design.id)).toEqual(['early-account']);
    const modern = await choices(config, 'Modern Era');
    expect([...prepareFrontLayouts(config, modern).keys()].map(design => design.id)).toEqual(['early-account', 'modern-journal']);
  });
});

describe('press run design selection', () => {
  /** Provide a lead, an alternative at exactly half its weight, and a weaker printable alternative. */
  function catalogue() {
    const config = createConfig();
    const [account] = config.designs;
    account.weight.base = 80;
    config.designs.push(
      { ...structuredClone(account), id: 'town-book', weight: { base: 40, adjustments: [] } },
      { ...structuredClone(account), id: 'dispatch', weight: { base: 39, adjustments: [] } },
    );
    return config;
  }

  /** Simulate saved issues without populating unrelated article or series records. */
  function history(...ids: string[]) {
    const state = createInitialPublicationState();
    state.issues = ids.map((designId, turn) => ({ issueId: `issue/${turn}`, turn, items: [], designId }));
    return publicationStateSchema.parse(state);
  }

  it('should protect the first three published issues and use proportional weights afterward', async () => {
    const config = catalogue();
    const weights = await choices(config);
    const strong = 'early-account';
    expect(choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, history(), () => 0.99).design?.id).toBe('town-book');
    for (const count of [1, 2]) {
      const result = choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, history(...Array(count).fill(strong)), () => {
        throw new Error('A protected issue should not draw.');
      });
      expect(result.design?.id).toBe(strong);
      expect(result.audit).toMatchObject({ previousId: strong, priorRunLength: count, reason: 'protected' });
      expect(result.audit.candidates.every(candidate => candidate.drawWeight === 0)).toBe(true);
    }
    const state = history(strong, strong, strong);
    const continuation = choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, state, () => 0.65);
    expect(continuation.design?.id).toBe(strong);
    expect(continuation.audit).toMatchObject({
      reason: 'weighted',
      candidates: [
        { id: 'dispatch', rawWeight: 39, drawWeight: 0 },
        { id: strong, rawWeight: 80, drawWeight: 80 },
        { id: 'town-book', rawWeight: 40, drawWeight: 40 },
      ],
    });
    expect(choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, state, () => 0.7).design?.id).toBe('town-book');
  });

  it('should require a switch after six issues only when another design fits', async () => {
    const config = catalogue();
    const weights = await choices(config);
    const strong = 'early-account';
    const state = history(...Array(8).fill(strong));
    const result = choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, state, () => 0);
    expect(result.design?.id).toBe('town-book');
    expect(result.audit).toMatchObject({ priorRunLength: 6, reason: 'run-limit' });
    expect(result.audit.candidates.find(candidate => candidate.id === strong)?.drawWeight).toBe(0);

    // A title whose terms cannot be printed does not qualify even at a competitive weight.
    config.designs[1].title = '{{terms.unknown}}';
    const singleton = choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, state, () => 0.99);
    expect(singleton.design?.id).toBe(strong);
    expect(singleton.audit.candidates.map(candidate => candidate.id)).toEqual(['dispatch', strong]);
  });

  it('should redraw for weak or ineligible incumbents and count only consecutive issues', async () => {
    const config = catalogue();
    const weights = await choices(config);
    const weak = choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, history('dispatch'), () => 0);
    expect(weak.design?.id).toBe('early-account');
    expect(weak.audit.reason).toBe('weak-incumbent');
    const ineligible = choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, history('unavailable'), () => 0);
    expect(ineligible.design?.id).toBe('early-account');
    expect(ineligible.audit.reason).toBe('ineligible-incumbent');

    const mixed = history('early-account', 'early-account', 'town-book', 'early-account');
    expect(choosePressRunDesign([...prepareFrontLayouts(config, weights).keys()], weights, mixed, () => 0.99).audit.priorRunLength).toBe(1);
  });

  it('should keep design and page draws stable when masthead copy and catalogue order change', async () => {
    const config = catalogue();
    for (const design of config.designs) {
      design.layouts.push({ id: 'analysis', variant: 'analysis', frontSlots: 4, sectionSlots: 2, weight: { base: 1, adjustments: [] } });
    }
    const revised = structuredClone(config);
    revised.designs.reverse();
    for (const design of revised.designs) {
      design.title = `Revised ${design.title}`;
      design.motto = 'Updated masthead';
    }
    revised.pages.splice(1, 0, {
      ...structuredClone(revised.pages[1]), id: 'extra', tags: ['culture'], order: 0,
    });
    const seen = new Set();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const candidates = ['home', 'trade', 'culture', 'war', 'war-a', 'war-b', 'art-a', 'art-b'].map(id => createCandidate(config, id));
      for (const entry of candidates.slice(4, 6)) entry.tags = ['military'];
      for (const entry of candidates.slice(6)) entry.tags = ['culture'];
      const before = await render(config, candidates, seed);
      const after = await render(revised, candidates, seed);
      seen.add(before.issue.publication.designId);
      expect(after.issue.publication.designId).toBe(before.issue.publication.designId);
      expect(after.issue.publication.title).not.toBe(before.issue.publication.title);
      expect(after.layouts).toMatchObject(before.layouts);
      expect(after.layouts).toHaveProperty('extra');
      expect(after.variants).toMatchObject(before.variants);
    }
    expect(seen).toEqual(new Set(['early-account', 'town-book']));
  });

  it('should save published designs and retain a skipped check audit without spending a slot', async () => {
    const config = catalogue();
    config.triggers[0].repeat = 1;
    for (const id of ['brief-a', 'brief-b', 'brief-c']) {
      config.triggers.push({ ...config.triggers[0], id });
      config.templates.push({ ...structuredClone(config.templates[0]), id, triggers: [id] });
    }
    for (const variant of config.templates.flatMap(template => template.variants)) {
      variant.headline = 'Printable headline';
      variant.body = ['Printable article.'];
    }
    /** Run a check with fresh eligible stories, or make every design ineligible for the skip. */
    async function check(turn: number, state: ReturnType<typeof history>, printable: boolean) {
      const current = structuredClone(config);
      if (!printable) current.designs.forEach(design => { design.when = 'false'; });
      const evidence = {
        request: { receiverPlayerID: 0, previousCheckTurn: state.reportingThroughTurn ?? 0, cutoffTurn: turn },
        players: [], cities: [], comparisons: { players: [], cities: [] }, events: [],
      };
      return runEditorialCheck({
        campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' },
        evidence, facts: buildNewspaperFacts(evidence), speedMultiplier: 1, state, config: current,
      });
    }
    const first = await check(5, history(), true);
    expect(first.status).toBe('published');
    expect(first.state.issues[0].designId).toBe(first.decision.designId);
    expect(first.decision.designSelection).toMatchObject({ reason: 'opening', priorRunLength: 0 });
    const skipped = await check(10, first.state, false);
    expect(skipped.status).toBe('skipped');
    expect(skipped.state.issues).toEqual(first.state.issues);
    expect(editorialDecisionRecordSchema.parse(skipped.decision).designSelection).toEqual({
      previousId: first.decision.designId, priorRunLength: 1, reason: 'no-eligible', candidates: [],
    });
    const next = await check(15, publicationStateSchema.parse(skipped.state), true);
    expect(next.status).toBe('published');
    expect(next.decision.designId).toBe(first.decision.designId);
    expect(next.decision.designSelection).toMatchObject({ reason: 'protected', priorRunLength: 1 });
  });


});

describe('masthead terms', () => {
  it('should use the civilization title, then its pattern, then the base title', async () => {
    const config = createConfig();
    config.designs[0].civilizationTitles = {
      France: 'Special edition',
      Rome: 'The {{terms.capital}} Register',
      '*': '{{terms.civilization}} Register',
    };
    const source = { table: 'PlayerSummaries' as const, id: 99, turn: 5, createdAt: 500 };
    const candidate = createCandidate(config, 'home');

    for (const [name, title] of [['France', 'Special edition'], ['Rome', 'Rome Register']] as const) {
      const result = await render(config, [candidate], 'masthead', new Map([
        ['civilization', { value: name, sources: [source] }],
      ]));
      expect(result.issue.publication.title).toBe(title);
      expect(result.mastheadSources).toEqual([source]);
    }

    const fallback = await render(config, [candidate]);
    expect(fallback.issue.publication.title).toBe(config.designs[0].title);
    expect(fallback.mastheadSources).toEqual([]);
  });

  it('should leave out a design while its title or motto has an unresolved term', async () => {
    const config = createConfig();
    config.designs[0].title = 'The {{terms.capital}} Herald';
    config.designs.push({
      ...structuredClone(config.designs[0]), id: 'fallback', title: 'Fallback', motto: undefined,
    });
    const weights = await choices(config);
    expect([...prepareFrontLayouts(config, weights).keys()].map(design => design.id)).toEqual(['fallback']);

    const capital: EditorialTerms = new Map([['capital', { value: 'Paris', sources: [] }]]);
    expect([...prepareFrontLayouts(config, weights, capital).keys()].map(design => design.id)).toEqual(['early-account', 'fallback']);

    config.designs[0].title = 'Stable title';
    config.designs[0].motto = 'A journal of {{terms.master}}';
    expect([...prepareFrontLayouts(config, weights, capital).keys()].map(design => design.id)).toEqual(['fallback']);
    const master: EditorialTerms = new Map([
      ['capital', { value: 'Paris', sources: [] }],
      ['master', { value: 'Persia', sources: [] }],
    ]);
    expect([...prepareFrontLayouts(config, weights, master).keys()].map(design => design.id)).toEqual(['early-account', 'fallback']);
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
    const candidates = ['first', 'second', 'third', 'fourth'].map(id => createCandidate(config, id));
    candidates[0].variantWeights = { first: 1, second: 0 };
    candidates[1].variantWeights = candidates[2].variantWeights = { first: 1, second: 1 };
    const weights = await choices(config);
    /** Supply a draw between the adjusted and unadjusted thresholds to show the configured factor applies. */
    async function publish() {
      const draws = [0.5, 0.4, 0.1, 0];
      return (await presentIssue({
        checkId: 'check/5',
        issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
        selected: candidates, state: createInitialPublicationState(), config, weights,
        proseRandom: () => draws.shift()!,
      }))!;
    }
    const styles = [
      { voice: 'general', stance: 'neutral', genre: 'report' },
      { voice: 'wire', stance: 'neutral', genre: 'letter' },
      { voice: 'general', stance: 'neutral', genre: 'report' },
    ];
    expect(Object.values((await publish()).styles).slice(0, 3)).toEqual(styles);
    expect(Object.values((await publish()).styles).slice(0, 3)).toEqual(styles);
  });

  it('should favor a voice already drawn when its repeat factor is above one', async () => {
    const config = createConfig();
    config.styles = { voice: [{ id: 'general' }, { id: 'wire' }], stance: [{ id: 'neutral' }],
      genre: [{ id: 'report' }, { id: 'letter' }], rules: [] };
    config.defaults.styleRepeat = { voice: 2, stance: 1, genre: 1 };
    Object.assign(config.templates[0].variants[1], { voice: 'wire', stance: 'neutral', genre: 'letter' });
    const candidates = ['first', 'second', 'third', 'fourth'].map(id => createCandidate(config, id));
    candidates[0].variantWeights = { first: 1, second: 0 };
    candidates[1].variantWeights = { first: 1, second: 1 };
    const weights = await choices(config);
    /** A draw at the midpoint selects the repeated voice once its weight is doubled. */
    const draws = [0.5, 0.5, 0, 0];
    const result = (await presentIssue({
      checkId: 'check/5',
      issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
      selected: candidates, state: createInitialPublicationState(), config, weights,
      proseRandom: () => draws.shift()!,
    }))!;
    expect(Object.values(result.styles).slice(0, 2)).toEqual([
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
    const candidates = ['first', 'second', 'third', 'fourth'].map(id => createCandidate(config, id));
    candidates[0].variantWeights = { first: 1, second: 0 };
    candidates[1].variantWeights = { first: 1, second: 1 };
    const weights = await choices(config);
    /** The second draw sits just under the even split, so any discount on the repeated style would flip it. */
    const draws = [0.5, 0.45, 0, 0];
    const result = (await presentIssue({
      checkId: 'check/5',
      issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
      selected: candidates, state: createInitialPublicationState(), config, weights,
      proseRandom: () => draws.shift()!,
    }))!;
    expect(Object.values(result.styles).slice(0, 2)).toEqual([
      { voice: 'general', stance: 'neutral', genre: 'report' },
      { voice: 'general', stance: 'neutral', genre: 'report' },
    ]);
  });

  it('should fill the front before letting the first section with enough matches claim a story', async () => {
    const config = createConfig();
    config.pages[1].order = 0;
    const foreignId = '\uE000-foreign';
    const cultureId = '\u{10000}-culture';
    config.pages.push(
      { ...config.pages[1], id: cultureId, tags: ['culture'] },
      { ...config.pages[1], id: foreignId, tags: ['foreign'] },
    );
    const candidates = ['home', 'trade', 'science', 'front-war', 'cross-tag', 'foreign', 'culture'].map(id => createCandidate(config, id));
    candidates[3].tags = ['military'];
    candidates[4].tags = ['military', 'foreign', 'culture'];
    candidates[5].tags = ['foreign'];
    candidates[6].tags = ['culture'];

    const result = await render(config, candidates);
    expect(result.issue.pages.map(page => page.id)).toEqual(['front', foreignId]);
    const placed = result.issue.pages.map(page => page.itemIds.map(id => result.itemCandidates.get(id)?.id));
    expect(placed).toEqual([['home', 'trade', 'science', 'front-war'], ['cross-tag', 'foreign']]);
    expect([...result.itemCandidates.values()].map(candidate => candidate.id)).not.toContain('culture');
    expect(() => validateEditorialIssue(result, config, result.weights)).not.toThrow();

    const ordinary = config.designs[0].layouts.find(layout => layout.variant === 'ordinary')!;
    ordinary.sectionSlots = 3;
    expect(() => validateEditorialIssue(result, config, result.weights)).toThrow();
    ordinary.sectionSlots = 2;
    ordinary.frontSlots = 5;
    const longer = await render(config, candidates);
    expect(longer.issue.pages.map(page => page.id)).toEqual(['front']);
    expect(longer.issue.pages[0].itemIds).toHaveLength(5);
    expect(() => validateEditorialIssue(longer, config, longer.weights)).not.toThrow();
    expect(() => validateEditorialIssue(result, config, result.weights)).toThrow();
  });

  it('should remove a protected incumbent if its front cannot fit', async () => {
    const config = createConfig();
    const [short] = config.designs;
    const long = structuredClone(short);
    long.id = 'larger';
    long.layouts.forEach(layout => { layout.frontSlots = 5; });
    config.designs.push(long);
    const weights = await choices(config);
    const state = createInitialPublicationState();
    state.issues.push({ issueId: 'prior', turn: 1, items: [], designId: long.id });

    const prepared = prepareFrontLayouts(config, weights);
    const choice = choosePressRunDesign([...fittingFrontLayouts(prepared, 4, false).keys()], weights, state, () => 0);
    expect(choice.design?.id).toBe(short.id);
    expect(choice.audit).toMatchObject({ reason: 'ineligible-incumbent', candidates: [{ id: short.id }] });
    const protectedChoice = choosePressRunDesign([...fittingFrontLayouts(prepared, 5, false).keys()], weights, state, () => 0);
    expect(protectedChoice.design?.id).toBe(long.id);
  });

  it('should omit unpublished section items when the section condition cannot read a visible fact', async () => {
    const config = createConfig();
    const candidates = ['home', 'trade', 'culture', 'science', 'war', 'war-two'].map(id => createCandidate(config, id));
    candidates[4].tags = candidates[5].tags = ['military'];
    const shown = await render(config, candidates);
    expect(shown.issue.items).toHaveLength(6);
    const visible = structuredClone(config);
    visible.pages[1].when = "self.era === 'Modern Era'";
    const hidden = await render(visible, candidates);
    expect(hidden.issue.pages.map(page => page.id)).toEqual(['front']);
    expect([...hidden.itemCandidates.values()].map(candidate => candidate.id)).toEqual(['home', 'trade', 'culture', 'science']);
    expect(Object.keys(hidden.variants)).toHaveLength(4);
    expect(Object.keys(hidden.styles)).toEqual(hidden.issue.items.map(item => item.id));
    expect(() => validateEditorialIssue(hidden, visible, hidden.weights)).not.toThrow();
    expect(() => validateEditorialIssue(shown, visible, hidden.weights)).toThrow(/ineligible page/i);
  });

  it('should apply prose preferences in rank order and skip unused articles', async () => {
    const config = createConfig();
    const candidates = ['front-a', 'front-b', 'front-c', 'front-d', 'unused', 'section-a', 'section-b']
      .map(id => createCandidate(config, id));
    candidates[5].tags = candidates[6].tags = ['military'];
    // The preferred second subject can move an article on the page without changing style order.
    candidates[1].subject = candidates[0].subject;
    let styled: string[] = [];
    let draws = 0;
    const result = (await presentIssue({
      checkId: 'check/5',
      issueId: 'issue/5', campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'Receiver' }, turn: 5,
      selected: candidates, state: createInitialPublicationState(), config, weights: await choices(config),
      proseRandom: () => { draws++; return 0; },
      prepareProse: async placed => { styled = placed.map(candidate => candidate.id); return placed; },
    }))!;
    expect(styled).toEqual(['front-a', 'front-b', 'front-c', 'front-d', 'section-a', 'section-b']);
    expect(draws).toBe(styled.length);
    expect(result.issue.pages[0].itemIds.map(id => result.itemCandidates.get(id)?.id))
      .toEqual(['front-a', 'front-c', 'front-b', 'front-d']);
  });

  it('should preserve selected prose when only layouts and presentation weights change', async () => {
    const original = createConfig();
    const tuned = structuredClone(original);
    tuned.designs[0].layouts = [
      ...tuned.designs[0].layouts,
      { id: 'analysis', variant: 'analysis', frontSlots: 4, sectionSlots: 2, weight: { base: 1000, adjustments: [] } },
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
    const candidates = [createCandidate(config, 'domestic'), createCandidate(config, 'war', true)];
    const result = await render(config, candidates);
    const front = result.issue.pages[0];
    expect(result.itemCandidates.get(front.itemIds[0])?.id).toBe('war');
    expect(front.layout).toBe('breaking');
    expect(new Set(front.itemIds.map(id => result.itemCandidates.get(id)?.subject)).size).toBe(4);
    expect(() => validateEditorialIssue(result, config, result.weights)).not.toThrow();
  });

  it('should reject conditional or nonpositive layouts even when their base selection weight dominates', async () => {
    const config = createConfig();
    config.designs[0].layouts.push(
      { id: 'unavailable', variant: 'analysis', frontSlots: 4, sectionSlots: 2, when: 'false', weight: { base: 10000, adjustments: [] } },
      { id: 'disabled', variant: 'analysis', frontSlots: 4, sectionSlots: 2, weight: { base: 10000, adjustments: [{ when: 'self.id === 0', add: -10000 }] } },
    );
    const result = await render(config, [createCandidate(config, 'domestic')]);
    expect(result.issue.pages[0].layout).toBe('ordinary');
    expect(result.layouts.front).toBe('ordinary');
  });
});
