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
type Purchase = { gold?: boolean; faith?: boolean };

let config: EditorialConfig;

/** Record one readable city observation at a fixed date, with the basic flags a stock city reports. */
function cityRow(id: number, turn: number, x: number, owner: number, name: string,
  values: NewspaperSnapshot['values'] = {}): NewspaperSnapshot {
  return {
    subjectID: id,
    values: { X: x, Y: 2, Name: name, OwnerID: owner, IsPuppet: false, IsOccupied: false, Wonders: [], ...values },
    source: { table: 'CityInformations', id: turn * 100 + id, turn, createdAt: turn * 1000 + 5 },
  };
}

/** Record the city's important-building list, leaving it unrecorded when importance is not given. */
function importance(building: string, important?: boolean): NewspaperSnapshot['values'] {
  return important === undefined ? {} : { ImportantBuildings: important ? [building] : [] };
}

/** Record one witnessed building completion at the cutoff with explicit purchase flags. */
function constructed(id: number, cityID: number, owner: number, x: number, building: string,
  options: { purchase?: Purchase; createdAt?: number } = {}): NewspaperEvent {
  const purchase = options.purchase ?? {};
  return {
    type: 'CityConstructed',
    values: {
      OwnerID: owner, CityID: cityID, CityX: x, CityY: 2, Building: building,
      IsGoldPurchase: purchase.gold ?? false, IsFaithPurchase: purchase.faith ?? false,
    },
    source: { table: 'GameEvents', id, turn: 10, createdAt: options.createdAt ?? 10_001 },
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
    return { subjectID, values: { Era: 'Medieval Era' }, source: row.source };
  });
  const earlier = players.map(row => ({
    ...row,
    values: {},
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

/** Build one completion in Tours, optionally as a wonder, a purchase or a notable building. */
function own(building: string,
  options: { wonders?: string[]; purchase?: Purchase; createdAt?: number; events?: NewspaperEvent[];
    important?: boolean } = {}): NewspaperEvidence {
  return fixture(
    [cityRow(10, 10, 10, 0, 'Tours', {
      ...importance(building, options.important),
      ...(options.wonders === undefined ? {} : { Wonders: options.wonders }),
    })],
    [cityRow(10, 5, 10, 0, 'Tours')],
    [constructed(100, 10, 0, 10, building, {
      purchase: options.purchase, createdAt: options.createdAt,
    }), ...(options.events ?? [])],
  );
}

/** Build one investment in Tours, optionally with an ordinary completion in the same report. */
function investing(building: string, activation: boolean | number = true,
  completed?: string): NewspaperEvidence {
  return fixture(
    [cityRow(10, 10, 10, 0, 'Tours', completed === undefined ? {} : importance(completed, true))],
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
      cityRow(10, 10, 10, 0, 'Tours'),
      cityRow(20, 10, 12, 1, 'Recife'),
    ],
    [cityRow(10, 5, 10, 0, 'Tours'), cityRow(20, 5, 12, 1, 'Recife')],
    [invested(100, 20, 1, 12, building)],
  );
}

/** Build one investment in Tours and the same building's completion in Recife. */
function investingAcrossCities(building: string): NewspaperEvidence {
  return fixture(
    [
      cityRow(10, 10, 10, 0, 'Tours'),
      cityRow(20, 10, 12, 1, 'Recife'),
    ],
    [cityRow(10, 5, 10, 0, 'Tours'), cityRow(20, 5, 12, 1, 'Recife')],
    [invested(100, 10, 0, 10, building), constructed(101, 20, 1, 12, building)],
  );
}

/** Build one completion in a foreign city at the given distance from Tours. */
function foreign(building: string, x = 12, purchase: Purchase = {}, important?: boolean,
  values: NewspaperSnapshot['values'] = {}): NewspaperEvidence {
  return fixture(
    [
      cityRow(10, 10, 10, 0, 'Tours'),
      cityRow(20, 10, x, 1, 'Recife', { ...importance(building, important), ...values }),
    ],
    [cityRow(10, 5, 10, 0, 'Tours'), cityRow(20, 5, x, 1, 'Recife')],
    [constructed(100, 20, 1, x, building, { purchase })],
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
    const wallsAtPeace = subject((await check(own('Walls'))).audit('city-defense-completed'));
    const wartime = own('Walls');
    wartime.diplomacy!.history = [diplomacySnapshot(0, 10, [relationship(1, 'war')])];
    const wallsAtWar = subject((await check(wartime)).audit('city-defense-completed'));

    const early = own('Monument');
    const late = own('Monument', { important: true });
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
    const { audit } = await check(own('Granary', { important: true }));
    const completed = subject(audit('building-completed'));
    expect(completed).toMatchObject({ outcome: 'fired' });
    expect(placeholder(completed, 'values.building')).toBe('Granary');
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
    const { audit } = await check(own('Market', { purchase, important: true }));
    expect(subject(audit('building-completed'))).toMatchObject({ outcome: 'false' });
    const purchased = subject(audit('building-purchased'));
    expect(purchased).toMatchObject({ outcome: 'fired', tier: 'filler' });
    expect(placeholder(purchased, 'values.building')).toBe('Market');
    expect(placeholder(purchased, 'values.currency')).toBe(currency);
  });

  it('should report an activated building investment with its city', async () => {
    const { audit } = await check(investing('Monument'));
    const investment = subject(audit('building-investment-made'));
    expect(investment).toMatchObject({ outcome: 'fired', tier: 'filler' });
    expect(placeholder(investment, 'values.building')).toBe('Monument');
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
    const { audit } = await check(own('Walls'));
    expect(subject(audit('building-completed'))).toMatchObject({ outcome: 'false' });
    expect(subject(audit('building-purchased'))).toMatchObject({ outcome: 'false' });
    expect(subject(audit('city-defense-completed'))).toMatchObject({ outcome: 'fired' });
  });

  it('should leave a completion without an importance decision to the audit', async () => {
    const unknown = await check(own('Library'));
    expect(subject(unknown.audit('building-completed'))).toMatchObject({ outcome: 'hidden' });

    const declined = await check(own('Library', { important: false }));
    expect(subject(declined.audit('building-completed'))).toMatchObject({ outcome: 'false' });
  });

  it('should treat any non-wonder building as notable in the Ancient Era and require a yes later', async () => {
    /** Complete one building in Tours during the given era. */
    const during = (era: string, building: string, options: Parameters<typeof own>[1] = {}) => {
      const evidence = own(building, options);
      evidence.players[0].values.Era = era;
      return check(evidence);
    };
    expect(subject((await during('Ancient', 'Monument')).audit('building-completed')))
      .toMatchObject({ outcome: 'fired' });
    expect(subject((await during('Ancient Era', 'Well', { purchase: { gold: true } })).audit('building-purchased')))
      .toMatchObject({ outcome: 'fired' });
    expect(subject((await during('Classical', 'Monument', { important: false })).audit('building-completed')))
      .toMatchObject({ outcome: 'false' });

    const wonder = await during('Ancient Era', 'Stonehenge', { wonders: ['Stonehenge'], important: true });
    expect(subject(wonder.audit('building-completed'))).toMatchObject({ outcome: 'false' });
    expect(subject(wonder.audit('our-wonder-completed'))).toMatchObject({ outcome: 'fired' });
  });

  it('should report a distant foreign important completion and let presence and war raise its score', async () => {
    const distant = subject((await check(foreign('University', 40, {}, true))).audit('foreign-building-completed'));
    expect(distant).toMatchObject({ outcome: 'fired', tier: 'filler' });
    expect(placeholder(distant, 'values.building')).toBe('University');
    expect(placeholder(distant, 'values.owner')).toBe('Brazil');

    const watched = await check(foreign('University', 40, {}, true, { OurSpyPresent: true }));
    const watchedCompletion = subject(watched.audit('foreign-building-completed'));
    expect(watchedCompletion.outcome).toBe('fired');
    expect(watchedCompletion.importance).toBeGreaterThan(distant.importance!);

    const wartime = foreign('University', 40, {}, true);
    wartime.diplomacy!.history = [diplomacySnapshot(0, 10, [relationship(1, 'war')])];
    const warCompletion = subject((await check(wartime)).audit('foreign-building-completed'));
    expect(warCompletion.outcome).toBe('fired');
    expect(warCompletion.importance).toBeGreaterThan(distant.importance!);
  });

  it('should report a nearby foreign regular completion with its civilization', async () => {
    const { audit } = await check(foreign('Library', 12, {}, true));
    expect(subject(audit('building-completed'))).toMatchObject({ outcome: 'false' });
    expect(subject(audit('building-purchased'))).toMatchObject({ outcome: 'false' });
    const completed = subject(audit('foreign-building-completed'));
    expect(completed).toMatchObject({ outcome: 'fired', tier: 'filler' });
    expect(placeholder(completed, 'values.building')).toBe('Library');
    expect(placeholder(completed, 'values.owner')).toBe('Brazil');
  });

  it.each([
    ['gold', { gold: true }],
    ['faith', { faith: true }],
  ] as const)('should distinguish a witnessed nearby foreign purchase with %s from construction', async (currency, purchase) => {
    const { audit } = await check(foreign('Library', 12, purchase, true));
    const bought = subject(audit('foreign-building-purchased'));
    expect(bought.outcome).toBe('fired');
    expect(placeholder(bought, 'values.owner')).toBe('Brazil');
    expect(placeholder(bought, 'values.currency')).toBe(currency);
    expect(subject(audit('foreign-building-completed')).outcome).toBe('false');
    expect(subject(audit('building-purchased')).outcome).toBe('false');
  });

  it('should report a distant foreign purchase and leave an unknown importance to the audit', async () => {
    const distantPurchase = await check(foreign('Library', 40, { gold: true }, true));
    expect(subject(distantPurchase.audit('foreign-building-purchased')).outcome).toBe('fired');

    const unknownPurchase = await check(foreign('Library', 12, { faith: true }));
    expect(subject(unknownPurchase.audit('foreign-building-purchased'))).toMatchObject({ outcome: 'hidden' });
  });

  it('should not report a same-turn founding freebie as an ordinary completion', async () => {
    const { audit } = await check(own('Monument', {
      createdAt: 10_007,
      important: true,
      events: [founded(90, 0, 10)],
    }));
    expect(subject(audit('building-completed'))).toMatchObject({ outcome: 'false' });
  });

  it('should not report a same-turn founding freebie as a nearby foreign completion', async () => {
    const { audit } = await check(fixture(
      [
        cityRow(10, 10, 10, 0, 'Tours'),
        cityRow(20, 10, 12, 1, 'Recife', importance('Library', true)),
      ],
      [cityRow(10, 5, 10, 0, 'Tours'), cityRow(20, 5, 12, 1, 'Recife')],
      [founded(90, 1, 12), constructed(100, 20, 1, 12, 'Library', { createdAt: 10_007 })],
    ));
    expect(subject(audit('foreign-building-completed'))).toMatchObject({ outcome: 'false' });
  });
});
