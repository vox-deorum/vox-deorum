import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { ReceiverQuestTerm } from '../../../../../../mcp-server/dist/newspaper/quest-deadlines.js';
import { scaleEditorialConstants } from '../../../../../src/newspaper/editorial/config/constants.js';
import { getEditorialExpressions, loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { renderAuthoredText } from '../../../../../src/newspaper/editorial/presentation/issue.js';
import { evaluateTriggerRules } from '../../../../../src/newspaper/editorial/rules/evaluate.js';
import { matchTemplates } from '../../../../../src/newspaper/editorial/selection/templates.js';

const approaching = 'city-state-quest-deadline-approaching';
const observed = 'city-state-timed-quest-observed';
const disappeared = 'city-state-quest-countdown-disappeared';
const cityState = 10;

let config: EditorialConfig;
let compiled: Awaited<ReturnType<typeof getEditorialExpressions>>;

const playerIdentities = {
  0: { name: 'France', major: true, teamId: 100 },
  [cityState]: { name: 'Geneva', major: false, teamId: 110 },
};

type CheckResult = Awaited<ReturnType<typeof evaluateTriggerRules>>;

interface RunInput {
  turn?: number;
  previous?: number;
  deadlines?: number[];
  priorDeadlines?: number[];
  terms?: ReceiverQuestTerm[];
  priorTerms?: ReceiverQuestTerm[];
  observedTurn?: number;
  cityStateNamed?: boolean;
  repeatState?: CheckResult['repeatState'];
}

/** Build one readable national summary row, optionally carrying absolute quest deadlines. */
function snapshot(player: number, turn: number, deadlines?: number[], terms?: ReceiverQuestTerm[]): NewspaperSnapshot {
  return {
    subjectID: player,
    source: { table: 'PlayerSummaries', id: turn * 100 + player, turn, createdAt: turn * 1000 + player },
    values: deadlines === undefined ? {} : { QuestDeadlines: deadlines, ...(terms ? { QuestTerms: terms } : {}) },
  };
}

/** Evaluate the stock quest rules against a controlled receiver snapshot and history. */
async function run(input: RunInput = {}) {
  const turn = input.turn ?? 20;
  const previous = input.previous ?? 18;
  const current = snapshot(cityState, input.observedTurn ?? turn, input.deadlines, input.terms);
  const prior = input.priorDeadlines === undefined ? undefined : snapshot(cityState, previous, input.priorDeadlines, input.priorTerms);
  const evidence: NewspaperEvidence = {
    request: { receiverPlayerID: 0, previousCheckTurn: previous, cutoffTurn: turn, historyFromTurn: -1 },
    players: [snapshot(0, turn), current],
    cities: [],
    comparisons: { players: [], cities: [] },
    events: [],
    history: {
      fromTurn: -1,
      baseline: { players: [], cities: [] },
      snapshots: { players: prior ? [prior] : [], cities: [] },
      events: [],
      gaps: [],
    },
  };
  const facts = buildNewspaperFacts(evidence, { playerIdentities: input.cityStateNamed === false
    ? { ...playerIdentities, [cityState]: { ...playerIdentities[cityState], name: undefined } }
    : playerIdentities });
  const result = await evaluateTriggerRules({
    rules: config.triggers.filter(rule => [approaching, observed, disappeared].includes(rule.id)),
    compiled,
    facts,
    constants: config.constants,
    speedMultiplier: 1,
    repeatState: input.repeatState,
  });
  return { ...result, facts };
}

/** List the subject keys that actually qualified for one rule. */
function fired(result: CheckResult, rule: string): string[] {
  return result.audit.find(entry => entry.rule === rule)?.subjects
    .filter(subject => subject.outcome === 'fired').map(subject => subject.subject) ?? [];
}

/** Read the development produced by one rule, if any. */
function development(result: CheckResult, rule: string) {
  return result.developments.find(entry => entry.definitionId === rule);
}

/** Render each eligible version of a story with its recorded quest details. */
async function stories(result: Awaited<ReturnType<typeof run>>, rule: string): Promise<string[]> {
  const candidates = await matchTemplates(result.developments.filter(entry => entry.definitionId === rule),
    config, compiled, { facts: result.facts, constants: scaleEditorialConstants(config.constants, 1) });
  return candidates.flatMap(candidate => candidate.variants.map(variant =>
    [variant.headline, ...variant.body].map(passage =>
      renderAuthoredText(passage, candidate.values, variant, candidate.names).map(node => node.text).join('')).join('\n')));
}

const resourceQuest: ReceiverQuestTerm = {
  deadline: 22, type: 'Connect a resource', condition: 'Connect Porcelain to your trade network.',
  reward: '27 Influence, 114 Gold',
};

describe('stock city-state quest deadlines', () => {
  beforeAll(async () => {
    config = await loadEditorialConfig();
    compiled = await getEditorialExpressions(config);
  });

  it('should still print the nearest approaching deadline when the terms are unavailable', async () => {
    const result = await run({ deadlines: [22, 24], priorDeadlines: [22, 24] });
    expect(fired(result, approaching)).toEqual(['player/10']);
    expect(development(result, approaching)).toMatchObject({
      subject: 'player/10', values: { turnsLeft: 2, cityState: 'Geneva' },
    });
    const articles = await stories(result, approaching);
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect(article).toContain('2 turns');
      expect(article).not.toContain('{{');
    }
    expect(fired(result, observed)).toEqual([]);
    expect(result.audit.find(entry => entry.rule === approaching)?.subjects)
      .toContainEqual(expect.objectContaining({ subject: 'player/0', outcome: 'false' }));
  });

  it('should print the type, objective and reward together for the nearest approaching quest', async () => {
    const result = await run({
      deadlines: [22, 23], terms: [
        { deadline: 22, type: 'Build a wonder', condition: 'Build Pyramids.' },
        resourceQuest,
        { deadline: 23, type: 'Build a wonder', condition: 'Build Stonehenge.', reward: '300 Faith' },
      ],
    });
    const articles = await stories(result, approaching);
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect(article).toContain(resourceQuest.type);
      expect(article).toContain(resourceQuest.condition);
      expect(article).toContain('27 Influence');
      expect(article).toContain('114 Gold');
      expect(article).not.toMatch(/Pyramids|Stonehenge|300 Faith/);
    }
  });

  it('should print an objective without implying a reward when a new quest has none recorded', async () => {
    const { reward, ...objective } = resourceQuest;
    const result = await run({ deadlines: [30], terms: [{ ...objective, deadline: 30 }], priorDeadlines: [] });
    const articles = await stories(result, observed);
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect(article).toContain(resourceQuest.type);
      expect(article).toContain(resourceQuest.condition);
      expect(article).not.toContain('Potential reward:');
    }
  });

  it('should use the prior terms when a deadline goes missing', async () => {
    const result = await run({
      deadlines: [30], terms: [{ deadline: 30, type: 'Build a wonder', condition: 'Build Pyramids.', reward: '70 Faith' }],
      priorDeadlines: [25], priorTerms: [{ ...resourceQuest, deadline: 25 }],
    });
    const articles = await stories(result, disappeared);
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect(article).toContain(resourceQuest.type);
      expect(article).toContain(resourceQuest.condition);
      expect(article).toContain('114 Gold');
      expect(article).not.toMatch(/Pyramids|70 Faith/);
    }
  });

  it('should not report a shifted deadline as a new or missing listing for the same objective', async () => {
    const result = await run({
      deadlines: [26], terms: [{ ...resourceQuest, deadline: 26 }],
      priorDeadlines: [25], priorTerms: [{ ...resourceQuest, deadline: 25 }],
    });
    expect(fired(result, observed)).toEqual([]);
    expect(fired(result, disappeared)).toEqual([]);
  });

  it('should report a replaced quest even when the new one shares its deadline', async () => {
    const wonderQuest: ReceiverQuestTerm = { deadline: 30, type: 'Build a wonder', condition: 'Build Pyramids.' };
    const result = await run({
      turn: 20, deadlines: [30], terms: [wonderQuest],
      priorDeadlines: [30], priorTerms: [{ ...resourceQuest, deadline: 30 }],
    });
    expect(fired(result, disappeared)).toEqual(['player/10']);
    expect(development(result, disappeared)?.values).toMatchObject({
      previousDeadline: 30, questCondition: resourceQuest.condition,
    });
    expect(fired(result, observed)).toEqual(['player/10']);
    expect(development(result, observed)?.values).toMatchObject({
      questDeadline: 30, questCondition: wonderQuest.condition,
    });
  });

  it('should reject a deadline report from a stale observation', async () => {
    const result = await run({ deadlines: [22], observedTurn: 18 });
    expect(fired(result, approaching)).toEqual([]);
    expect(fired(result, observed)).toEqual([]);
  });

  it('should skip quest stories when the city-state has no visible name', async () => {
    const observations = { deadlines: [22, 30], priorDeadlines: [25] };
    const named = await run(observations);
    const unnamed = await run({ ...observations, cityStateNamed: false });

    for (const rule of [approaching, observed, disappeared]) {
      expect(fired(named, rule)).toEqual(['player/10']);
      expect(fired(unnamed, rule)).toEqual([]);
    }
  });

  it('should not treat a deadline beyond the reminder range as approaching', async () => {
    const result = await run({ deadlines: [25], priorDeadlines: [25] });
    expect(fired(result, approaching)).toEqual([]);
  });

  it('should report a newly observed distant deadline when the prior snapshot proves it is new', async () => {
    const result = await run({ deadlines: [30], priorDeadlines: [] });
    expect(fired(result, approaching)).toEqual([]);
    expect(fired(result, observed)).toEqual(['player/10']);
    expect(development(result, observed)).toMatchObject({
      subject: 'player/10', tier: 'filler', values: { turnsLeft: 10, cityState: 'Geneva' },
    });
  });

  it('should require a known prior city-state snapshot before calling a deadline new', async () => {
    const result = await run({ deadlines: [30] });
    expect(fired(result, observed)).toEqual([]);
    expect(result.audit.find(entry => entry.rule === observed)?.subjects)
      .toContainEqual(expect.objectContaining({ subject: 'player/10', outcome: 'false' }));
  });

  it('should not report a deadline that the prior snapshot already contained', async () => {
    const result = await run({ deadlines: [30], priorDeadlines: [30] });
    expect(fired(result, observed)).toEqual([]);
  });

  it('should report an estimated future deadline that a fresh tooltip no longer lists', async () => {
    const result = await run({ deadlines: [], priorDeadlines: [25] });
    expect(fired(result, disappeared)).toEqual(['player/10']);
    const entry = development(result, disappeared);
    expect(entry?.values).toMatchObject({ cityState: 'Geneva', previousDeadline: 25 });
    expect(entry?.sources.map(source => source.turn)).toEqual(expect.arrayContaining([18, 20]));
  });

  it.each([
    { priorDeadlines: [19, 20], deadlines: [] },
    { priorDeadlines: [25] },
    { priorDeadlines: [25], deadlines: [], previous: 19, observedTurn: 19 },
    { priorDeadlines: [25], deadlines: [], observedTurn: 18 },
    { priorDeadlines: [25], deadlines: [25] },
  ])('should not infer a missing future countdown from $priorDeadlines and $deadlines without two fresh comparable readings', async input => {
    expect(fired(await run(input), disappeared)).toEqual([]);
  });

  it('should avoid repeating an approaching deadline on the next consecutive check', async () => {
    const first = await run({ deadlines: [22] });
    expect(fired(first, approaching)).toEqual(['player/10']);
    const second = await run({ turn: 21, previous: 20, deadlines: [22], repeatState: first.repeatState });
    expect(fired(second, approaching)).toEqual([]);
    expect(second.audit.find(entry => entry.rule === approaching)?.subjects)
      .toContainEqual(expect.objectContaining({ subject: 'player/10', outcome: 'repeat' }));
  });
});
