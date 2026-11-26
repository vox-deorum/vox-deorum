import { beforeAll, describe, expect, it } from 'vitest';
import type {
  NewspaperCongressObservation, NewspaperDiplomacySnapshot, NewspaperEvent, NewspaperEvidence, NewspaperSnapshot,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { TriggerRuleAudit } from '../../../../../src/newspaper/contracts/triggers.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { context, relationship, snapshot } from '../../../../helpers/newspaper-diplomacy.js';

const ruleIds = [
  'denounced-by-major', 'becomes-vassal', 'gains-vassal', 'score-leader-changes',
  'falls-to-last-place', 'golden-age-begins', 'faith-drifts', 'treasury-falls-into-deficit',
  'unhappiness-sets-in', 'revolt-threshold-crossed', 'war-weariness-sets-in',
  'war-turns-against-us', 'war-turns-our-way',
  'ideology-adopted', 'rival-adopts-ideology', 'policy-branch-opened', 'religion-founded',
  'new-era', 'happiness-recovers', 'treasury-returns-to-surplus', 'golden-age-ends', 'peace-returns',
  'cities-share-grievance', 'city-pillaged-unrest', 'city-famine-unrest',
  'congress-session-imminent', 'congress-voting-opens', 'congress-new-proposals',
  'congress-resolution-passed', 'congress-resolution-defeated', 'congress-sanctions-on-us',
  'congress-world-ideology', 'congress-world-religion', 'congress-world-project',
];

let stockConfig: EditorialConfig;
let config: EditorialConfig;

const playerIdentities = Object.fromEntries(Object.entries(context.playerNames!).map(([id, name]) => [
  id, { name, major: Number(id) < 10, teamId: Number(id) + 100 },
]));

/** Record a dated player snapshot whose source identity can match a diplomacy observation. */
function playerRow(id: number, turn: number, values: NewspaperSnapshot['values'] = {}): NewspaperSnapshot {
  return { subjectID: id, values, source: { table: 'PlayerSummaries', id: turn * 100 + id, turn, createdAt: turn * 1000 } };
}

/** Record a city snapshot with an explicit owner and recorded unhappiness causes. */
function cityRow(id: number, turn: number, owner: number, name: string, values: NewspaperSnapshot['values'] = {}): NewspaperSnapshot {
  return {
    subjectID: id, values: { OwnerID: owner, Name: name, X: id, Y: 0, ...values },
    source: { table: 'CityInformations', id: turn * 100 + id, turn, createdAt: turn * 1000 + 5 },
  };
}

/** Record one witnessed native event at a reporting turn. */
function eventRow(type: string, id: number, turn: number, values: NewspaperEvent['values']): NewspaperEvent {
  return { type, values, source: { table: 'GameEvents', id, turn, createdAt: turn * 1000 } };
}

/** Record one public Congress observation at a source turn. */
function congressObservation(
  turn: number, id: number, fields: Partial<NewspaperCongressObservation> = {},
): NewspaperCongressObservation {
  return {
    source: { table: 'VictoryProgress', id, turn, createdAt: turn * 10 + id },
    available: true, votingNow: false, proposals: [], activeResolutions: [], ...fields,
  };
}

/** Build an evidence envelope with explicit cutoff, prior history, diplomacy and Congress records. */
function fixture({
  cutoff = 10, previous = 5, players = [playerRow(0, cutoff)], beforePlayers = [],
  cities = [], beforeCities = [], events = [], diplomacy = [], congress,
}: {
  cutoff?: number;
  previous?: number;
  players?: NewspaperSnapshot[];
  beforePlayers?: NewspaperSnapshot[];
  cities?: NewspaperSnapshot[];
  beforeCities?: NewspaperSnapshot[];
  events?: NewspaperEvent[];
  diplomacy?: NewspaperDiplomacySnapshot[];
  congress?: NewspaperEvidence['congress'];
} = {}): NewspaperEvidence {
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: previous, cutoffTurn: cutoff, historyFromTurn: -1 },
    players, cities, comparisons: { players: [], cities: beforeCities }, events,
    history: {
      fromTurn: -1, baseline: { players: [], cities: [] },
      snapshots: { players: [...beforePlayers, ...players], cities: [...beforeCities, ...cities] },
      events, gaps: [],
    },
    ...(diplomacy.length ? { diplomacy: { fromTurn: -1, baseline: [], history: diplomacy, gaps: [] } } : {}),
    ...(congress ? { congress } : {}),
  };
}

