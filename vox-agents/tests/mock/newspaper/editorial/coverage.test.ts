import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { TemplateFunnel } from '../../../../src/newspaper/contracts/coverage.js';
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
];
// Six strong candidates fill the five-story edition, so the weak one is outranked.
const templates = [
  template('many', ['all'], 50),
  template('lead', ['large'], 50),
  template('weak', ['first']),
  template('zero', ['large'], 0),
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
  /** Summarize the check as if the given candidates reached the page. */
  const summarize = (status: 'published' | 'skipped') => summarizeCheckCoverage({
    turn: 10, status, audit: rules.audit, funnel, candidates,
    scores: new Map(selection.scores.map(({ id, score }) => [id, score])), outcomes: selection.outcomes,
    printed: new Set(status === 'published' ? selection.selected.map(candidate => candidate.id) : []), mergedInto: new Map(),
  });
  return { config, summarize };
}

describe('newspaper template coverage', () => {
  it('should place each template at the furthest stage it failed to pass', async () => {
    const { config, summarize } = await check();
    const run = summarizeRunCoverage([summarize('published')], config, new Map([['lead', 'cities-test']]));
    const stages = Object.fromEntries(run.templates.map(entry => [entry.id, entry.stage]));
    expect(stages).toEqual({
      many: 'printed', lead: 'printed', weak: 'passed-over', zero: 'weighted-out', blank: 'unprintable', apart: 'not-together', silent: 'not-fired',
    });
    const byId = new Map(run.templates.map(entry => [entry.id, entry]));
    expect(byId.get('lead')).toMatchObject({ desk: 'cities-test', printed: 1, printedTurns: [10] });
    expect(byId.get('many')!.funnel).toMatchObject({ matched: 4, candidates: 4 });
    expect(byId.get('weak')!.desk).toBe('other');
    expect(byId.get('apart')!.funnel.partial).toBe(2);
    expect(run).toMatchObject({ checks: 1, published: 1, turns: { from: 10, to: 10 }, uncoveredIssues: 0 });
  });

  it('should compare a passed-over template with the weakest printed story', async () => {
    const { config, summarize } = await check();
    const coverage = summarize('published');
    const weak = summarizeRunCoverage([coverage], config).templates.find(entry => entry.id === 'weak')!;
    expect(weak.outcomes).toEqual({ outranked: 1 });
    expect(coverage.candidates.filter(candidate => candidate.outcome === 'printed')).toHaveLength(5);
    expect(weak.floor).toBe(coverage.printedFloor);
    expect(weak.bestScore!).toBeLessThan(weak.floor!);
  });

  it('should name the guard that stopped a rule and how many subjects it stopped', async () => {
    const { config, summarize } = await check();
    const rules = new Map(summarizeRunCoverage([summarize('published')], config).rules.map(rule => [rule.id, rule]));
    expect(rules.get('never')).toMatchObject({ subject: 'city', checks: 1, subjects: 4, fired: 0, firedChecks: 0 });
    expect(rules.get('never')!.stops).toEqual([{ key: 'false:1', kind: 'false', guard: 1, source: 'city.population > 100', count: 4 }]);
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
