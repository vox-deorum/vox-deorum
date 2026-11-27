import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { CheckCoverage, TemplateFunnel } from '../../../../src/newspaper/contracts/coverage.js';
import { createInitialPublicationState } from '../../../../src/newspaper/contracts/publication.js';
import { scaleEditorialConstants } from '../../../../src/newspaper/editorial/config/constants.js';
import { getEditorialExpressions, loadEditorialConfig, parseEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { summarizeCheckCoverage, summarizeRunCoverage } from '../../../../src/newspaper/editorial/coverage.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { evaluateTriggerRules } from '../../../../src/newspaper/editorial/rules/evaluate.js';
import { computeFeedback } from '../../../../src/newspaper/editorial/selection/feedback.js';
import { selectHeuristic } from '../../../../src/newspaper/editorial/selection/heuristic.js';
import { matchTemplates } from '../../../../src/newspaper/editorial/selection/templates.js';

const variant = { id: 'account', headline: 'News from {{city}}', body: ['Reported on {{period.to}}.'], weight: { base: 1 } };

/** Build one authored template on the given rules. */
function template(id: string, triggers: string[], weight = 1, variants: unknown[] = [variant]) {
  return { id, triggers, tags: ['cities'], weight: { base: weight }, variants };
}

const triggers = [
  { id: 'all', subject: 'city', tier: 'filler', when: 'true' },
  { id: 'large', subject: 'city', tier: 'filler', when: ['true', 'city.population >= 3'] },
  { id: 'never', subject: 'city', tier: 'filler', when: ['true', 'city.population > 100'] },
  { id: 'first', subject: 'city', tier: 'filler', when: 'city.id === 0' },
  { id: 'last', subject: 'city', tier: 'filler', when: 'city.id === 3' },
  { id: 'staged', subject: 'city', tier: 'filler', when: ['city.population >= 2', 'city.population >= 4', 'false'] },
];
// Six strong candidates fill the five-story edition, so the weak one is outranked.
const templates = [
  template('many', ['all'], 50),
  template('lead', ['large'], 50),
  template('weak', ['first']),
  template('zero', ['large'], 0),
  { ...template('closed', ['large'], 5), when: 'false' },
  template('blank', ['large'], 1, [{ ...variant, headline: 'News from {{city}} and {{missingName}}' }]),
  template('apart', ['first', 'last']),
  template('silent', ['never']),
];

/** Run triggers, matching, and selection for four visible cities with populations 1 to 4. */
async function check() {
  const base = await loadEditorialConfig();
  const config = await parseEditorialConfig({ ...base, defaults: { ...base.defaults, maxItems: 5 }, triggers, templates });
  const cities: NewspaperEvidence['cities'] = Array.from({ length: 4 }, (_, id) => ({
    subjectID: id,
    source: { table: 'CityInformations', id, turn: 10, createdAt: 10 },
    values: { Name: `City ${id}`, OwnerID: 0, Population: id + 1 },
  }));
  const players = [{ subjectID: 0, source: { table: 'PlayerSummaries' as const, id: 2, turn: 10, createdAt: 10 }, values: {} }];
  const facts = buildNewspaperFacts({
    request: { receiverPlayerID: 0, cutoffTurn: 10, previousCheckTurn: 8, historyFromTurn: 5 },
    players, cities, events: [], comparisons: { players: [], cities: [] },
    history: { fromTurn: 5, baseline: { players: [], cities: [] }, snapshots: { players, cities }, events: [], gaps: [] },
  }, { playerIdentities: { 0: { name: 'France', major: true } } });
  const compiled = await getEditorialExpressions(config);
  const rules = await evaluateTriggerRules({ rules: config.triggers, compiled, facts, constants: config.constants, speedMultiplier: 1 });
  const funnel = new Map<string, TemplateFunnel>();
  const candidates = await matchTemplates(rules.developments, config, compiled,
    { facts, constants: scaleEditorialConstants(config.constants, 1) }, undefined, undefined, funnel);
  const state = createInitialPublicationState();
  const selection = selectHeuristic(candidates, state, config, computeFeedback(state, config));
  /** Summarize the check as if the given candidates reached the page, by default every selected one. */
  const summarize = (status: 'published' | 'skipped', page: Partial<Pick<Parameters<typeof summarizeCheckCoverage>[0], 'printed' | 'mergedInto' | 'roundups'>> = {}) =>
    summarizeCheckCoverage({
      turn: 10, status, audit: rules.audit, funnel, candidates,
      scores: new Map(selection.scores.map(({ id, score }) => [id, score])), outcomes: selection.outcomes,
      printed: new Set(status === 'published' ? selection.selected.map(candidate => candidate.id) : []), mergedInto: new Map(),
      ...page,
    });
  return { config, summarize, candidates, selected: selection.selected };
}

describe('newspaper template coverage', () => {
  it('should place each template at the furthest stage it failed to pass', async () => {
    const { config, summarize } = await check();
    const run = summarizeRunCoverage([summarize('published')], config, new Map([['lead', 'cities-test']]));
    const stages = Object.fromEntries(run.templates.map(entry => [entry.id, entry.stage]));
    expect(stages).toEqual({
      many: 'printed', lead: 'printed', weak: 'passed-over', zero: 'weighted-out', closed: 'weighted-out', blank: 'unprintable', apart: 'not-together', silent: 'not-fired',
    });
    const byId = new Map(run.templates.map(entry => [entry.id, entry]));
    expect(byId.get('lead')).toMatchObject({ desk: 'cities-test', printed: 1, printedTurns: [10] });
    expect(byId.get('many')!.funnel).toMatchObject({ matched: 4, candidates: 4 });
    expect(byId.get('weak')!.desk).toBe('other');
    expect(byId.get('apart')!.funnel.partial).toBe(2);
    expect(byId.get('zero')!.funnel).toMatchObject({ zeroWeight: 2, ineligible: 0 });
    expect(byId.get('closed')!.funnel).toMatchObject({ zeroWeight: 0, ineligible: 2 });
    expect(run).toMatchObject({ checks: 1, published: 1, turns: { from: 10, to: 10 }, uncoveredIssues: 0 });
  });

  it('should compare a passed-over template with the weakest printed story', async () => {
    const { config, summarize } = await check();
    const coverage = summarize('published');
    const weak = summarizeRunCoverage([coverage], config).templates.find(entry => entry.id === 'weak')!;
    expect(weak.outcomes).toEqual({ outranked: 1 });
    expect(coverage.candidates.filter(candidate => candidate.outcome === 'printed')).toHaveLength(5);
    expect(weak).toMatchObject({ scoreTurn: 10, floor: coverage.printedFloor });
    expect(weak.bestScore!).toBeLessThan(weak.floor!);
  });

  it('should report the score and floor of the one check where a template came closest', async () => {
    const { config } = await check();
    /** One published check where the weak template lost with the given score. */
    const lost = (turn: number, score: number, printedFloor: number): CheckCoverage => ({
      turn, status: 'published', printedFloor, rules: {}, templates: {},
      candidates: [{ id: `weak/${turn}`, template: 'weak', subject: 'city/0', rules: ['first'], importance: 10, score, outcome: 'outranked' }],
    });
    const weak = summarizeRunCoverage([lost(20, 70, 90), lost(25, 10, 40)], config).templates.find(entry => entry.id === 'weak')!;
    expect(weak).toMatchObject({ scoreTurn: 20, bestScore: 70, floor: 90 });
  });

  it('should tell stories without a slot apart from those in a skipped check', async () => {
    const { summarize, selected } = await check();
    const coverage = summarize('published', { printed: new Set(selected.slice(1).map(candidate => candidate.id)) });
    expect(coverage.candidates.find(candidate => candidate.id === selected[0].id)!.outcome).toBe('unplaced');
  });

  it('should credit a roundup to its merge template and its absorbed stories as merged', async () => {
    const { config, summarize, candidates, selected } = await check();
    const anchor = candidates.find(candidate => candidate.templateIds[0] === 'weak')!;
    const member = selected[1];
    const roundup = { ...anchor, id: 'roundup', mergedCandidateIds: [member.id] };
    const coverage = summarize('published', {
      printed: new Set(selected.filter(candidate => candidate !== member).map(candidate => candidate.id)),
      mergedInto: new Map([[member.id, 'roundup']]), roundups: [{ story: roundup, score: 999 }],
    });
    expect(coverage.candidates.find(candidate => candidate.id === member.id)).toMatchObject({ outcome: 'merged', mergedInto: 'roundup' });
    expect(coverage.candidates.find(candidate => candidate.id === 'roundup')).toMatchObject({ template: 'weak', outcome: 'printed', score: 999 });
    expect(summarizeRunCoverage([coverage], config).templates.find(entry => entry.id === 'weak')!.stage).toBe('printed');
  });

  it('should list the stops of a rule in guard order with how many subjects reached each', async () => {
    const { config, summarize } = await check();
    const staged = summarizeRunCoverage([summarize('published')], config).rules.find(rule => rule.id === 'staged')!;
    expect(staged.stops.map(({ guard, reached, count }) => ({ guard, reached, count }))).toEqual([
      { guard: 0, reached: 4, count: 1 }, { guard: 1, reached: 3, count: 2 }, { guard: 2, reached: 1, count: 1 },
    ]);
  });

  it('should count every outcome of one guard against the subjects that reached it', async () => {
    const { config } = await check();
    /** One check where the second guard of the staged rule stopped three subjects in two ways. */
    const coverage: CheckCoverage = {
      turn: 10, status: 'skipped', printedFloor: null, templates: {}, candidates: [],
      rules: { staged: { subjects: 10, fired: 0, stops: { 'false:0': 5, 'false:1': 2, 'hidden:1': 1, 'false:2': 2 } } },
    };
    const staged = summarizeRunCoverage([coverage], config).rules.find(rule => rule.id === 'staged')!;
    expect(staged.stops.map(({ key, reached }) => [key, reached])).toEqual([['false:0', 10], ['false:1', 5], ['hidden:1', 5], ['false:2', 2]]);
  });

  it('should name the guard that stopped a rule and how many subjects it stopped', async () => {
    const { config, summarize } = await check();
    const rules = new Map(summarizeRunCoverage([summarize('published')], config).rules.map(rule => [rule.id, rule]));
    expect(rules.get('never')).toMatchObject({ subject: 'city', checks: 1, subjects: 4, fired: 0, firedChecks: 0 });
    expect(rules.get('never')!.stops).toEqual([{ key: 'false:1', kind: 'false', guard: 1, source: 'city.population > 100', reached: 4, count: 4 }]);
    expect(rules.get('large')).toMatchObject({ subjects: 4, fired: 2, stops: [{ kind: 'false', guard: 1, count: 2 }] });
  });

  it('should mark selected stories as unpublished when the check skips', async () => {
    const { config, summarize } = await check();
    const coverage = summarize('skipped');
    expect(coverage.printedFloor).toBeNull();
    expect(coverage.candidates.filter(candidate => candidate.outcome === 'unpublished')).toHaveLength(5);
    const run = summarizeRunCoverage([coverage], config);
    expect(run.published).toBe(0);
    expect(run.templates.find(entry => entry.id === 'lead')!.stage).toBe('passed-over');
  });
});