/** Build a continuous war pair with optional directional score and weariness readings. */
function warEvidence(
  extra: Partial<NewspaperDiplomacySnapshot['relationships'][number]> = {},
  distance = 4,
): NewspaperEvidence {
  const cutoff = 10;
  return fixture({
    cutoff, previous: 5,
    players: [playerRow(0, cutoff), playerRow(1, cutoff)],
    cities: [
      cityRow(10, cutoff, 0, 'Tours', { X: 0 }),
      cityRow(20, cutoff, 1, 'Recife', { X: distance }),
    ],
    diplomacy: [
      snapshot(0, cutoff, [relationship(1, 'war', extra)]),
      snapshot(1, cutoff, [relationship(0, 'war')]),
    ],
  });
}

/** Run the stock definitions for the new rules and return the trigger audit. */
async function check(evidence: NewspaperEvidence, catalogue = config): Promise<TriggerRuleAudit[]> {
  const facts = buildNewspaperFacts(evidence, { playerIdentities },
    { ideologies: catalogue.constants.types.ideologies });
  const result = await runEditorialCheck({
    campaignId: 'fixture', timelineId: 'politics-desk', receiver: { playerId: 0, label: 'France' },
    evidence, facts, config: catalogue, speedMultiplier: 1, state: createInitialPublicationState(), context,
  });
  return result.decision.triggerAudit;
}

/** Select one rule's audit record. */
function rule(audit: readonly TriggerRuleAudit[], id: string): TriggerRuleAudit {
  const entry = audit.find(candidate => candidate.rule === id);
  if (!entry) throw new Error(`Missing audit for ${id}.`);
  return entry;
}

/** Read the subjects that fired for one rule. */
function firedSubjects(record: TriggerRuleAudit) {
  return record.subjects.filter(subject => subject.outcome === 'fired');
}

/** Read one named value from an audit subject. */
function subjectValue(record: TriggerRuleAudit['subjects'][number], name: string) {
  const expression = record.expressions.find(entry => entry.field === `values.${name}`);
  if (!expression) throw new Error(`Missing value ${name}.`);
  return expression.value;
}

