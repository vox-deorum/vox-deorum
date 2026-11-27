import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvent, NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { context, relationship, snapshot as diplomacySnapshot } from '../../../../helpers/newspaper-diplomacy.js';
import { withEditionBriefs } from '../../../../helpers/newspaper-briefs.js';

let config: EditorialConfig;
const playerIdentities = Object.fromEntries(Object.entries(context.playerNames!).map(([id, name]) => [
  id, { name, major: Number(id) < 10, teamId: Number(id) + 100 },
]));

/** Record a readable city at a fixed location on one date. */
function city(id: number, turn: number, x: number, owner: number, name: string,
  values: NewspaperSnapshot['values'] = {}): NewspaperSnapshot {
  return {
    subjectID: id,
    values: { X: x, Y: 2, Name: name, OwnerID: owner, ...values },
    source: { table: 'CityInformations', id: turn * 100 + id, turn, createdAt: turn * 1000 + 5 },
  };
}

/** Record a witnessed event at the reporting turn. */
function gameEvent(id: number, type: string, turn: number, values: NewspaperEvent['values']): NewspaperEvent {
  return { type, values, source: { table: 'GameEvents', id, turn, createdAt: turn * 1000 + 1 } };
}

/** Supply a continuous visible history for France, Brazil and India. */
function fixture(cities: NewspaperSnapshot[], before: NewspaperSnapshot[] = [], events: NewspaperEvent[] = [],
  foreignWar = false): NewspaperEvidence {
  const receiver = diplomacySnapshot(0, 10, [relationship(1), relationship(2)]);
  const rival = diplomacySnapshot(1, 10, [relationship(2, foreignWar ? 'war' : 'peace')]);
  const diplomacy = [receiver, rival];
  const players = [0, 1, 2].map(subjectID => {
    const row = diplomacySnapshot(subjectID, 10, []);
    return { subjectID, values: {}, source: row.source };
  });
  const pastPlayers = players.map(row => ({
    ...row,
    source: { ...row.source, id: row.subjectID, turn: 0, createdAt: 0 },
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
      snapshots: { cities: [...before, ...cities], players: [...pastPlayers, ...players] },
      events,
      gaps: [],
    },
    diplomacy: { fromTurn: -1, baseline: [], history: diplomacy, gaps: [] },
  };
}

/** Run the stock editor, keeping the audit and the printed issue in view. */
async function check(input: NewspaperEvidence, catalogue = config) {
  const { evidence, config: fullConfig } = withEditionBriefs(input, catalogue, 6);
  const facts = buildNewspaperFacts(evidence, { playerIdentities });
  const result = await runEditorialCheck({
    campaignId: 'fixture', timelineId: 'foreign-city-desk', receiver: { playerId: 0, label: 'France' },
    evidence, facts, config: fullConfig, speedMultiplier: 1, state: createInitialPublicationState(),
  });
  expect(result.decision.choiceErrors ?? []).toEqual([]);
  const audit = (id: string) => result.decision.triggerAudit.find(rule => rule.rule === id)!;
  const fired = (id: string) => audit(id).subjects
    .filter(subject => subject.outcome === 'fired').map(subject => subject.subject);
  /** Find printed articles whose archived record includes this rule. */
  function stories(rule: string) {
    const ids = result.state.issues[0]?.items.filter(item => item.ruleIds?.includes(rule)).map(item => item.id);
    return result.issue?.items.filter(item => ids?.includes(item.id)) ?? [];
  }
  return { result, audit, fired, stories };
}

/** Find a rule's account in the issue and check its rendered names and city links. */
function expectStory(result: Awaited<ReturnType<typeof check>>, rule: string, names: string[]) {
  const record = result.result.state.issues[0]?.items.find(item => item.ruleIds?.includes(rule));
  expect(record).toBeDefined();
  const item = result.result.issue?.items.find(entry => entry.id === record?.id);
  expect(item).toBeDefined();
  const story = JSON.stringify(item);
  for (const name of names) expect(story).toContain(name);
  expect(story).not.toContain('{{');
  return { record: record!, item: item! };
}

const home = city(10, 10, 0, 0, 'Tours');

describe('stock foreign city desk', () => {
  beforeAll(async () => {
    config = await loadEditorialConfig();
  });

  describe('settlement', () => {
    it('should report a nearby foreign founding from the unit hook when the player hook is absent', async () => {
      const town = city(20, 10, 10, 1, 'Recife');
      const founded = gameEvent(101, 'UnitCityFounded', 9, { PlayerID: 1, PlotX: 10, PlotY: 2 });
      const result = await check(fixture([home, town], [], [founded]));

      expect(result.fired('foreign-city-founded')).toEqual(['event/101']);
      const story = expectStory(result, 'foreign-city-founded', ['Recife', 'Brazil']);
      expect([...story.item.headline, ...story.item.body.flat()]).toContainEqual(expect.objectContaining({
        type: 'link', target: { type: 'city', cityId: '20' },
      }));
      expect(story.record.sources).toContainEqual(expect.objectContaining({ table: 'GameEvents', id: 101 }));
      expect(story.record.sources).toContainEqual(expect.objectContaining({ table: 'CityInformations', id: town.source.id }));
    });

    it('should prefer the player hook when both hooks report the same settlement', async () => {
      const town = city(20, 10, 10, 1, 'Recife');
      const canonical = gameEvent(102, 'PlayerCityFounded', 9, { PlayerID: 1, PlotX: 10, PlotY: 2 });
      const duplicate = gameEvent(103, 'UnitCityFounded', 9, { PlayerID: 1, PlotX: 10, PlotY: 2 });

      const alone = await check(fixture([home, town], [], [canonical]));
      expect(alone.fired('foreign-city-founded')).toEqual(['event/102']);

      const both = await check(fixture([home, town], [], [canonical, duplicate]));
      expect(both.fired('foreign-city-founded')).toEqual(['event/102']);
      expect(both.audit('foreign-city-founded').subjects)
        .toContainEqual(expect.objectContaining({ subject: 'event/103', outcome: 'false' }));
    });

    it('should leave an adjacent rival settlement to the forward-settle rule', async () => {
      const town = city(20, 10, 3, 1, 'Recife');
      const founded = gameEvent(104, 'PlayerCityFounded', 9, { PlayerID: 1, PlotX: 3, PlotY: 2 });
      const result = await check(fixture([home, town], [], [founded]));

      expect(result.fired('forward-settle')).toEqual(['event/104']);
      expect(result.fired('foreign-city-founded')).toEqual([]);
      expectStory(result, 'forward-settle', ['Recife', 'Tours', 'Brazil']);
    });
  });

  describe('construction', () => {
    it.each([
      { owner: 0, name: 'Tours', building: 'Courthouse', rule: 'city-courthouse-completed', generic: 'building-purchased' },
      { owner: 1, name: 'Recife', building: "Satrap's Court", rule: 'foreign-city-courthouse-completed', generic: 'foreign-building-purchased' },
    ])('should give an integrating $building one account and keep ordinary construction separate', async ({ owner, name, building, rule, generic }) => {
      const prior = city(20, 5, 10, owner, name, { IsPuppet: false, IsOccupied: true });
      const occupied = city(20, 10, 10, owner, name, { IsPuppet: false, IsOccupied: true, ImportantBuildings: [building] });
      const completion = gameEvent(113, 'CityConstructed', 9, {
        OwnerID: owner, CityID: 20, CityX: 10, CityY: 2, Building: building, IsGoldPurchase: true,
      });
      const base = owner === 0 ? [] : [home];
      const integrated = await check(fixture([...base, occupied], [prior], [completion]));
      expect(integrated.fired(rule)).toEqual(['event/113']);
      expect(integrated.fired(generic)).toEqual([]);
      expectStory(integrated, rule, [name, building, ...(owner === 1 ? ['Brazil'] : [])]);

      const ordinary = { ...occupied, values: { ...occupied.values, IsOccupied: false } };
      const genericResult = await check(fixture([...base, ordinary], [prior], [completion]));
      expect(genericResult.fired(rule)).toEqual([]);
      expect(genericResult.fired(generic)).toEqual(['event/113']);
      const { item } = expectStory(genericResult, generic, [name, building]);
      expect([...item.headline, ...item.body.flat()]).toContainEqual(expect.objectContaining({
        type: 'link', text: name, target: { type: 'city', cityId: '20' },
      }));
    });

    it('should read a nearby investment from a basic snapshot and drop it after a matching completion', async () => {
      const earlier = city(20, 5, 10, 1, 'Recife');
      const town = city(20, 10, 10, 1, 'Recife');
      const invested = gameEvent(105, 'CityInvestedBuilding', 9, {
        PlayerID: 1, CityID: 20, CityX: 10, CityY: 2, Building: 'Market', Invested: true,
      });

      const basic = await check(fixture([home, town], [earlier], [invested]));
      expect(basic.fired('foreign-building-investment-made')).toEqual(['event/105']);
      expectStory(basic, 'foreign-building-investment-made', ['Market', 'Recife', 'Brazil']);

      const built = gameEvent(106, 'CityConstructed', 10, {
        OwnerID: 1, CityID: 20, CityX: 10, CityY: 2, Building: 'Market',
      });
      const completed = await check(fixture([home, town], [earlier], [invested, built]));
      expect(completed.fired('foreign-building-investment-made')).toEqual([]);
    });

    it('should suppress a completed defense when the same settlement is founded that turn', async () => {
      const earlier = city(20, 5, 10, 1, 'Recife');
      const town = city(20, 10, 10, 1, 'Recife');
      const walls = gameEvent(107, 'CityConstructed', 9, {
        OwnerID: 1, CityID: 20, CityX: 10, CityY: 2, Building: 'Walls',
      });

      const built = await check(fixture([home, town], [earlier], [walls]));
      expect(built.fired('foreign-city-defense-completed')).toEqual(['event/107']);
      expectStory(built, 'foreign-city-defense-completed', ['Walls', 'Recife', 'Brazil']);

      const founded = gameEvent(108, 'PlayerCityFounded', 9, { PlayerID: 1, PlotX: 10, PlotY: 2 });
      const sameTurn = await check(fixture([home, town], [earlier], [walls, founded]));
      expect(sameTurn.fired('foreign-city-defense-completed')).toEqual([]);
    });
  });

  describe('civic life', () => {
    it.each([
      { owner: 0, name: 'Tours', rule: 'city-celebration-begins' },
      { owner: 1, name: 'Recife', rule: 'foreign-city-celebration-begins' },
    ])('should report a witnessed celebration in $name from the recorded start', async ({ owner, name, rule }) => {
      const earlier = city(20, 5, 10, owner, name);
      const town = city(20, 10, 10, owner, name);
      const celebration = gameEvent(114, 'CityBeginsWLTKD', 9, { PlayerID: owner, CityX: 10, CityY: 2 });
      const base = owner === 0 ? [] : [home];
      const result = await check(fixture([...base, town], [earlier], [celebration]));
      expect(result.fired(rule)).toEqual(['event/114']);
      const story = expectStory(result, rule, [name, ...(owner === 1 ? ['Brazil'] : [])]);
      expect(story.record.sources).toContainEqual(expect.objectContaining({ table: 'GameEvents', id: 114 }));

      const wrongOwner = { ...celebration, values: { ...celebration.values, PlayerID: 2 } };
      expect((await check(fixture([...base, town], [earlier], [wrongOwner]))).fired(rule)).toEqual([]);
    });

    it('should require a same-owner population baseline for a foreign growth milestone', async () => {
      const before = city(20, 5, 10, 1, 'Recife', { Population: 14 });
      const grown = city(20, 10, 10, 1, 'Recife', { Population: 25 });

      const result = await check(fixture([home, grown], [before]));
      const milestone = result.audit('foreign-city-growth-milestone').subjects
        .filter(subject => subject.outcome === 'fired');
      expect(milestone).toMatchObject([{ subject: 'city/20', tier: 'notable' }]);
      expectStory(result, 'foreign-city-growth-milestone', ['Recife', 'Brazil']);

      expect((await check(fixture([home, grown]))).fired('foreign-city-growth-milestone')).toEqual([]);

      const oursBefore = city(20, 5, 10, 0, 'Recife', { Population: 14 });
      expect((await check(fixture([home, grown], [oursBefore]))).fired('foreign-city-growth-milestone')).toEqual([]);
    });

    it('should report hardship only from a readable cause', async () => {
      const basic = city(20, 10, 10, 1, 'Recife');
      expect((await check(fixture([home, basic]))).fired('foreign-city-hardship')).toEqual([]);

      const famine = city(20, 10, 10, 1, 'Recife', { UnhappinessSources: { Famine: 3 } });
      const hardship = await check(fixture([home, famine]));
      expect(hardship.fired('foreign-city-hardship')).toEqual(['city/20']);
      expectStory(hardship, 'foreign-city-hardship', ['Recife', 'Brazil']);

      const pillaged = city(20, 10, 10, 1, 'Recife', { UnhappinessSources: { PillagedTiles: 2 } });
      expect((await check(fixture([home, pillaged]))).fired('foreign-city-hardship')).toEqual(['city/20']);
    });

    it('should require a witnessed settler training and a readable food surplus', async () => {
      const before = city(20, 5, 10, 1, 'Recife', { Population: 8 });
      const shrunk = city(20, 10, 10, 1, 'Recife', { Population: 6 });
      const trained = gameEvent(109, 'CityTrained', 9, {
        PlayerID: 1, CityID: 20, CityX: 10, CityY: 2, Unit: 'Pioneer',
      });

      const basic = await check(fixture([home, shrunk], [before], [trained]));
      expect(basic.fired('foreign-city-raises-settlers')).toEqual([]);

      const fed = city(20, 10, 10, 1, 'Recife', { Population: 6, FoodPerTurn: 2 });
      const settler = await check(fixture([home, fed], [before], [trained]));
      expect(settler.fired('foreign-city-raises-settlers')).toEqual(['city/20']);
      expectStory(settler, 'foreign-city-raises-settlers', ['Recife', 'Brazil']);
    });
  });

  describe('ownership and conflict', () => {
    it('should report the same owner bringing a puppet under direct rule', async () => {
      const puppet = city(20, 5, 5, 0, 'Orléans', { IsPuppet: true, IsOccupied: false });
      const occupied = city(20, 10, 5, 0, 'Orléans', { IsPuppet: false, IsOccupied: true });
      const result = await check(fixture([home, occupied], [puppet]));
      expect(result.fired('city-puppet-annexed')).toEqual(['city/20']);
      expectStory(result, 'city-puppet-annexed', ['Orléans']);

      const otherPuppet = { ...puppet, values: { ...puppet.values, OwnerID: 1 } };
      expect((await check(fixture([home, occupied], [otherPuppet]))).fired('city-puppet-annexed')).toEqual([]);
      expect((await check(fixture([home, occupied]))).fired('city-puppet-annexed')).toEqual([]);
    });

    it('should give an overlapping flip and conquest one account and leave resistance to a quiet transfer', async () => {
      const occupied = city(20, 10, 5, 1, 'Recife', { IsOccupied: true, ResistanceTurns: 3 });
      const transfer = { CityX: 5, CityY: 2, OldOwnerID: 2, NewOwnerID: 1 };
      const flip = gameEvent(110, 'CityFlipped', 9, { ...transfer, CityID: 20 });
      const capture = gameEvent(111, 'CityCaptureComplete', 9, { ...transfer, IsCapital: false, IsConquest: true });

      const conquered = await check(fixture([home, occupied], [], [flip, capture]));
      expect(conquered.fired('foreign-city-flips')).toEqual([]);
      expect(conquered.fired('foreign-occupied-city-resists')).toEqual([]);
      expect([...conquered.stories('nearby-city-captured'), ...conquered.stories('foreign-city-flips')]).toHaveLength(1);

      const quiet = await check(fixture([home, occupied]));
      expect(quiet.fired('foreign-occupied-city-resists')).toEqual(['city/20']);
      expectStory(quiet, 'foreign-occupied-city-resists', ['Recife', 'Brazil']);

      const nonConquest = { ...capture, values: { ...capture.values, IsConquest: false } };
      const flipped = await check(fixture([home, occupied], [], [flip, nonConquest]));
      expect(flipped.fired('foreign-city-flips')).toEqual(['event/110']);
      expect(flipped.fired('foreign-occupied-city-resists')).toEqual([]);
      expectStory(flipped, 'foreign-city-flips', ['Recife', 'Brazil', 'India']);
    });

    it('should use different coverage for heavy damage with and without a known foreign war', async () => {
      const before = city(20, 5, 10, 1, 'Recife', { HitPoints: 120, MaxHitPoints: 200 });
      const damaged = city(20, 10, 10, 1, 'Recife', { HitPoints: 90, MaxHitPoints: 200 });

      const result = await check(fixture([home, damaged], [before], [], true));
      expect(result.fired('foreign-city-takes-heavy-damage')).toEqual(['city/20']);
      const wartime = expectStory(result, 'foreign-city-takes-heavy-damage', ['Recife', 'Brazil']);

      const noKnownWar = await check(fixture([home, damaged], [before]));
      expect(noKnownWar.fired('foreign-city-takes-heavy-damage')).toEqual(['city/20']);
      const neutral = expectStory(noKnownWar, 'foreign-city-takes-heavy-damage', ['Recife']);
      expect(noKnownWar.result.decision.selectedVariants[neutral.item.id])
        .not.toBe(result.result.decision.selectedVariants[wartime.item.id]);

      const lighter = city(20, 10, 10, 1, 'Recife', { HitPoints: 110, MaxHitPoints: 200 });
      expect((await check(fixture([home, lighter], [before], [], true)))
        .fired('foreign-city-takes-heavy-damage')).toEqual([]);
    });

    it('should report a foreign liberation without inventing a city link', async () => {
      const liberatedCity = city(20, 10, 30, 2, 'Utica');
      const liberated = gameEvent(112, 'PlayerLiberated', 9, {
        LiberatingPlayerID: 1, LiberatedPlayerID: 2, CityID: 20,
      });
      const result = await check(fixture([home, liberatedCity], [], [liberated]));

      expect(result.fired('foreign-city-liberated')).toEqual(['event/112']);
      const story = expectStory(result, 'foreign-city-liberated', ['Brazil', 'India']);
      const nodes = [...story.item.headline, ...story.item.body.flat()];
      expect(nodes.some(node => node.type === 'link' && node.target.type === 'city')).toBe(false);
      expect(JSON.stringify(story.item)).not.toContain('Utica');
    });
  });
});
