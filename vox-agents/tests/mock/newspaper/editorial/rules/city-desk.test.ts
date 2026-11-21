import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvent, NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import type { EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { relationship, snapshot as diplomacySnapshot } from '../../../../helpers/newspaper-diplomacy.js';

let config: EditorialConfig;

/** Record a readable city at a fixed location on one date. */
function city(id: number, turn: number, x: number, owner: number, name: string, values: NewspaperSnapshot['values'] = {}): NewspaperSnapshot {
  return { subjectID: id, values: { X: x, Y: 2, Name: name, OwnerID: owner, ...values },
    source: { table: 'CityInformations', id: turn * 100 + id, turn, createdAt: turn * 1000 + 5 } };
}

/** Record a witnessed native event. */
function event(id: number, type: string, values: NewspaperEvent['values']): NewspaperEvent {
  return { type, values, source: { table: 'GameEvents', id, turn: 7, createdAt: 7001 } };
}

/** Supply a continuous visible history and one known rival. */
function fixture(cities: NewspaperSnapshot[], before: NewspaperSnapshot[] = [], events: NewspaperEvent[] = [],
  diplomaticState: 'peace' | 'war' = 'peace', friendly = false): NewspaperEvidence {
  const relation = relationship(1, diplomaticState, friendly ? { friendship: true } : {});
  const diplomacy = diplomacySnapshot(0, 10, [relation]);
  const players = [0, 1].map(subjectID => {
    const row = diplomacySnapshot(subjectID, 10, []);
    return { subjectID, values: {}, source: row.source };
  });
  const pastPlayers = players.map(row => ({ ...row, source: { ...row.source, turn: 0, id: row.subjectID, createdAt: 0 } }));
  return {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, historyFromTurn: -1 },
    players, cities, comparisons: { players: [], cities: before }, events,
    history: { fromTurn: -1, baseline: { cities: [], players: [] },
      snapshots: { cities: [...before, ...cities], players: [...pastPlayers, ...players] }, events, gaps: [] },
    diplomacy: { fromTurn: -1, baseline: [], history: [diplomacy], gaps: [] },
  };
}

/** Run the complete stock editor and expose the audit alongside published articles. */
async function check(evidence: NewspaperEvidence, catalogue = config) {
  const facts = buildNewspaperFacts(evidence, { playerIdentities: {
    0: { name: 'France', major: true, teamId: 100 }, 1: { name: 'Brazil', major: true, teamId: 101 },
  } });
  const result = await runEditorialCheck({
    campaignId: 'fixture', timelineId: 'city-desk', receiver: { playerId: 0, label: 'France' },
    evidence, facts, config: catalogue, speedMultiplier: 1, state: createInitialPublicationState(),
  });
  const audit = (id: string) => result.decision.triggerAudit.find(rule => rule.rule === id)!;
  const variants = Object.values(result.decision.selectedVariants);
  const items = result.status === 'published' ? result.issue.items : [];
  expect(result.decision.choiceErrors ?? []).toEqual([]);
  /** Find printed articles whose archived evidence includes this rule. */
  function stories(rule: string) {
    const ids = result.state.issues[0]?.items.filter(item => item.ruleIds?.includes(rule)).map(item => item.id);
    return items.filter(item => ids?.includes(item.id));
  }
  return { audit, items, variants, stories };
}

const home = city(10, 10, 0, 0, 'Tours');
const settlers = event(100, 'CityTrained', { PlayerID: 0, CityID: 10, CityX: 0, CityY: 2, Unit: 'Pioneer' });

describe('stock city desk', () => {
  beforeAll(async () => {
    config = await loadEditorialConfig();
    config.defaults.minItems = 1;
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

  it('should use one founding hook and report close rivals urgently, with or without a joined city', async () => {
    const town = city(20, 10, 2, 1, 'Recife');
    const founded = event(101, 'PlayerCityFounded', { PlayerID: 1, PlotX: 2, PlotY: 2 });
    const unitFounded = event(102, 'UnitCityFounded', founded.values);
    const result = await check(fixture([home, town], [], [founded, unitFounded]));
    const stories = result.stories('forward-settle');
    expect(stories).toHaveLength(1);
    const [article] = stories;
    const headline = article.headline.map(node => 'text' in node ? node.text : '').join('');
    expect(JSON.stringify(article.body)).toContain('Brazil');
    expect(headline).toContain('Tours');
    expect(result.audit('forward-settle').subjects).toMatchObject([{ subject: 'event/101', outcome: 'fired', urgent: true }]);
    const unnamed = (await check(fixture([home], [], [founded]))).stories('forward-settle');
    expect(unnamed).toHaveLength(1);
    expect(JSON.stringify(unnamed[0].body)).toContain('Brazil');
    expect(unnamed[0].body.flat()).not.toContainEqual(expect.objectContaining({ target: { type: 'city', cityId: expect.any(String) } }));
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
});
