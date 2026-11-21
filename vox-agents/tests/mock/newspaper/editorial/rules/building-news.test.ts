import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvent, NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { TriggerRuleAudit } from '../../../../../src/newspaper/contracts/triggers.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { relationship, snapshot as diplomacySnapshot } from '../../../../helpers/newspaper-diplomacy.js';

type AuditSubject = TriggerRuleAudit['subjects'][number];

let config: EditorialConfig;

/** Record one readable city observation at a fixed date. */
function cityRow(id: number, turn: number, x: number, owner: number, name: string,
  values: NewspaperSnapshot['values'] = {}): NewspaperSnapshot {
  return {
    subjectID: id,
    values: { X: x, Y: 2, Name: name, OwnerID: owner, ...values },
    source: { table: 'CityInformations', id: turn * 100 + id, turn, createdAt: turn * 1000 + 5 },
  };
}

/** Record one witnessed building completion at the cutoff with explicit purchase flags. */
function constructed(id: number, cityID: number, owner: number, x: number, building: string,
  purchase: { gold?: boolean; faith?: boolean } = {}, createdAt = 10_001): NewspaperEvent {
  return {
    type: 'CityConstructed',
    values: {
      OwnerID: owner, CityID: cityID, CityX: x, CityY: 2, Building: building,
      IsGoldPurchase: purchase.gold ?? false, IsFaithPurchase: purchase.faith ?? false,
    },
    source: { table: 'GameEvents', id, turn: 10, createdAt },
  };
}

/** Record one building investment, preserving the recorded activation flag. */
function invested(id: number, cityID: number, owner: number, x: number, building: string,
  activation: boolean | number = true): NewspaperEvent {
  return {
    type: 'CityInvestedBuilding',
    values: { PlayerID: owner, CityID: cityID, CityX: x, CityY: 2, Building: building, Invested: activation },
    source: { table: 'GameEvents', id, turn: 10, createdAt: 10_001 },
  };
}

/** Record the founding that grants a city's start-era free buildings. */
function founded(id: number, player: number, x: number): NewspaperEvent {
  return {
    type: 'PlayerCityFounded',
    values: { PlayerID: player, PlotX: x, PlotY: 2 },
    source: { table: 'GameEvents', id, turn: 10, createdAt: 9_999 },
  };
}

/** Supply a continuous visible history with one receiver and one known rival. */
function fixture(cities: NewspaperSnapshot[], before: NewspaperSnapshot[], events: NewspaperEvent[]): NewspaperEvidence {
  const players = [0, 1].map(subjectID => {
    const row = diplomacySnapshot(subjectID, 10, []);
    return { subjectID, values: {}, source: row.source };
  });
  const earlier = players.map(row => ({
    ...row,
    source: { ...row.source, turn: 0, id: row.subjectID, createdAt: 0 },
  }));
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, historyFromTurn: -1 },
    players,
    cities,
    comparisons: { players: [], cities: before },
    events,
    history: {
      fromTurn: -1,
      baseline: { cities: [], players: [] },
      snapshots: { cities: [...before, ...cities], players: [...earlier, ...players] },
      events,
      gaps: [],
    },
    diplomacy: {
      fromTurn: -1, baseline: [], gaps: [],
      history: [diplomacySnapshot(0, 10, [relationship(1, 'peace')])],
    },
  };
}

/** Build one completion in Tours, optionally naming the readable regular buildings. */
function own(building: string, buildings?: string[],
  options: { wonders?: string[]; purchase?: { gold?: boolean; faith?: boolean }; createdAt?: number;
    events?: NewspaperEvent[] } = {}): NewspaperEvidence {
  return fixture(
    [cityRow(10, 10, 10, 0, 'Tours', {
      ...(buildings === undefined ? {} : { ImportantBuildings: buildings }),
      ...(options.wonders === undefined ? {} : { Wonders: options.wonders }),
    })],
    [cityRow(10, 5, 10, 0, 'Tours')],
    [constructed(100, 10, 0, 10, building, options.purchase, options.createdAt), ...(options.events ?? [])],
  );
}

