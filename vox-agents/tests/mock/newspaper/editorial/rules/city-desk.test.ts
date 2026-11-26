import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvent, NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { relationship, snapshot as diplomacySnapshot } from '../../../../helpers/newspaper-diplomacy.js';
import { editionBriefTemplate, withEditionBriefs } from '../../../../helpers/newspaper-briefs.js';

let config: EditorialConfig;

/** Record a readable city at a fixed location on one date. */
function city(id: number, turn: number, x: number, owner: number, name: string, values: NewspaperSnapshot['values'] = {}): NewspaperSnapshot {
  return { subjectID: id, values: { X: x, Y: 2, Name: name, OwnerID: owner, ...values },
    source: { table: 'CityInformations', id: turn * 100 + id, turn, createdAt: turn * 1000 + 5 } };
}

/** Record a witnessed native event at the reporting turn. */
function event(id: number, type: string, values: NewspaperEvent['values'], turn = 7): NewspaperEvent {
  return { type, values, source: { table: 'GameEvents', id, turn, createdAt: turn * 1000 + 1 } };
}

/** Supply a continuous visible history and one known rival. */
function fixture(cities: NewspaperSnapshot[], before: NewspaperSnapshot[] = [], events: NewspaperEvent[] = [],
  diplomaticState: 'peace' | 'war' = 'peace', friendly = false, foreignWar = false): NewspaperEvidence {
  const relation = relationship(1, diplomaticState, friendly ? { friendship: true } : {});
  const diplomacy = [diplomacySnapshot(0, 10, [relation])];
  if (foreignWar) diplomacy.push(diplomacySnapshot(1, 10, [relationship(2, 'war')]));
  const players = [0, 1, 2].map(subjectID => {
    const row = diplomacySnapshot(subjectID, 10, []);
    return { subjectID, values: {}, source: row.source };
  });
  const pastPlayers = players.map(row => ({ ...row, source: { ...row.source, turn: 0, id: row.subjectID, createdAt: 0 } }));
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, historyFromTurn: -1 },
    players, cities, comparisons: { players: [], cities: before }, events,
    history: { fromTurn: -1, baseline: { cities: [], players: [] },
      snapshots: { cities: [...before, ...cities], players: [...pastPlayers, ...players] }, events, gaps: [] },
    diplomacy: { fromTurn: -1, baseline: [], history: diplomacy, gaps: [] },
  };
}

/** Run the complete stock editor and expose the audit alongside published articles. */
async function check(input: NewspaperEvidence, catalogue = config) {
  const { evidence, config } = withEditionBriefs(input, catalogue);
  const facts = buildNewspaperFacts(evidence, { playerIdentities: {
    0: { name: 'France', major: true, teamId: 100 }, 1: { name: 'Brazil', major: true, teamId: 101 },
    2: { name: 'Carthage', major: true, teamId: 102 },
  } });
  const result = await runEditorialCheck({
    campaignId: 'fixture', timelineId: 'city-desk', receiver: { playerId: 0, label: 'France' },
    evidence, facts, config, speedMultiplier: 1, state: createInitialPublicationState(),
  });
  const audit = (id: string) => result.decision.triggerAudit.find(rule => rule.rule === id)!;
  const archived = (result.state.issues[0]?.items ?? []).filter(item => !item.templateIds.includes(editionBriefTemplate.id));
  const items = result.issue?.items.filter(item => archived.some(record => record.id === item.id)) ?? [];
  const variants = items.map(item => result.decision.selectedVariants[item.id]);
  expect(result.decision.choiceErrors ?? []).toEqual([]);
  /** Find printed articles whose archived evidence includes this rule. */
  function stories(rule: string) {
    const ids = result.state.issues[0]?.items.filter(item => item.ruleIds?.includes(rule)).map(item => item.id);
    return items.filter(item => ids?.includes(item.id));
  }
  return { archived, audit, items, variants, stories };
}

const home = city(10, 10, 0, 0, 'Tours');
const settlers = event(100, 'CityTrained', { PlayerID: 0, CityID: 10, CityX: 0, CityY: 2, Unit: 'Pioneer' });