describe('stock politics desk', () => {
  beforeAll(async () => {
    stockConfig = await loadEditorialConfig();
    config = {
      ...stockConfig,
      triggers: stockConfig.triggers.filter(candidate => ruleIds.includes(candidate.id)),
      templates: stockConfig.templates.filter(template => template.triggers.some(id => ruleIds.includes(id))),
    };
  });

  it('should evaluate every new rule without non-hidden errors on an empty evidence window', async () => {
    const audit = await check(fixture({ cutoff: 10, previous: 5 }), stockConfig);
    expect(audit.map(entry => entry.rule)).toEqual(expect.arrayContaining(ruleIds));
    for (const id of ruleIds) {
      const record = rule(audit, id);
      expect(record.subjects.every(subject => subject.outcome !== 'error')).toBe(true);
      expect(record.groups.every(group => group.outcome !== 'error')).toBe(true);
    }
  });

  describe('politics and standing', () => {
    it('should report a major denouncement and both directions of vassalage', async () => {
      const cutoff = 10;
      const denounced = await check(fixture({
        cutoff,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        diplomacy: [
          snapshot(0, cutoff, [relationship(1, 'peace', { denouncedByThem: true })]),
          snapshot(1, cutoff, [relationship(0, 'peace')]),
        ],
      }));
      const denouncement = firedSubjects(rule(denounced, 'denounced-by-major'));
      expect(denouncement).toHaveLength(1);
      expect(denouncement[0].subject).toBe('player/1');
      expect(subjectValue(denouncement[0], 'civilization')).toBe('Brazil');

      const becomes = await check(fixture({
        cutoff,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        diplomacy: [
          snapshot(0, cutoff, [relationship(1, 'peace', { master: 'voluntary' })]),
          snapshot(1, cutoff, [relationship(0, 'peace')]),
        ],
      }));
      const vassal = firedSubjects(rule(becomes, 'becomes-vassal'));
      expect(vassal).toHaveLength(1);
      expect(vassal[0]).toMatchObject({ subject: 'player/1', importance: 90, urgent: true });
      expect(subjectValue(vassal[0], 'master')).toBe('Brazil');

      const gains = await check(fixture({
        cutoff,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        diplomacy: [
          snapshot(0, cutoff, [relationship(1, 'peace', { vassal: 'voluntary' })]),
          snapshot(1, cutoff, [relationship(0, 'peace')]),
        ],
      }));
      const master = firedSubjects(rule(gains, 'gains-vassal'));
      expect(master).toHaveLength(1);
      expect(master[0].subject).toBe('player/1');
      expect(vassal[0].importance).toBeGreaterThan(master[0].importance!);
      expect(subjectValue(master[0], 'vassal')).toBe('Brazil');
    });

    it('should report a new score leader and a separate fall to last place from the short window', async () => {
      const cutoff = 30;
      const leading = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { Score: 100 }), playerRow(1, cutoff, { Score: 90 }), playerRow(2, cutoff, { Score: 80 })],
        beforePlayers: [playerRow(0, 20, { Score: 70 }), playerRow(1, 20, { Score: 90 }), playerRow(2, 20, { Score: 80 })],
      }));
      const leader = firedSubjects(rule(leading, 'score-leader-changes'));
      expect(leader).toHaveLength(1);
      expect(leader[0]).toMatchObject({ subject: 'player/0', importance: 75 });
      expect(subjectValue(leader[0], 'civilization')).toBe('France');
      expect(subjectValue(leader[0], 'tied')).toBe(false);

      const trailing = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { Score: 60 }), playerRow(1, cutoff, { Score: 100 }), playerRow(2, cutoff, { Score: 90 })],
        beforePlayers: [playerRow(0, 20, { Score: 95 }), playerRow(1, 20, { Score: 100 }), playerRow(2, 20, { Score: 90 })],
      }));
      const last = firedSubjects(rule(trailing, 'falls-to-last-place'));
      expect(last).toHaveLength(1);
      expect(last[0].subject).toBe('world');
      expect(subjectValue(last[0], 'count')).toBe(3);

      const smallField = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { Score: 60 }), playerRow(1, cutoff, { Score: 100 })],
        beforePlayers: [playerRow(0, 20, { Score: 95 }), playerRow(1, 20, { Score: 100 })],
      }));
      expect(firedSubjects(rule(smallField, 'falls-to-last-place'))).toEqual([]);
    });

    it('should report our Golden Age only while peace is readable at the cutoff', async () => {
      const cutoff = 30;
      const start = eventRow('PlayerGoldenAge', 1, 28, { PlayerID: 0, Starting: true });
      const peaceful = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        beforePlayers: [playerRow(0, 20), playerRow(1, 20)],
        events: [start],
        diplomacy: [
          snapshot(0, cutoff, [relationship(1, 'peace')]),
          snapshot(1, cutoff, [relationship(0, 'peace')]),
        ],
      }));
      const goldenAge = firedSubjects(rule(peaceful, 'golden-age-begins'));
      expect(goldenAge).toHaveLength(1);
      expect(goldenAge[0].subject).toBe('event/1');

      const continuing = eventRow('PlayerGoldenAge', 2, 28, { PlayerID: 0, Starting: false });
      const ended = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        beforePlayers: [playerRow(0, 20), playerRow(1, 20)],
        events: [continuing],
        diplomacy: [
          snapshot(0, cutoff, [relationship(1, 'peace')]),
          snapshot(1, cutoff, [relationship(0, 'peace')]),
        ],
      }));
      expect(firedSubjects(rule(ended, 'golden-age-begins'))).toEqual([]);

      const wartime = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        beforePlayers: [playerRow(0, 20), playerRow(1, 20)],
        events: [start],
        diplomacy: [
          snapshot(0, cutoff, [relationship(1, 'war')]),
          snapshot(1, cutoff, [relationship(0, 'war')]),
        ],
      }));
      expect(firedSubjects(rule(wartime, 'golden-age-begins'))).toEqual([]);
    });

    it('should report a founded faith that is no longer the majority', async () => {
      const cutoff = 10;
      const drifted = await check(fixture({
        cutoff, players: [playerRow(0, cutoff, { FoundedReligion: 'Taoism', MajorityReligion: 'Buddhism' })],
      }));
      const record = rule(drifted, 'faith-drifts');
      const fired = firedSubjects(record);
      expect(fired).toHaveLength(1);
      expect(fired[0]).toMatchObject({ subject: 'world', importance: 60 });
      expect(subjectValue(fired[0], 'founded')).toBe('Taoism');
      expect(subjectValue(fired[0], 'majorityFaith')).toBe('Buddhism');

      const steady = await check(fixture({
        cutoff, players: [playerRow(0, cutoff, { FoundedReligion: 'Taoism', MajorityReligion: 'Taoism' })],
      }));
      expect(firedSubjects(rule(steady, 'faith-drifts'))).toEqual([]);
    });

    it('should report a treasury moving from surplus to deficit in the recent window', async () => {
      const cutoff = 30;
      const deficit = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { GoldPerTurn: -4 })],
        beforePlayers: [playerRow(0, 20, { GoldPerTurn: 2 })],
      }));
      const record = rule(deficit, 'treasury-falls-into-deficit');
      const fired = firedSubjects(record);
      expect(fired).toHaveLength(1);
      expect(fired[0].subject).toBe('world');
      expect(subjectValue(fired[0], 'deficit')).toBe(4);

      const alreadyNegative = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { GoldPerTurn: -4 })],
        beforePlayers: [playerRow(0, 20, { GoldPerTurn: -1 })],
      }));
      expect(firedSubjects(rule(alreadyNegative, 'treasury-falls-into-deficit'))).toEqual([]);
    });

    it('should separate a fall into unhappiness from a revolt threshold crossing', async () => {
      const cutoff = 30;
      const unhappy = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { HappinessPercentage: 40 })],
        beforePlayers: [playerRow(0, 20, { HappinessPercentage: 55 })],
      }));
      const unhappyRecord = rule(unhappy, 'unhappiness-sets-in');
      const unhappyFired = firedSubjects(unhappyRecord);
      expect(unhappyFired).toHaveLength(1);
      expect(unhappyFired[0].subject).toBe('world');
      expect(subjectValue(unhappyFired[0], 'happiness')).toBe(40);
      expect(subjectValue(unhappyFired[0], 'dropPoints')).toBe(15);
      expect(firedSubjects(rule(unhappy, 'revolt-threshold-crossed'))).toEqual([]);

      const revolt = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { HappinessPercentage: 30 })],
        beforePlayers: [playerRow(0, 20, { HappinessPercentage: 40 })],
      }));
      const revoltRecord = rule(revolt, 'revolt-threshold-crossed');
      const revoltFired = firedSubjects(revoltRecord);
      expect(revoltFired).toHaveLength(1);
      expect(revoltFired[0]).toMatchObject({ subject: 'world', urgent: true });
      expect(revoltFired[0].importance).toBeGreaterThan(unhappyFired[0].importance!);
      expect(subjectValue(revoltFired[0], 'happiness')).toBe(30);
      expect(firedSubjects(rule(revolt, 'unhappiness-sets-in'))).toEqual([]);
    });
  });

  describe('war pairs', () => {
    it('should report weariness only from our own directional war record', async () => {
      const weary = await check(warEvidence({ warWeariness: 60 }));
      const record = rule(weary, 'war-weariness-sets-in');
      const fired = firedSubjects(record);
      expect(fired).toHaveLength(1);
      expect(fired[0].subject).toBe('pair/0/1');
      expect(subjectValue(fired[0], 'opponent')).toBe('Brazil');
      expect(subjectValue(fired[0], 'wearinessPercent')).toBe(60);

      const rested = await check(warEvidence({ warWeariness: 20 }));
      expect(firedSubjects(rule(rested, 'war-weariness-sets-in'))).toEqual([]);
    });

    it('should turn war coverage when the score crosses the threshold in either direction', async () => {
      const against = await check(warEvidence({ warScore: -30 }));
      const losing = firedSubjects(rule(against, 'war-turns-against-us'));
      expect(losing).toHaveLength(1);
      expect(losing[0]).toMatchObject({ subject: 'pair/0/1', tier: 'notable' });
      expect(subjectValue(losing[0], 'score')).toBe(-30);

      const distant = await check(warEvidence({ warScore: -30 }, config.constants.distances.regional + 5));
      const distantLoss = firedSubjects(rule(distant, 'war-turns-against-us'));
      expect(distantLoss).toHaveLength(1);
      expect(losing[0].importance).toBeGreaterThan(distantLoss[0].importance!);

      const forward = await check(warEvidence({ warScore: 30 }));
      const winning = firedSubjects(rule(forward, 'war-turns-our-way'));
      expect(winning).toHaveLength(1);
      expect(winning[0].subject).toBe('pair/0/1');
      expect(subjectValue(winning[0], 'score')).toBe(30);

      const stalemate = await check(warEvidence({ warScore: 10 }));
      expect(firedSubjects(rule(stalemate, 'war-turns-against-us'))).toEqual([]);
      expect(firedSubjects(rule(stalemate, 'war-turns-our-way'))).toEqual([]);
    });
  });

  describe('city unrest', () => {
    it('should group three cities that share the largest unhappiness cause', async () => {
      const cities = ['Paris', 'Tours', 'Lyon'].map((name, index) =>
        cityRow(10 + index, 10, 0, name, { UnhappinessSources: { Distress: 6, Famine: 2 } }));
      const audit = await check(fixture({ cutoff: 10, players: [playerRow(0, 10)], cities }));
      const record = rule(audit, 'cities-share-grievance');
      expect(record.groups).toHaveLength(1);
      expect(record.groups[0]).toMatchObject({ key: 'distress', outcome: 'fired' });
      expect(record.groups[0].matches.map(match => match.subject)).toEqual(['city/10', 'city/11', 'city/12']);

      const sparse = await check(fixture({ cutoff: 10, players: [playerRow(0, 10)], cities: cities.slice(0, 2) }));
      expect(rule(sparse, 'cities-share-grievance').groups[0].outcome).toBe('too-small');
    });

    it('should distinguish pillaged tiles from famine as the leading cause', async () => {
      const pillaged = cityRow(20, 10, 0, 'Paris', { UnhappinessSources: { PillagedTiles: 5, Famine: 2 } });
      const audit = await check(fixture({ cutoff: 10, players: [playerRow(0, 10)], cities: [pillaged] }));
      const pillageRecord = rule(audit, 'city-pillaged-unrest');
      const pillageFired = firedSubjects(pillageRecord);
      expect(pillageFired).toHaveLength(1);
      expect(pillageFired[0]).toMatchObject({ subject: 'city/20', importance: 60 });
      expect(subjectValue(pillageFired[0], 'pillagedPopulation')).toBe(5);
      expect(firedSubjects(rule(audit, 'city-famine-unrest'))).toEqual([]);

      const famine = cityRow(21, 10, 0, 'Tours', { UnhappinessSources: { Famine: 4, PillagedTiles: 1 } });
      const second = await check(fixture({ cutoff: 10, players: [playerRow(0, 10)], cities: [famine] }));
      const famineFired = firedSubjects(rule(second, 'city-famine-unrest'));
      expect(famineFired).toHaveLength(1);
      expect(famineFired[0]).toMatchObject({ subject: 'city/21', importance: 60 });
      expect(subjectValue(famineFired[0], 'faminePopulation')).toBe(4);
    });
  });

  describe('Congress', () => {
    const cutoff = 20;
    const previous = 17;

    /** Build a cutoff player and a Congress observation carrying the supplied agenda. */
    function congressFixture(fields: Partial<NewspaperCongressObservation>): NewspaperEvidence {
      return fixture({
        cutoff, previous,
        players: [playerRow(0, cutoff)],
        congress: { observations: [congressObservation(cutoff, 10, fields)] },
      });
    }

    it('should report an expected session next turn and an open vote', async () => {
      const imminent = await check(congressFixture({
        league: 'World Congress', expectedSessionTurn: cutoff + 1,
      }));
      const session = firedSubjects(rule(imminent, 'congress-session-imminent'));
      expect(session).toHaveLength(1);
      expect(session[0].subject).toBe('world');
      expect(subjectValue(session[0], 'league')).toBe('World Congress');
      expect(subjectValue(session[0], 'count')).toBe(0);

      const voting = await check(congressFixture({ votingNow: true }));
      expect(firedSubjects(rule(voting, 'congress-voting-opens')).map(subject => subject.subject)).toEqual(['world']);
    });

    it('should report named new proposals and rank our own higher', async () => {
      /** Supply the same new proposal with a different sponsor. */
      const withProposal = (proposer?: string) => fixture({
        cutoff, previous,
        players: [playerRow(0, cutoff)],
        congress: {
          baseline: congressObservation(previous, 11, {
            proposals: [{ name: 'Arts Funding', isEnact: true }],
          }),
          observations: [congressObservation(cutoff, 12, {
            proposals: [
              { name: 'Arts Funding', isEnact: true },
              { name: 'Unattributed Motion', isEnact: true },
              { name: 'World Religion', isEnact: true, proposer },
            ],
          })],
        },
      });
      const record = rule(await check(withProposal('France')), 'congress-new-proposals');
      const fired = firedSubjects(record);
      expect(fired).toHaveLength(1);
      expect(fired[0].subject).toBe('world');
      expect(subjectValue(fired[0], 'count')).toBe(1);
      expect(subjectValue(fired[0], 'proposal')).toBe('World Religion');
      expect(subjectValue(fired[0], 'proposer')).toBe('France');
      expect(subjectValue(fired[0], 'ours')).toBe(true);

      const foreign = firedSubjects(rule(await check(withProposal('Brazil')), 'congress-new-proposals'));
      expect(foreign).toHaveLength(1);
      expect(subjectValue(foreign[0], 'ours')).toBe(false);
      expect(fired[0].importance).toBeGreaterThan(foreign[0].importance!);
      expect(firedSubjects(rule(await check(withProposal()), 'congress-new-proposals'))).toEqual([]);
    });

    it('should distinguish a passed resolution from a defeated one and prefer our own proposal', async () => {
      const passed = eventRow('ResolutionResult', 900, 19, {
        IsEnact: true, Passed: true, ResolutionType: 'World Religion',
        ProposerPlayerID: 0, ProposerName: 'France', Decision: 1,
      });
      const passing = await check(fixture({
        cutoff, previous,
        players: [playerRow(0, cutoff)],
        beforePlayers: [playerRow(0, previous)],
        events: [passed],
      }));
      const passRecord = rule(passing, 'congress-resolution-passed');
      const passedFired = firedSubjects(passRecord);
      expect(passedFired).toHaveLength(1);
      expect(passedFired[0].subject).toBe('event/900');
      expect(subjectValue(passedFired[0], 'resolution')).toBe('World Religion');
      expect(subjectValue(passedFired[0], 'isEnact')).toBe(true);
      expect(subjectValue(passedFired[0], 'proposer')).toBe('France');
      expect(subjectValue(passedFired[0], 'ours')).toBe(true);

      const defeated = eventRow('ResolutionResult', 901, 19, {
        IsEnact: false, Passed: false, ResolutionType: 'Embargo City-States',
        ProposerPlayerID: 1, ProposerName: 'Brazil', Decision: 2,
      });
      const unresolved = eventRow('ResolutionResult', 902, 19, { IsEnact: false, Passed: false, ResolutionType: 5 });
      const unnamed = eventRow('ResolutionResult', 903, 19, {
        IsEnact: false, Passed: false, ResolutionType: 'Travel Ban',
      });
      const defeating = await check(fixture({
        cutoff, previous,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        beforePlayers: [playerRow(0, previous), playerRow(1, previous)],
        events: [defeated, unresolved, unnamed],
      }));
      const failedFired = firedSubjects(rule(defeating, 'congress-resolution-defeated'));
      expect(failedFired).toHaveLength(1);
      expect(failedFired[0].subject).toBe('event/901');
      expect(passedFired[0].importance).toBeGreaterThan(failedFired[0].importance!);
      expect(subjectValue(failedFired[0], 'resolution')).toBe('Embargo City-States');
      expect(subjectValue(failedFired[0], 'isEnact')).toBe(false);
      expect(subjectValue(failedFired[0], 'proposer')).toBe('Brazil');
      expect(subjectValue(failedFired[0], 'ours')).toBe(false);
    });

    it('should report sanctions and world resolutions against our identity', async () => {
      const player = playerRow(0, cutoff, {
        PolicyBranches: { Order: [] }, FoundedReligion: 'Taoism', MajorityReligion: 'Buddhism',
      });
      const withAgenda = (resolutions: NewspaperCongressObservation['activeResolutions']) =>
        fixture({
          cutoff, previous, players: [player],
          congress: { observations: [congressObservation(cutoff, 13, { activeResolutions: resolutions })] },
        });

      const sanctions = rule(await check(withAgenda([{ name: 'Sanction (France)' }])), 'congress-sanctions-on-us');
      const sanctionFired = firedSubjects(sanctions);
      expect(sanctionFired).toHaveLength(1);
      expect(sanctionFired[0]).toMatchObject({ subject: 'world', urgent: true });
      expect(subjectValue(sanctionFired[0], 'resolution')).toBe('Sanction (France)');

      const ideology = rule(await check(withAgenda([{ name: 'World Ideology: Order' }])), 'congress-world-ideology');
      const ideologyFired = firedSubjects(ideology);
      expect(ideologyFired).toHaveLength(1);
      expect(subjectValue(ideologyFired[0], 'resolution')).toBe('World Ideology: Order');
      expect(subjectValue(ideologyFired[0], 'ours')).toBe(true);

      const religion = rule(await check(withAgenda([{ name: 'World Religion: Buddhism' }])), 'congress-world-religion');
      const religionFired = firedSubjects(religion);
      expect(religionFired).toHaveLength(1);
      expect(subjectValue(religionFired[0], 'resolution')).toBe('World Religion: Buddhism');
      expect(subjectValue(religionFired[0], 'ours')).toBe(true);

      const project = rule(await check(withAgenda([{ name: "World's Fair" }])), 'congress-world-project');
      const projectFired = firedSubjects(project);
      expect(projectFired).toHaveLength(1);
      expect(subjectValue(projectFired[0], 'project')).toBe("World's Fair");

      /** Record a pending project with or without a named proposer. */
      const proposal = (proposer?: string) => fixture({
        cutoff, previous, players: [player],
        congress: {
          observations: [congressObservation(cutoff, 14, {
            proposals: [{ name: 'Treasure Fleet', isEnact: true, proposer }],
          })],
        },
      });
      const proposedFired = firedSubjects(rule(await check(proposal('Brazil')), 'congress-world-project'));
      expect(proposedFired).toHaveLength(1);
      expect(subjectValue(proposedFired[0], 'project')).toBe('Treasure Fleet');
      expect(subjectValue(proposedFired[0], 'proposer')).toBe('Brazil');
      expect(firedSubjects(rule(await check(proposal()), 'congress-world-project'))).toEqual([]);

      const unrelated = await check(withAgenda([{ name: 'Open Borders' }]));
      expect(firedSubjects(rule(unrelated, 'congress-world-project'))).toEqual([]);
    });
  });

  describe('national milestones and recoveries', () => {
    it('should report our ideology when it replaces no earlier ideology', async () => {
      const cutoff = 30;
      const adopted = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { PolicyBranches: { Order: [] } })],
        beforePlayers: [playerRow(0, 20)],
      }));
      const adoptedFired = firedSubjects(rule(adopted, 'ideology-adopted'));
      expect(adoptedFired).toHaveLength(1);
      expect(adoptedFired[0]).toMatchObject({ subject: 'world', urgent: true });
      expect(subjectValue(adoptedFired[0], 'ideology')).toBe('Order');

      const held = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { PolicyBranches: { Order: [] } })],
        beforePlayers: [playerRow(0, 20, { PolicyBranches: { Order: [] } })],
      }));
      expect(firedSubjects(rule(held, 'ideology-adopted'))).toEqual([]);
    });

    it('should report a rival ideology and lower its importance when it matches ours', async () => {
      const cutoff = 30;
      const differing = await check(fixture({
        cutoff, previous: 25,
        players: [
          playerRow(0, cutoff, { PolicyBranches: { Order: [] } }),
          playerRow(1, cutoff, { PolicyBranches: { Freedom: [] } }),
        ],
        beforePlayers: [
          playerRow(0, 20, { PolicyBranches: { Order: [] } }),
          playerRow(1, 20),
        ],
      }));
      const rival = firedSubjects(rule(differing, 'rival-adopts-ideology'));
      expect(rival).toHaveLength(1);
      expect(rival[0].subject).toBe('player/1');
      expect(subjectValue(rival[0], 'rival')).toBe('Brazil');
      expect(subjectValue(rival[0], 'ideology')).toBe('Freedom');
      expect(subjectValue(rival[0], 'shared')).toBe(false);

      const shared = await check(fixture({
        cutoff, previous: 25,
        players: [
          playerRow(0, cutoff, { PolicyBranches: { Order: [] } }),
          playerRow(1, cutoff, { PolicyBranches: { Order: [] } }),
        ],
        beforePlayers: [
          playerRow(0, 20, { PolicyBranches: { Order: [] } }),
          playerRow(1, 20),
        ],
      }));
      const sharedFired = firedSubjects(rule(shared, 'rival-adopts-ideology'));
      expect(sharedFired).toHaveLength(1);
      expect(rival[0].importance).toBeGreaterThan(sharedFired[0].importance!);
      expect(subjectValue(sharedFired[0], 'shared')).toBe(true);

      const held = await check(fixture({
        cutoff, previous: 25,
        players: [
          playerRow(0, cutoff, { PolicyBranches: { Order: [] } }),
          playerRow(1, cutoff, { PolicyBranches: { Freedom: [] } }),
        ],
        beforePlayers: [
          playerRow(0, 20, { PolicyBranches: { Order: [] } }),
          playerRow(1, 20, { PolicyBranches: { Freedom: [] } }),
        ],
      }));
      expect(firedSubjects(rule(held, 'rival-adopts-ideology'))).toEqual([]);
    });

    it('should report a policy branch opening only when the record shows a single new branch', async () => {
      const cutoff = 30;
      const opened = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { PolicyBranches: { Tradition: [], Liberty: [], Piety: [] } })],
        beforePlayers: [playerRow(0, 20, { PolicyBranches: { Tradition: [], Liberty: [] } })],
      }));
      const openedFired = firedSubjects(rule(opened, 'policy-branch-opened'));
      expect(openedFired).toHaveLength(1);
      expect(openedFired[0]).toMatchObject({ subject: 'world', importance: 60 });
      expect(subjectValue(openedFired[0], 'branch')).toBe('Piety');
      expect(subjectValue(openedFired[0], 'count')).toBe(3);

      const several = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { PolicyBranches: { Tradition: [], Liberty: [], Piety: [] } })],
        beforePlayers: [playerRow(0, 20, { PolicyBranches: { Tradition: [] } })],
      }));
      const severalFired = firedSubjects(rule(several, 'policy-branch-opened'));
      expect(severalFired).toEqual([]);

      const unchanged = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { PolicyBranches: { Tradition: ['Liberalism'] } })],
        beforePlayers: [playerRow(0, 20, { PolicyBranches: { Tradition: ['Socialism'] } })],
      }));
      expect(firedSubjects(rule(unchanged, 'policy-branch-opened'))).toEqual([]);
    });

    it('should report a newly founded religion once', async () => {
      const cutoff = 20;
      const founded = await check(fixture({
        cutoff, previous: 15,
        players: [playerRow(0, cutoff, { FoundedReligion: 'Taoism' })],
        beforePlayers: [playerRow(0, 10)],
      }));
      const foundedFired = firedSubjects(rule(founded, 'religion-founded'));
      expect(foundedFired).toHaveLength(1);
      expect(foundedFired[0]).toMatchObject({ subject: 'world', importance: 75 });
      expect(subjectValue(foundedFired[0], 'religion')).toBe('Taoism');

      const held = await check(fixture({
        cutoff, previous: 15,
        players: [playerRow(0, cutoff, { FoundedReligion: 'Taoism' })],
        beforePlayers: [playerRow(0, 10, { FoundedReligion: 'Taoism' })],
      }));
      expect(firedSubjects(rule(held, 'religion-founded'))).toEqual([]);
    });

    it('should report an era change in the recent window', async () => {
      const cutoff = 30;
      const advanced = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { Era: 'Renaissance Era' })],
        beforePlayers: [playerRow(0, 20, { Era: 'Medieval Era' })],
      }));
      const eraFired = firedSubjects(rule(advanced, 'new-era'));
      expect(eraFired).toHaveLength(1);
      expect(eraFired[0].subject).toBe('world');
      expect(subjectValue(eraFired[0], 'era')).toBe('Renaissance Era');

      const steady = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { Era: 'Medieval Era' })],
        beforePlayers: [playerRow(0, 20, { Era: 'Medieval Era' })],
      }));
      expect(firedSubjects(rule(steady, 'new-era'))).toEqual([]);
    });

    it('should report happiness recovering to 50 but not while it stays high', async () => {
      const cutoff = 30;
      const recovered = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { HappinessPercentage: 50 })],
        beforePlayers: [playerRow(0, 20, { HappinessPercentage: 40 })],
      }));
      const recoveryFired = firedSubjects(rule(recovered, 'happiness-recovers'));
      expect(recoveryFired).toHaveLength(1);
      expect(recoveryFired[0].subject).toBe('world');
      expect(subjectValue(recoveryFired[0], 'happinessPercentage')).toBe(50);

      const high = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { HappinessPercentage: 55 })],
        beforePlayers: [playerRow(0, 20, { HappinessPercentage: 60 })],
      }));
      expect(firedSubjects(rule(high, 'happiness-recovers'))).toEqual([]);
    });

    it('should report a treasury returning to surplus from a deficit', async () => {
      const cutoff = 30;
      const surplus = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { GoldPerTurn: 0 })],
        beforePlayers: [playerRow(0, 20, { GoldPerTurn: -4 })],
      }));
      const surplusFired = firedSubjects(rule(surplus, 'treasury-returns-to-surplus'));
      expect(surplusFired).toHaveLength(1);
      expect(surplusFired[0]).toMatchObject({ subject: 'world', importance: 45 });
      expect(subjectValue(surplusFired[0], 'goldPerTurn')).toBe(0);

      const deficit = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff, { GoldPerTurn: -2 })],
        beforePlayers: [playerRow(0, 20, { GoldPerTurn: -4 })],
      }));
      expect(firedSubjects(rule(deficit, 'treasury-returns-to-surplus'))).toEqual([]);
    });

    it('should report the end of our Golden Age and not its start', async () => {
      const cutoff = 30;
      const ended = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff)],
        beforePlayers: [playerRow(0, 20)],
        events: [eventRow('PlayerGoldenAge', 3, 28, { PlayerID: 0, Starting: false })],
      }));
      const endedFired = firedSubjects(rule(ended, 'golden-age-ends'));
      expect(endedFired).toHaveLength(1);
      expect(endedFired[0]).toMatchObject({ subject: 'event/3', importance: 45 });

      const started = await check(fixture({
        cutoff, previous: 25,
        players: [playerRow(0, cutoff)],
        beforePlayers: [playerRow(0, 20)],
        events: [eventRow('PlayerGoldenAge', 4, 28, { PlayerID: 0, Starting: true })],
      }));
      expect(firedSubjects(rule(started, 'golden-age-ends'))).toEqual([]);
    });

    it('should report peace after a war with a major but not while the war continues', async () => {
      const cutoff = 30;
      const before = 25;
      const settled = await check(fixture({
        cutoff, previous: before,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        beforePlayers: [playerRow(0, before), playerRow(1, before)],
        diplomacy: [
          snapshot(0, before, [relationship(1, 'war')]),
          snapshot(1, before, [relationship(0, 'war')]),
          snapshot(0, cutoff, [relationship(1, 'peace')]),
          snapshot(1, cutoff, [relationship(0, 'peace')]),
        ],
      }));
      const peaceFired = firedSubjects(rule(settled, 'peace-returns'));
      expect(peaceFired).toHaveLength(1);
      expect(peaceFired[0].subject).toBe('world');

      const ongoing = await check(fixture({
        cutoff, previous: before,
        players: [playerRow(0, cutoff), playerRow(1, cutoff)],
        beforePlayers: [playerRow(0, before), playerRow(1, before)],
        diplomacy: [
          snapshot(0, before, [relationship(1, 'war')]),
          snapshot(1, before, [relationship(0, 'war')]),
          snapshot(0, cutoff, [relationship(1, 'war')]),
          snapshot(1, cutoff, [relationship(0, 'war')]),
        ],
      }));
      expect(firedSubjects(rule(ongoing, 'peace-returns'))).toEqual([]);
    });
  });
});