/** Build one investment in Tours, optionally with an ordinary completion in the same report. */
function investing(building: string, activation: boolean | number = true,
  completed?: string): NewspaperEvidence {
  return fixture(
    [cityRow(10, 10, 10, 0, 'Tours', { ImportantBuildings: completed === undefined ? [] : [completed] })],
    [cityRow(10, 5, 10, 0, 'Tours')],
    [
      invested(100, 10, 0, 10, building, activation),
      ...(completed === undefined ? [] : [constructed(101, 10, 0, 10, completed)]),
    ],
  );
}

/** Build one investment in a foreign city beside the receiver's capital. */
function investingAbroad(building: string): NewspaperEvidence {
  return fixture(
    [
      cityRow(10, 10, 10, 0, 'Tours', { ImportantBuildings: [] }),
      cityRow(20, 10, 12, 1, 'Recife', { ImportantBuildings: [] }),
    ],
    [cityRow(10, 5, 10, 0, 'Tours'), cityRow(20, 5, 12, 1, 'Recife')],
    [invested(100, 20, 1, 12, building)],
  );
}

/** Build one investment in Tours and the same building's completion in Recife. */
function investingAcrossCities(building: string): NewspaperEvidence {
  return fixture(
    [
      cityRow(10, 10, 10, 0, 'Tours', { ImportantBuildings: [] }),
      cityRow(20, 10, 12, 1, 'Recife', { ImportantBuildings: [building] }),
    ],
    [cityRow(10, 5, 10, 0, 'Tours'), cityRow(20, 5, 12, 1, 'Recife')],
    [invested(100, 10, 0, 10, building), constructed(101, 20, 1, 12, building)],
  );
}

/** Build one completion in a foreign city at the given distance from Tours. */
function foreign(building: string, buildings: string[], x = 12,
  purchase: { gold?: boolean; faith?: boolean } = {}): NewspaperEvidence {
  return fixture(
    [
      cityRow(10, 10, 10, 0, 'Tours', { ImportantBuildings: [] }),
      cityRow(20, 10, x, 1, 'Recife', { ImportantBuildings: buildings }),
    ],
    [cityRow(10, 5, 10, 0, 'Tours'), cityRow(20, 5, x, 1, 'Recife')],
    [constructed(100, 20, 1, x, building, purchase)],
  );
}

/** Run the shipped editor and expose every trigger audit record. */
async function check(evidence: NewspaperEvidence) {
  const facts = buildNewspaperFacts(evidence, { playerIdentities: {
    0: { name: 'France', major: true, teamId: 100 },
    1: { name: 'Brazil', major: true, teamId: 101 },
  } });
  const result = await runEditorialCheck({
    campaignId: 'fixture', timelineId: 'building-news', receiver: { playerId: 0, label: 'France' },
    evidence, facts, config, speedMultiplier: 1, state: createInitialPublicationState(),
  });
  expect(result.decision.choiceErrors ?? []).toEqual([]);
  const audit = (id: string) => result.decision.triggerAudit.find(rule => rule.rule === id)!;
  return { audit };
}

/** Read an audited event subject for a rule. */
function subject(audit: TriggerRuleAudit, id = 100): AuditSubject {
  return audit.subjects.find(record => record.subject === `event/${id}`)!;
}

/** Read one authored placeholder from an audited subject. */
function placeholder(record: AuditSubject, field: string) {
  return record.expressions.find(expression => expression.field === field)?.value;
}