describe('stock city desk', () => {
  beforeAll(async () => {
    config = await loadEditorialConfig();
  });

  it('should cover a neighboring annexation only when the owner remains the same', async () => {
    const annexed = city(20, 10, 4, 1, 'Recife', { IsPuppet: false, IsOccupied: true });
    const puppet = city(20, 5, 4, 1, 'Recife', { IsPuppet: true });
    const result = await check(fixture([home, annexed], [puppet]));
    expect(result.stories('neighbor-puppet-annexed')).toHaveLength(1);
    expect(result.audit('neighbor-puppet-annexed').subjects).toContainEqual(expect.objectContaining({
      subject: 'city/20', outcome: 'fired', sources: expect.arrayContaining([puppet.source, annexed.source]),
    }));
    const transferred = { ...puppet, values: { ...puppet.values, OwnerID: 0 } };
    expect((await check(fixture([home, annexed], [transferred]))).stories('neighbor-puppet-annexed')).toEqual([]);
  });

  it.each([
    [-3, 'settler-departure-strained'], [2, 'settler-departure-hopeful'],
    [0, 'settler-departure-report'], [undefined, 'settler-departure-report'],
  ])('should route local happiness %s to one settler account with a city link', async (happiness, variant) => {
    const before = city(10, 5, 0, 0, 'Tours', { Population: 8 });
    const now = { ...home, values: { ...home.values, Population: 6, FoodPerTurn: 2,
      ...(happiness === undefined ? {} : { HappinessDelta: happiness }) } };
    const account = config.templates.find(template => template.id === 'settler-departure-account')!;
    const happinessVariants = new Set(['settler-departure-strained', 'settler-departure-hopeful', 'settler-departure-report']);
    const catalogue = { ...config, templates: [{ ...account, variants: account.variants.filter(entry => happinessVariants.has(entry.id)) }] };
    const result = await check(fixture([now], [before], [settlers]), catalogue);
    expect(result.variants).toEqual([variant]);
    expect(result.items[0].headline).toContainEqual(expect.objectContaining({
      type: 'link', target: { type: 'city', cityId: '10' },
    }));
  });

  it('should leave a smaller city out of the settler story when there is no witnessed training', async () => {
    const before = city(10, 5, 0, 0, 'Tours', { Population: 8 });
    const now = { ...home, values: { ...home.values, Population: 6, FoodPerTurn: 2 } };
    expect((await check(fixture([now], [before]))).variants).toEqual([]);
  });

  it('should report a named rival settlement urgently from the player founding hook', async () => {
    const town = city(20, 10, 2, 1, 'Recife');
    const founded = event(101, 'PlayerCityFounded', { PlayerID: 1, PlotX: 2, PlotY: 2 });
    const unitFounded = event(102, 'UnitCityFounded', founded.values);
    const result = await check(fixture([home, town], [], [founded, unitFounded]));
    const stories = result.stories('forward-settle');
    expect(stories).toHaveLength(1);
    const [article] = stories;
    const copy = [...article.headline, ...article.body.flat()];
    const text = copy.map(node => 'text' in node ? node.text : '').join(' ');
    expect(text).toContain('Brazil');
    expect(text).toContain('Tours');
    expect(copy).toContainEqual(expect.objectContaining({ target: { type: 'city', cityId: '20' } }));
    expect(result.audit('forward-settle').subjects.filter(subject => subject.outcome === 'fired'))
      .toMatchObject([{ subject: 'event/101', urgent: true }]);
    const unnamed = await check(fixture([home], [], [founded]));
    expect(unnamed.stories('forward-settle')).toEqual([]);
    expect(unnamed.audit('forward-settle').subjects).toMatchObject([{ subject: 'event/101', outcome: 'false' }]);
    expect((await check(fixture([home, town], [], [founded], 'peace', true))).stories('forward-settle')).toEqual([]);
  });

  it('should print the food shortage only for a damaged city in wartime', async () => {
    const damaged = { ...home, values: { ...home.values, HitPoints: 95, MaxHitPoints: 200, FoodStored: 3, FoodPerTurn: -2 } };
    const result = await check(fixture([damaged], [], [], 'war'));
    expect(result.stories('besieged-and-starving')).toHaveLength(1);
    expect(result.audit('besieged-and-starving').subjects).toMatchObject([{ subject: 'city/10', outcome: 'fired', urgent: true }]);
    expect((await check(fixture([damaged]))).stories('besieged-and-starving')).toEqual([]);
    const ampleFood = { ...damaged, values: { ...damaged.values, FoodStored: 20 } };
    expect((await check(fixture([ampleFood], [], [], 'war'))).stories('besieged-and-starving')).toEqual([]);
  });

  it('should run one conversion report only when three nearby cities change to the same faith', async () => {
    const before = [20, 21, 22].map((id, index) => city(id, 5, index + 3, 1, `Port ${id}`, { MajorityReligion: 'Taoism' }));
    const now = before.map((row, index) => city(row.subjectID, 10, index + 3, 1, String(row.values.Name), { MajorityReligion: 'Buddhism' }));
    const result = await check(fixture([home, ...now], before));
    const stories = result.stories('neighbors-convert');
    expect(stories).toHaveLength(1);
    const copy = [...stories[0].headline, ...stories[0].body.flat()].map(node => 'text' in node ? node.text : '').join('');
    expect(copy).toContain('Buddhism');
    expect(result.audit('neighbors-convert').groups).toMatchObject([{
      key: 'Buddhism', outcome: 'fired', matches: [{ subject: 'city/20' }, { subject: 'city/21' }, { subject: 'city/22' }],
    }]);
    const different = { ...now[2], values: { ...now[2].values, MajorityReligion: 'Islam' } };
    const split = await check(fixture([home, ...now.slice(0, 2), different], before));
    expect(split.stories('neighbors-convert')).toEqual([]);
    expect(split.audit('neighbors-convert').groups.map(group => group.outcome)).toEqual(['too-small', 'too-small']);
  });

  it('should keep one capture story per city when a plot changes hands repeatedly', async () => {
    const rule = 'city-capture-involving-us';
    const first = city(30, 10, 6, 0, 'Lyon');
    const second = city(31, 10, 8, 0, 'Lyon');
    const gained = event(201, 'CityCaptureComplete', {
      OldOwnerID: 1, NewOwnerID: 0, CityX: 6, CityY: 2, IsConquest: true,
    }, 6);
    const lost = event(202, 'CityCaptureComplete', {
      OldOwnerID: 0, NewOwnerID: 1, CityX: 6, CityY: 2, IsConquest: true,
    }, 7);
    const regained = event(203, 'CityCaptureComplete', {
      OldOwnerID: 1, NewOwnerID: 0, CityX: 6, CityY: 2, IsConquest: true,
    }, 8);
    const elsewhere = event(204, 'CityCaptureComplete', {
      OldOwnerID: 1, NewOwnerID: 0, CityX: 8, CityY: 2, IsConquest: true,
    });
    const result = await check(fixture([first, second], [], [gained, lost, regained, elsewhere]));
    const stories = result.archived.filter(item => item.ruleIds?.includes(rule));
    expect(stories).toHaveLength(2);
    const cityIds = stories.map(item => [...new Set([...item.headline, ...item.body.flat()].flatMap(node =>
      'target' in node && node.target.type === 'city' ? [node.target.cityId] : []))]);
    expect(cityIds.flat().sort()).toEqual(['30', '31']);
    const repeated = stories.find(item => item.sources.some(source => source.table === 'GameEvents' && source.id === 201))!;
    expect([...repeated.headline, ...repeated.body.flat()]).toContainEqual(expect.objectContaining({
      type: 'link', target: expect.objectContaining({ type: 'city', cityId: '30' }),
    }));
    const eventIds = repeated.sources.filter(source => source.table === 'GameEvents').map(source => source.id);
    expect(eventIds).toEqual(expect.arrayContaining([201, 202, 203]));
    expect(eventIds).not.toContain(204);
  });

  it('should separate a distant foreign founding from a forward settlement', async () => {
    const distant = city(20, 10, 10, 1, 'Recife');
    const distantUnit = event(303, 'UnitCityFounded', { PlayerID: 1, PlotX: 10, PlotY: 2 });
    const result = await check(fixture([home, distant], [], [distantUnit]));
    const stories = result.stories('foreign-city-founded');
    expect(stories).toHaveLength(1);
    const copy = [...stories[0].headline, ...stories[0].body.flat()];
    expect(copy).toContainEqual(expect.objectContaining({ target: { type: 'city', cityId: '20' } }));
    expect(result.archived.find(item => item.id === stories[0].id)?.sources).toContainEqual(distantUnit.source);
    expect(result.audit('forward-settle').subjects.filter(subject => subject.outcome === 'fired')).toEqual([]);

    const nearby = city(20, 10, 2, 1, 'Recife');
    const playerFounded = event(301, 'PlayerCityFounded', { PlayerID: 1, PlotX: 2, PlotY: 2 });
    const nearbyUnit = event(302, 'UnitCityFounded', { PlayerID: 1, PlotX: 2, PlotY: 2 });
    const both = await check(fixture([home, nearby], [], [playerFounded, nearbyUnit]));
    const playerFired = both.audit('forward-settle').subjects.filter(subject => subject.outcome === 'fired');
    expect(playerFired).toHaveLength(1);
    expect(playerFired).toMatchObject([{ subject: 'event/301' }]);
    expect(both.audit('foreign-city-founded').subjects.filter(subject => subject.outcome === 'fired')).toEqual([]);

    const unitOnly = await check(fixture([home, nearby], [], [nearbyUnit]));
    expect(unitOnly.audit('forward-settle').subjects.filter(subject => subject.outcome === 'fired'))
      .toMatchObject([{ subject: 'event/302' }]);
  });

  it('should drop a witnessed building investment after a later purchase', async () => {
    const before = city(20, 5, 8, 1, 'Recife');
    const now = city(20, 10, 8, 1, 'Recife');
    const invested = event(303, 'CityInvestedBuilding', {
      PlayerID: 1, CityID: 20, CityX: 8, CityY: 2, Building: 'Walls', Invested: true,
    });
    const result = await check(fixture([home, now], [before], [invested]));
    expect(result.audit('foreign-building-investment-made').subjects
      .filter(subject => subject.outcome === 'fired')).toHaveLength(1);

    const constructed = event(304, 'CityConstructed', {
      OwnerID: 1, CityID: 20, CityX: 8, CityY: 2, Building: 'Walls', IsGoldPurchase: true,
    }, 8);
    const completed = await check(fixture([home, now], [before], [invested, constructed]));
    expect(completed.audit('foreign-building-investment-made').subjects
      .filter(subject => subject.outcome === 'fired')).toEqual([]);
    expect(completed.stories('foreign-city-defense-completed')).toHaveLength(1);
  });

  it('should mark a visible rival growth milestone as notable only with a same-owner baseline', async () => {
    const before = city(20, 5, 8, 1, 'Recife', { Population: 14 });
    const now = city(20, 10, 8, 1, 'Recife', { Population: 25 });
    const result = await check(fixture([home, now], [before]));
    const fired = result.audit('foreign-city-growth-milestone').subjects
      .filter(subject => subject.outcome === 'fired');
    expect(fired).toHaveLength(1);
    expect(fired).toMatchObject([{ subject: 'city/20', tier: 'notable' }]);

    const firstSighting = await check(fixture([home, now]));
    expect(firstSighting.audit('foreign-city-growth-milestone').subjects
      .filter(subject => subject.outcome === 'fired')).toEqual([]);

    const otherOwner = city(20, 5, 8, 0, 'Recife', { Population: 14 });
    const changedOwner = await check(fixture([home, now], [otherOwner]));
    expect(changedOwner.audit('foreign-city-growth-milestone').subjects
      .filter(subject => subject.outcome === 'fired')).toEqual([]);
  });

  it('should separate a rival settler report from a witnessed hardship', async () => {
    const before = city(20, 5, 8, 1, 'Recife', { Population: 8 });
    const dropped = city(20, 10, 8, 1, 'Recife', { Population: 6 });
    const trained = event(305, 'CityTrained', { PlayerID: 1, CityID: 20, CityX: 8, CityY: 2, Unit: 'Pioneer' });
    const basic = await check(fixture([home, dropped], [before], [trained]));
    expect(basic.audit('foreign-city-raises-settlers').subjects
      .filter(subject => subject.outcome === 'fired')).toEqual([]);
    expect(basic.audit('foreign-city-hardship').subjects
      .filter(subject => subject.outcome === 'fired')).toEqual([]);

    const fed = { ...dropped, values: { ...dropped.values, FoodPerTurn: 2 } };
    const settler = await check(fixture([home, fed], [before], [trained]));
    expect(settler.audit('foreign-city-raises-settlers').subjects
      .filter(subject => subject.outcome === 'fired')).toHaveLength(1);

    const starving = city(21, 10, 30, 1, 'Olinda', {
      UnhappinessSources: { Famine: 3 }, FoodPerTurn: -2, FoodStored: 1,
    });
    const hardship = await check(fixture([home, starving]));
    const fired = hardship.audit('foreign-city-hardship').subjects
      .filter(subject => subject.outcome === 'fired');
    expect(fired).toHaveLength(1);
    expect(fired).toMatchObject([{
      subject: 'city/21', sources: expect.arrayContaining([starving.source]),
      expressions: expect.arrayContaining([expect.objectContaining({ field: 'values.cause', value: 'famine' })]),
    }]);
  });

  it('should give a foreign transfer one account and leave room for resistance when no transfer qualifies', async () => {
    const occupied = city(20, 10, 6, 1, 'Recife', { IsOccupied: true, ResistanceTurns: 3 });
    const transfer = { CityX: 6, CityY: 2, OldOwnerID: 2, NewOwnerID: 1 };
    const flip = event(401, 'CityFlipped', { ...transfer, CityID: 20 });
    const capture = event(402, 'CityCaptureComplete', { ...transfer, IsCapital: false, IsConquest: true });
    const nonConquest = { ...capture, values: { ...capture.values, IsConquest: false } };
    const resistance = 'foreign-occupied-city-resists';
    const change = 'foreign-city-flips';
    const conquered = await check(fixture([home, occupied], [], [flip, capture]));
    expect(conquered.stories('nearby-city-captured')).toHaveLength(1);
    expect(conquered.stories(change)).toEqual([]);
    expect(conquered.stories(resistance)).toEqual([]);
    const flipped = await check(fixture([home, occupied], [], [flip, nonConquest]));
    expect(flipped.stories(change)).toHaveLength(1);
    expect(flipped.stories(resistance)).toEqual([]);
    const alone = await check(fixture([home, occupied], [], [nonConquest]));
    expect(alone.stories(resistance)).toHaveLength(1);
  });

  it('should use basic city observations for heavy damage in a third-party war', async () => {
    const before = city(20, 5, 8, 1, 'Recife', { HitPoints: 120, MaxHitPoints: 200 });
    const damaged = city(20, 10, 8, 1, 'Recife', { HitPoints: 90, MaxHitPoints: 200 });
    const rule = 'foreign-city-takes-heavy-damage';
    const foreign = await check(fixture([home, damaged], [before], [], 'peace', false, true));
    expect(foreign.stories(rule)).toHaveLength(1);
    const razed = { ...damaged, values: { ...damaged.values, RazingTurns: 1 } };
    expect((await check(fixture([home, razed], [before], [], 'peace', false, true))).stories(rule)).toEqual([]);
    const enemy = await check(fixture([home, damaged], [before], [], 'war', false, true));
    expect(enemy.stories(rule)).toEqual([]);
    expect(enemy.stories('enemy-city-takes-heavy-damage')).toHaveLength(1);
  });

  it('should report a foreign liberation without attaching the event to a city by its local ID', async () => {
    const visible = city(20, 10, 30, 2, 'Utica');
    const liberated = event(403, 'PlayerLiberated', { LiberatingPlayerID: 1, LiberatedPlayerID: 2, CityID: 20 });
    const result = await check(fixture([home, visible], [], [liberated]));
    const stories = result.stories('foreign-city-liberated');
    expect(stories).toHaveLength(1);
    const nodes = [...stories[0].headline, ...stories[0].body.flat()];
    expect(nodes.some(node => node.type === 'link' && node.target.type === 'city')).toBe(false);
    const text = nodes.map(node => 'text' in node ? node.text : '').join(' ');
    expect(text).toContain('Brazil');
    expect(text).toContain('Carthage');
    expect(text).not.toContain('Utica');
  });
});