describe('stock building news', () => {
  beforeAll(async () => { config = await loadEditorialConfig(); });

  it('should rate Walls higher during war and a Monument lower in the Industrial Era', async () => {
    const wallsAtPeace = subject((await check(own('Walls', ['Walls']))).audit('city-defense-completed'));
    const wartime = own('Walls', ['Walls']);
    wartime.diplomacy!.history = [diplomacySnapshot(0, 10, [relationship(1, 'war')])];
    const wallsAtWar = subject((await check(wartime)).audit('city-defense-completed'));

    const early = own('Monument', ['Monument']);
    const late = own('Monument', ['Monument']);
    early.players[0].values.Era = 'Ancient Era';
    late.players[0].values.Era = 'Industrial Era';
    const earlyMonument = subject((await check(early)).audit('building-completed'));
    const lateMonument = subject((await check(late)).audit('building-completed'));

    for (const story of [wallsAtPeace, wallsAtWar, earlyMonument, lateMonument])
      expect(story.outcome).toBe('fired');
    expect(wallsAtWar.importance).toBeGreaterThan(wallsAtPeace.importance!);
    expect(earlyMonument.importance).toBeGreaterThan(lateMonument.importance!);
    expect(wallsAtWar.importance).toBeGreaterThan(lateMonument.importance!);
  });

  it('should report a completed regular building at home with its city', async () => {
    const { audit } = await check(own('Granary', ['Granary']));
    const completed = subject(audit('building-completed'));
    expect(completed).toMatchObject({ outcome: 'fired', importance: 30 });
    expect(placeholder(completed, 'values.building')).toBe('Granary');
    expect(placeholder(completed, 'values.cityName')).toBe('Tours');
    expect(completed.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'GameEvents', id: 100 }),
      expect.objectContaining({ table: 'CityInformations', turn: 10 }),
    ]));
    expect(subject(audit('building-purchased'))).toMatchObject({ outcome: 'false' });
    expect(subject(audit('foreign-building-completed'))).toMatchObject({ outcome: 'false' });
  });

  it.each([
    ['gold', { gold: true }],
    ['faith', { faith: true }],
  ] as const)('should report a regular building bought with %s separately', async (currency, purchase) => {
    const { audit } = await check(own('Market', ['Market'], { purchase }));
    expect(subject(audit('building-completed'))).toMatchObject({ outcome: 'false' });
    const purchased = subject(audit('building-purchased'));
    expect(purchased).toMatchObject({ outcome: 'fired', importance: 35 });
    expect(placeholder(purchased, 'values.building')).toBe('Market');
    expect(placeholder(purchased, 'values.currency')).toBe(currency);
  });

  it('should report an activated building investment with its city', async () => {
    const { audit } = await check(investing('Monument'));
    const investment = subject(audit('building-investment-made'));
    expect(investment).toMatchObject({ outcome: 'fired', importance: 25 });
    expect(placeholder(investment, 'values.building')).toBe('Monument');
    expect(placeholder(investment, 'values.cityName')).toBe('Tours');
    expect(investment.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'GameEvents', id: 100 }),
      expect.objectContaining({ table: 'CityInformations', turn: 10 }),
    ]));
  });

  it.each([
    ['an activation', true, 'fired'],
    ['a legacy numeric activation', 1, 'fired'],
    ['a deactivation', false, 'false'],
    ['a legacy numeric deactivation', 0, 'false'],
  ] as const)('should report only %s of a building investment', async (_label, activation, outcome) => {
    const { audit } = await check(investing('Monument', activation));
    const investment = subject(audit('building-investment-made'));
    expect(investment).toMatchObject({ outcome });
    if (outcome === 'fired') expect(placeholder(investment, 'values.building')).toBe('Monument');
  });

  it('should leave an investment in a foreign city unreported', async () => {
    const { audit } = await check(investingAbroad('Library'));
    expect(subject(audit('building-investment-made'))).toMatchObject({ outcome: 'false' });
  });

  it('should let a same-building completion in another city leave the investment reported', async () => {
    const { audit } = await check(investingAcrossCities('Market'));
    expect(subject(audit('building-investment-made'))).toMatchObject({ outcome: 'fired' });
  });

  it('should leave an invested building to its ordinary completion in the same report', async () => {
    const { audit } = await check(investing('Market', true, 'Market'));
    expect(subject(audit('building-investment-made'))).toMatchObject({ outcome: 'false' });
    expect(subject(audit('building-completed'), 101)).toMatchObject({ outcome: 'fired' });

    const different = await check(investing('Library', true, 'Market'));
    expect(subject(different.audit('building-investment-made'))).toMatchObject({ outcome: 'fired' });
  });

  it('should leave fortifications to the existing defense report', async () => {
    const { audit } = await check(own('Walls', ['Walls']));
    expect(subject(audit('building-completed'))).toMatchObject({ outcome: 'false' });
    expect(subject(audit('building-purchased'))).toMatchObject({ outcome: 'false' });
    expect(subject(audit('city-defense-completed'))).toMatchObject({ outcome: 'fired' });
  });

  it('should require a positive regular-building list so wonders and missing details do not qualify', async () => {
    const wonder = await check(own('Petra', ['Granary'], { wonders: ['Petra'] }));
    expect(subject(wonder.audit('building-completed'))).toMatchObject({ outcome: 'false' });
    expect(subject(wonder.audit('our-wonder-completed'))).toMatchObject({ outcome: 'fired' });

    const unlisted = await check(own('Library', ['Granary']));
    expect(subject(unlisted.audit('building-completed'))).toMatchObject({ outcome: 'false' });

    const missing = await check(own('Granary'));
    expect(subject(missing.audit('building-completed'))).toMatchObject({ outcome: 'false' });
  });

  it('should report a nearby foreign regular completion with its civilization', async () => {
    const { audit } = await check(foreign('Library', ['Library']));
    expect(subject(audit('building-completed'))).toMatchObject({ outcome: 'false' });
    expect(subject(audit('building-purchased'))).toMatchObject({ outcome: 'false' });
    const completed = subject(audit('foreign-building-completed'));
    expect(completed).toMatchObject({ outcome: 'fired', importance: 20 });
    expect(placeholder(completed, 'values.building')).toBe('Library');
    expect(placeholder(completed, 'values.cityName')).toBe('Recife');
    expect(placeholder(completed, 'values.civilization')).toBe('Brazil');
  });

  it.each([
    ['gold', { gold: true }],
    ['faith', { faith: true }],
  ] as const)('should distinguish a witnessed nearby foreign purchase with %s from construction', async (currency, purchase) => {
    const { audit } = await check(foreign('Library', ['Library'], 12, purchase));
    const bought = subject(audit('foreign-building-purchased'));
    expect(bought.outcome).toBe('fired');
    expect(placeholder(bought, 'values.cityName')).toBe('Recife');
    expect(placeholder(bought, 'values.civilization')).toBe('Brazil');
    expect(placeholder(bought, 'values.currency')).toBe(currency);
    expect(subject(audit('foreign-building-completed')).outcome).toBe('false');
    expect(subject(audit('building-purchased')).outcome).toBe('false');
  });

  it('should require proximity and a corroborated ordinary building for a foreign purchase', async () => {
    const distantPurchase = await check(foreign('Library', ['Library'], 40, { gold: true }));
    expect(subject(distantPurchase.audit('foreign-building-purchased')).outcome).toBe('false');

    const unlistedPurchase = await check(foreign('Library', [], 12, { faith: true }));
    expect(subject(unlistedPurchase.audit('foreign-building-purchased')).outcome).toBe('false');
  });

  it('should keep a distant foreign completion out of the foreign report', async () => {
    const distant = await check(foreign('Library', ['Library'], 40));
    expect(subject(distant.audit('foreign-building-completed')).outcome).toBe('false');
  });

  it('should not report a same-turn founding freebie as an ordinary completion', async () => {
    const { audit } = await check(own('Monument', ['Monument'], {
      createdAt: 10_007,
      events: [founded(90, 0, 10)],
    }));
    expect(subject(audit('building-completed'))).toMatchObject({ outcome: 'false' });
  });

  it('should not report a same-turn founding freebie as a nearby foreign completion', async () => {
    const { audit } = await check(fixture(
      [
        cityRow(10, 10, 10, 0, 'Tours', { ImportantBuildings: [] }),
        cityRow(20, 10, 12, 1, 'Recife', { ImportantBuildings: ['Library'] }),
      ],
      [cityRow(10, 5, 10, 0, 'Tours'), cityRow(20, 5, 12, 1, 'Recife')],
      [founded(90, 1, 12), constructed(100, 20, 1, 12, 'Library', {}, 10_007)],
    ));
    expect(subject(audit('foreign-building-completed'))).toMatchObject({ outcome: 'false' });
  });
});
