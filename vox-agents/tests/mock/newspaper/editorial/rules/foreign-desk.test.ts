import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { context, event, evidence, relationship, scores, snapshot } from '../../../../helpers/newspaper-diplomacy.js';
import { withEditionBriefs } from '../../../../helpers/newspaper-briefs.js';

/** Supply a public city observation with a stable identity. */
function city(id: number, turn: number, owner: number, name: string, x: number, wonders: string[] = []): NewspaperSnapshot {
  return {
    subjectID: id, source: { table: 'CityInformations', id: id * 100 + turn, turn, createdAt: turn * 1000 + 500 },
    values: { OwnerID: owner, Name: name, X: x, Y: 0, Wonders: wonders },
  };
}

const home = city(10, 8, 0, 'Paris', 0);
const playerIdentities = Object.fromEntries(Object.entries(context.playerNames!).map(([id, name]) => [
  id, { name, major: Number(id) < 10, teamId: Number(id) + 100 },
]));

/** Run an ordinary publication check with the stock catalogue and dated contact evidence. */
async function publish(input: NewspaperEvidence, cities: NewspaperSnapshot[] = [], earlierCities: NewspaperSnapshot[] = []) {
  const current = new Map(input.diplomacy?.history.filter(row => row.source.turn === input.request.cutoffTurn)
    .map(row => [row.subjectID, row.source]));
  const projected: NewspaperEvidence = {
    ...input, cities, players: input.players.map(row => ({ ...row, source: current.get(row.subjectID) ?? row.source })),
    history: {
      fromTurn: -1, baseline: { players: [], cities: [] },
      snapshots: {
        cities: [...earlierCities, ...cities],
        players: [
          ...input.players.map(row => ({ ...row, source: { ...row.source, turn: 0, createdAt: 0 } })),
          ...(input.diplomacy?.history.filter(row => row.source.turn < input.request.cutoffTurn)
            .map(row => ({ subjectID: row.subjectID, source: row.source, values: {} })) ?? []),
        ],
      },
      events: input.events, gaps: [],
    },
  };
  const { evidence, config } = withEditionBriefs(projected, await loadEditorialConfig());
  return runEditorialCheck({
    campaignId: 'fixture', timelineId: 'foreign-desk', receiver: { playerId: 0, label: 'France' },
    evidence, facts: buildNewspaperFacts(evidence, { playerIdentities }),
    config, context, speedMultiplier: 1, state: createInitialPublicationState(),
  });
}

/** Find a stock rule's account in the issue and verify the visible names made it into the story. */
function expectStory(result: Awaited<ReturnType<typeof publish>>, id: string, names: string[]) {
  const record = result.state.issues[0]?.items.find(item => item.ruleIds?.includes(id));
  expect(record).toBeDefined();
  const item = result.issue?.items.find(item => item.id === record?.id);
  expect(item).toBeDefined();
  const story = JSON.stringify(item);
  for (const name of names) expect(story).toContain(name);
  expect(story).not.toContain('{{');
  return item!;
}

/** Read the subjects that actually qualified for a particular stock rule. */
function fired(result: Awaited<ReturnType<typeof publish>>, rule: string) {
  return result.decision.triggerAudit.find(entry => entry.rule === rule)?.subjects
    .filter(subject => subject.outcome === 'fired').map(subject => subject.subject);
}

type Term = readonly [type: string, label: string, data1?: number, data2?: number];

/** Record the same directional terms and printable labels supplied by DealMade. */
function deal(id: number, from: number, to: number, fromTerms: Term[], toTerms: Term[], turn = 9) {
  return event('DealMade', id, turn, from, to, {
    FromPlayerID: from, ToPlayerID: to,
    FromGives: fromTerms.length ? fromTerms.map(([, label]) => label) : {},
    ToGives: toTerms.length ? toTerms.map(([, label]) => label) : {},
    TradedItems: [[from, fromTerms] as const, [to, toTerms] as const].flatMap(([giver, terms]) =>
      terms.map(([ItemType, , Data1, Data2]) => ({ FromPlayerID: giver, ItemType, Data1, Data2 }))),
  });
}

const gold: Term = ['Gold', '10 Gold'];
const silk: Term = ['Resources', '1 Silk'];
const embassy: Term = ['AllowEmbassy', 'Embassy'];
const borders: Term = ['OpenBorders', 'Open Borders'];
const map: Term = ['Maps', 'World Map'];
const technology: Term = ['Techs', 'Technology: Printing Press'];

describe('stock foreign desk', () => {
  describe('completed deals', () => {
    it.each([
      ['technology-deal', 'buy', [gold], [technology]],
      ['technology-deal', 'sell', [technology], [gold]],
      ['technology-deal', 'exchange', [technology], [['Techs', 'Technology: Banking']]],
      ['map-deal', 'buy', [gold], [map]],
      ['map-deal', 'sell', [map], [gold]],
      ['map-deal', 'exchange', [map], [map]],
    ] satisfies [string, string, Term[], Term[]][])('should publish the %s %s variant from our perspective', async (rule, direction, ours, theirs) => {
      const result = await publish(evidence([deal(1, 1, 0, theirs, ours)], [snapshot(0, 8, [relationship(1)])]));
      expect(fired(result, 'trade-deal')).toEqual([]);
      expect(fired(result, 'comprehensive-agreement')).toEqual([]);
      const story = expectStory(result, rule, ['Brazil']);
      expect(result.decision.selectedVariants[story.id]).toBe(`${rule}-${direction}-report`);
    });

    it('should separate real trade, gifts, embassies with gold, and research agreements', async () => {
      const pact: Term = ['ResearchAgreement', 'Research Agreement'];
      const incomplete = deal(7, 0, 1, [silk], [gold]);
      delete incomplete.values.TradedItems;
      const malformed = deal(8, 0, 1, [silk], [gold]);
      malformed.values.TradedItems = [{ ItemType: 'Gold', FromPlayerID: 2 }];
      const result = await publish(evidence([
        deal(1, 0, 1, [silk], [gold]), deal(2, 0, 1, [], [gold]),
        deal(3, 0, 1, [embassy], [embassy, gold]), deal(4, 0, 1, [embassy], []),
        deal(5, 0, 1, [pact], [pact]), deal(6, 0, 1, [['PeaceTreaty', 'Peace Treaty']], [gold]),
        incomplete, malformed,
      ], [snapshot(0, 8, [relationship(1), relationship(2)])]));
      expect(fired(result, 'trade-deal')).toEqual(['event/1']);
      expect(fired(result, 'trade-gift')).toEqual(['event/2']);
      expect(fired(result, 'embassy-agreement')).toEqual(['event/3', 'event/4']);
      expect(fired(result, 'research-agreement')).toEqual(['event/5']);
      expect(fired(result, 'comprehensive-agreement')).toEqual([]);
      expectStory(result, 'embassy-agreement', ['Brazil', 'Embassy']);
    });

    it('should cover the package and its matching border grant while retaining an independent deal and reverse grant', async () => {
      const combined = deal(1, 0, 1, [embassy, borders], [silk], 10);
      const reverseGrant = deal(3, 1, 0, [borders], []);
      const observedRelation = [0, 1].flatMap(player => [
        snapshot(player, 5, [relationship(1 - player, 'peace', { openBordersTo: false })]),
        snapshot(player, 10, [relationship(1 - player, 'peace', { openBordersTo: true })]),
      ]);
      const result = await publish(evidence([combined, deal(2, 0, 1, [silk], [gold]), reverseGrant], observedRelation));
      expect(fired(result, 'comprehensive-agreement')).toEqual(['event/1']);
      expect(fired(result, 'trade-deal')).toEqual(['event/2']);
      expect(fired(result, 'embassy-agreement')).toEqual([]);
      expect(fired(result, 'open-borders-granted')).toEqual([]);
      expect(fired(result, 'open-borders-received')).toEqual(['player/1']);
      expectStory(result, 'comprehensive-agreement', ['Brazil', 'Embassy', 'Open Borders', 'Silk']);
    });

    it('should replace the gain of a traded technology but keep independent research on the same turn', async () => {
      const result = await publish(evidence([
        event('TeamTechResearched', 1, 9, 0, 0, { TeamID: 100, Tech: 'Printing Press', ChangeAmount: 1 }),
        event('TeamTechResearched', 2, 9, 0, 0, { TeamID: 100, Tech: 'Banking', ChangeAmount: 1 }),
        deal(3, 0, 1, [map], [technology]),
      ], [snapshot(0, 8, [relationship(1)])]));
      expect(fired(result, 'comprehensive-agreement')).toEqual(['event/3']);
      expect(fired(result, 'map-deal')).toEqual([]);
      expect(fired(result, 'technology-deal')).toEqual([]);
      expect(fired(result, 'our-team-gains-technology')).toEqual(['event/2']);
      expectStory(result, 'comprehensive-agreement', ['Brazil', 'World Map', 'Printing Press']);
    });

    it('should distinguish a city transferred in a package from a separate conquest', async () => {
      const transferred = city(20, 10, 0, 'Salvador', 6);
      const captured = city(21, 10, 0, 'Delhi', 8);
      const result = await publish(evidence([
        event('CityCaptureComplete', 1, 9, 1, 0, { OldOwnerID: 1, NewOwnerID: 0, IsConquest: false, CityX: 6, CityY: 0 }),
        event('CityCaptureComplete', 2, 9, 2, 0, { OldOwnerID: 2, NewOwnerID: 0, IsConquest: true, CityX: 8, CityY: 0 }),
        deal(3, 0, 1, [embassy], [['Cities', 'City of Salvador', 6, 0]]),
      ], [snapshot(0, 8, [relationship(1), relationship(2)])]), [transferred, captured]);
      expect(fired(result, 'comprehensive-agreement')).toEqual(['event/3']);
      expect(fired(result, 'city-capture-involving-us')).toEqual(['event/2']);
      expectStory(result, 'comprehensive-agreement', ['Brazil', 'Salvador']);
    });

    it('should let a package cover its pact while reporting a standalone friendship', async () => {
      const pact: Term = ['DefensivePact', 'Defensive Pact'];
      const friendship: Term = ['DeclarationOfFriendship', 'Declaration of Friendship'];
      const result = await publish(evidence([
        deal(1, 0, 1, [embassy, pact], [pact]), deal(2, 0, 1, [friendship], [friendship]),
      ], [
        snapshot(0, 5, [relationship(1, 'peace', { friendship: false, defensivePact: false })]),
        snapshot(0, 10, [relationship(1, 'peace', { friendship: true, defensivePact: true })]),
      ]));
      expect(fired(result, 'comprehensive-agreement')).toEqual(['event/1']);
      expect(fired(result, 'defensive-pact-signed')).toEqual([]);
      expect(fired(result, 'friendship-begins')).toEqual(['pair/0/1']);
    });

    it('should leave standalone third-party coverage intact when another deal includes a war clause', async () => {
      const war: Term = ['ThirdPartyWar', 'Declare War on India', 102];
      const result = await publish(evidence([
        deal(1, 0, 1, [gold], [war]), deal(2, 0, 1, [borders], [war]),
      ], [snapshot(0, 8, [relationship(1), relationship(2)])]));
      expect(fired(result, 'third-party-war-deal')).toEqual(['event/1']);
      expect(fired(result, 'comprehensive-agreement')).toEqual(['event/2']);
    });
  });

  it('should report a nearby third-party capital taken by conquest and exclude other transfers', async () => {
    const capture = { IsCapital: true, IsConquest: true, OldOwnerID: 1, NewOwnerID: 2, CityX: 4, CityY: 0 };
    const result = await publish(evidence([
      event('CityCaptureComplete', 1, 9, 2, 1, capture),
      event('CityCaptureComplete', 2, 9, 2, 1, { ...capture, IsCapital: false, CityX: 5 }),
      event('CityCaptureComplete', 3, 9, 2, 1, { ...capture, IsConquest: false, CityX: 6 }),
      event('CityCaptureComplete', 4, 9, 2, 1, { ...capture, OldOwnerID: 0, CityX: 7 }),
      event('CityCaptureComplete', 5, 9, 2, 1, { ...capture, CityX: 16 }),
    ], [snapshot(0, 8, [relationship(1), relationship(2)])]), [home, city(20, 10, 2, 'Rio de Janeiro', 4)]);
    expect(fired(result, 'nearby-capital-falls')).toEqual(['event/1']);
    expectStory(result, 'nearby-capital-falls', ['Rio de Janeiro', 'Brazil', 'India']);
    expect(result.decision.evidence).toContainEqual(expect.objectContaining({ table: 'GameEvents', id: 1 }));
  });

  it('should skip the capture when the capital has no readable city name', async () => {
    const result = await publish(evidence([
      event('CityCaptureComplete', 1, 9, 2, 1,
        { IsCapital: true, IsConquest: true, OldOwnerID: 1, NewOwnerID: 2, CityX: 4, CityY: 0 }),
    ], [snapshot(0, 8, [relationship(1), relationship(2)])]), [home]);
    expect(fired(result, 'nearby-capital-falls')).toEqual([]);
  });

  it('should avoid doubling a name when the capital and its former owner share it', async () => {
    const result = await publish(evidence([
      event('CityCaptureComplete', 1, 9, 11, 10,
        { IsCapital: true, IsConquest: true, OldOwnerID: 10, NewOwnerID: 11, CityX: 4, CityY: 0 }),
    ], [snapshot(0, 8, [relationship(10), relationship(11)])]), [home, city(20, 10, 11, 'Geneva', 4)]);
    const item = expectStory(result, 'nearby-capital-falls', ['Geneva', 'Sidon']);
    const copy = [item.headline, ...item.body].map(line => line.map(node => 'text' in node ? node.text : '').join('')).join(' ');
    expect(copy.match(/Geneva/g)).toHaveLength(1);
  });

  it('should report a newly finished nearby wonder only when its city belongs to an enemy', async () => {
    const result = await publish(evidence([], [snapshot(0, 10, [relationship(1, 'war'), relationship(2)])]), [
      home, city(20, 10, 1, 'Sao Paulo', 4, ['Petra']), city(21, 10, 1, 'Recife', 6, ['Pyramids']),
      city(22, 10, 2, 'Delhi', 5, ['Great Library']), city(23, 10, 1, 'Salvador', 16, ['Stonehenge']),
    ], [
      city(20, 8, 1, 'Sao Paulo', 4), city(21, 8, 1, 'Recife', 6, ['Pyramids']),
      city(22, 8, 2, 'Delhi', 5), city(23, 8, 1, 'Salvador', 16),
    ]);
    expect(fired(result, 'enemy-wonder-nearby')).toEqual(['city/20']);
    const story = expectStory(result, 'enemy-wonder-nearby', ['Petra']);
    const record = result.state.issues[0]?.items.find(item => item.id === story.id);
    expect(record?.sources).toContainEqual(expect.objectContaining({ table: 'CityInformations', id: 2010 }));
  });

  it.each([
    ['a recorded gain', true, 'nearby-team-gains-known-technology'],
    ['a recorded loss', false, 'nearby-team-gains-technology'],
    ['no recorded change', undefined, 'nearby-team-gains-technology'],
  ] as const)('should choose one nearby technology account for %s on our team', async (_history, gained, rule) => {
    const tech = 'Printing Press';
    const ownChange = { table: 'GameEvents', id: 100, turn: 2, createdAt: 2000 } as const;
    const input = evidence([
      event('TeamTechResearched', 1, 9, 1, 1, { TeamID: 101, Tech: tech, ChangeAmount: 1 }),
      event('TeamTechResearched', 2, 9, 2, 2, { TeamID: 102, Tech: tech, ChangeAmount: 1 }),
      event('TeamTechResearched', 3, 9, 1, 1, { TeamID: 101, Tech: tech, ChangeAmount: -1 }),
    ], [snapshot(0, 8, [relationship(1), relationship(2)])]);
    if (gained !== undefined) input.receiverTechnologies = [{ name: tech, gained, source: ownChange }];
    const result = await publish(input, [home, city(11, 8, 1, 'Salvador', 4), city(12, 8, 2, 'Delhi', 35)]);

    expect(fired(result, 'nearby-team-gains-technology')).toEqual(gained ? [] : ['event/1']);
    expect(fired(result, 'nearby-team-gains-known-technology')).toEqual(gained ? ['event/1'] : []);
    const article = expectStory(result, rule, ['Brazil', tech]);
    const record = result.state.issues[0]?.items.find(item => item.id === article.id);
    expect(record?.templateIds).toContain(`${rule}-account`);
    if (gained !== undefined) expect(record?.sources).toContainEqual(ownChange);
  });

  it('should report Geneva changing sides and exclude a city-state that merely lost its ally', async () => {
    const result = await publish(evidence([
      event('SetAlly', 1, 9, 10, 1, { MinorPlayerID: 10, OldAllyPlayerID: 0, NewAllyPlayerID: 1 }),
      event('SetAlly', 2, 9, 11, 0, { MinorPlayerID: 11, OldAllyPlayerID: 0, NewAllyPlayerID: -1 }),
      event('SetAlly', 3, 9, 12, 1, { MinorPlayerID: 12, OldAllyPlayerID: 0, NewAllyPlayerID: 1 }),
    ], [snapshot(0, 10, [relationship(1), relationship(10), relationship(11), relationship(12)])]), [
      home, city(20, 10, 10, 'Geneva', 4), city(21, 10, 11, 'Sidon', 5), city(22, 10, 12, 'Riga', 16),
    ]);
    expect(fired(result, 'city-state-ally-defects')).toEqual(['event/1']);
    expectStory(result, 'city-state-ally-defects', ['Geneva', 'Brazil']);
  });

  it('should report a city-state alliance ending when the game explicitly records no successor', async () => {
    const result = await publish(evidence([
      event('SetAlly', 1, 9, 10, 0, { MinorPlayerID: 10, OldAllyPlayerID: 0, NewAllyPlayerID: -1 }),
      event('SetAlly', 2, 9, 11, 0, { MinorPlayerID: 11, OldAllyPlayerID: 0 }),
      event('SetAlly', 3, 9, 12, 1, { MinorPlayerID: 12, OldAllyPlayerID: 0, NewAllyPlayerID: 1 }),
    ], [snapshot(0, 10, [relationship(1), relationship(10), relationship(11), relationship(12)])]));
    expect(fired(result, 'city-state-ally-lost')).toEqual(['event/1']);
  });

  it('should report an election failure only when the city-state has a name', async () => {
    const outcome = { PlayerID: 0, InfluenceChange: -8 };
    const result = await publish(evidence([
      event('ElectionResultFailure', 1, 9, 0, 10, { ...outcome, CityState: 'Geneva' }),
      event('ElectionResultFailure', 2, 9, 0, 11, outcome),
      event('ElectionResultFailure', 3, 9, 0, 12, { ...outcome, CityState: '   ' }),
    ], [snapshot(0, 8, [])]));

    expect(fired(result, 'election-operation')).toEqual(['event/1']);
    expectStory(result, 'election-operation', ['Geneva']);
  });

  it('should use the prewar relationships for attacks on friends, allies and city-state captures', async () => {
    const result = await publish(evidence([
      ...[10, 11, 12, 13].map((target, index) => event('DeclareWar', index + 1, 9, 1, target, { IsAggressor: true })),
      ...[10, 11, 12, 13].map((target, index) => event('CityCaptureComplete', index + 5, 9, 1, target, {
        OldOwnerID: target, NewOwnerID: 1, IsConquest: true, IsCapital: true,
      })),
      event('DeclareWar', 9, 9, 2, 3, { IsAggressor: true }),
    ], [
      snapshot(0, 8, [
        relationship(1), relationship(2, 'peace', { friendship: true }), relationship(3, 'peace', { friendship: true }),
        relationship(10, 'peace', { friendship: true, ally: true }),
        relationship(11, 'peace', { friendship: true }), relationship(12), relationship(13, 'peace', { friendship: true }),
      ]),
      snapshot(10, 8, [], { majorAllyPlayerID: 0 }),
      snapshot(11, 8, [], { majorAllyPlayerID: 1 }),
      snapshot(12, 8, [], { majorAllyPlayerID: null }),
      snapshot(13, 8, []),
      snapshot(0, 10, [relationship(1), relationship(2), relationship(3), relationship(10), relationship(11), relationship(12), relationship(13)]),
    ]));
    expect(fired(result, 'ally-city-state-attacked')).toEqual(['incident/war/9/1']);
    expect(fired(result, 'friendly-city-state-attacked')).toEqual(['incident/war/9/2']);
    expect(fired(result, 'ally-city-state-captured')).toEqual(['event/5']);
    expect(fired(result, 'friendly-city-state-captured')).toEqual(['event/6']);
    expect(fired(result, 'war-between-friends')).toEqual(['incident/war/9/9']);
  });

  it('should skip a city-state capture when the captor is visible but unnamed', async () => {
    const result = await publish(evidence([
      event('CityCaptureComplete', 1, 9, 6, 10, { OldOwnerID: 10, NewOwnerID: 6, IsConquest: true }),
      event('CityCaptureComplete', 2, 9, 1, 11, { OldOwnerID: 11, NewOwnerID: 1, IsConquest: true }),
    ], [
      snapshot(0, 8, [relationship(1), relationship(6), relationship(10, 'peace', { ally: true }), relationship(11, 'peace', { ally: true })]),
      snapshot(6, 8, []),
      snapshot(10, 8, [], { majorAllyPlayerID: 0 }),
      snapshot(11, 8, [], { majorAllyPlayerID: 0 }),
    ]));

    expect(fired(result, 'ally-city-state-captured')).toEqual(['event/2']);
    expect(result.decision.triggerAudit.find(entry => entry.rule === 'ally-city-state-captured')?.subjects)
      .toContainEqual(expect.objectContaining({ subject: 'event/1', outcome: 'false' }));
  });

  it('should distinguish outgoing and incoming trade losses from our own plunder', async () => {
    const plunders = [[1, 0, 2], [1, 2, 0], [0, 2, 0], [1, 2, 3], [22, 0, 2]];
    const result = await publish(evidence(plunders.map(([plunderer, origin, destination], index) =>
      event('PlayerPlunderedTradeRoute', index + 1, 9, plunderer, origin, {
        PlunderingPlayerID: plunderer, OriginOwnerID: origin, DestinationOwnerID: destination,
      })), [snapshot(0, 10, [relationship(1), relationship(2), relationship(3)])]));
    expect(fired(result, 'our-trade-route-plundered')).toEqual(['event/1']);
    expect(fired(result, 'incoming-trade-route-plundered')).toEqual(['event/2']);
    expect(fired(result, 'we-plunder-foreign-trade-route')).toEqual(['event/3']);
    expectStory(result, 'our-trade-route-plundered', ['Brazil']);
    expectStory(result, 'incoming-trade-route-plundered', ['India', 'Brazil']);
    expectStory(result, 'we-plunder-foreign-trade-route', ['India']);
  });

  it.each([
    ['our-trade-route-plundered', 0, 2, 1],
    ['incoming-trade-route-plundered', 2, 0, 1],
    ['we-plunder-foreign-trade-route', 2, 1, 0],
    ['long-trade-route-completed', 0, 2, null],
    ['long-trade-route-completed', 2, 0, null],
  ] as const)('should expose ordered endpoints for %s (%i to %i)', async (rule, origin, destination, plunderer) => {
    const cities = { 0: home, 1: city(11, 8, 1, 'Salvador', 12), 2: city(12, 8, 2, 'Delhi', 35) };
    const from = cities[origin];
    const to = cities[destination];
    const endpoints = {
      OriginCityID: from.subjectID, OriginCityX: from.values.X, OriginCityY: from.values.Y,
      DestinationCityID: to.subjectID, DestinationCityX: to.values.X, DestinationCityY: to.values.Y,
    };
    const report = plunderer === null
      ? event('PlayerTradeRouteCompleted', 1, 9, origin, destination, { ...endpoints, OriginPlayerID: origin, DestinationPlayerID: destination })
      : event('PlayerPlunderedTradeRoute', 1, 9, plunderer, origin, { ...endpoints, PlunderingPlayerID: plunderer,
        OriginOwnerID: origin, DestinationOwnerID: destination });
    const result = await publish(evidence([report], [snapshot(0, 8, [relationship(1), relationship(2)])]), Object.values(cities));
    const match = result.decision.triggerAudit.find(entry => entry.rule === rule)?.subjects.find(subject => subject.subject === 'event/1');
    expect(match?.outcome).toBe('fired');
    expect(match?.expressions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'values.originCity', value: from.values.Name }),
      expect.objectContaining({ field: 'values.originCiv', value: context.playerNames![origin] }),
      expect.objectContaining({ field: 'values.destinationCity', value: to.values.Name }),
      expect.objectContaining({ field: 'values.destinationCiv', value: context.playerNames![destination] }),
    ]));
  });

  it('should report incoming open borders separately except when both grants are new', async () => {
    /** Represent one side granting or withholding access across its border. */
    const borders = (target: number, openBordersTo: boolean) => relationship(target, 'peace', { openBordersTo });
    const result = await publish(evidence([], [
      snapshot(0, 5, [borders(1, false), borders(2, false)]),
      snapshot(1, 5, [borders(0, false)]),
      snapshot(2, 5, [borders(0, false)]),
      snapshot(0, 10, [borders(1, false), borders(2, true)]),
      snapshot(1, 10, [borders(0, true)]),
      snapshot(2, 10, [borders(0, true)]),
    ]));
    expect(fired(result, 'open-borders-granted')).toEqual(['player/2']);
    expect(fired(result, 'open-borders-received')).toEqual(['player/1']);
  });

  it('should give a declaration and its vassal response one account, separate from an unrelated war', async () => {
    const result = await publish(evidence([
      event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }),
      event('DeclareWar', 2, 10, 3, 1, { IsAggressor: true }),
      event('DeclareWar', 3, 10, 5, 10, { IsAggressor: true }),
    ], [
      snapshot(0, 9, [relationship(1), relationship(3, 'peace', { vassal: 'voluntary' })]),
      snapshot(3, 9, [relationship(0, 'peace', { master: 'voluntary' })]),
      snapshot(5, 9, [relationship(10)]),
      snapshot(3, 10, [relationship(1, 'war', { warScore: 0 })]),
    ], 10, 9));
    expect(fired(result, 'vassals-join-war')).toEqual(['incident/war/10/1']);
    const related = result.state.issues[0].items.filter(item => item.seriesKeys.some(key => key.includes('incident/war/10/1')));
    expect(related).toHaveLength(1);
    expect(result.decision.diplomacyInference).toEqual(expect.arrayContaining([
      expect.objectContaining({ incidentId: 'war/10/1', participants: expect.arrayContaining([0, 1, 3]) }),
      expect.objectContaining({ incidentId: 'war/10/3', participants: [5, 10] }),
    ]));
  });

  it.each(['held', 'resumed'] as const)('should distinguish a stalled war advantage from one with %s movement', async trend => {
    const input = scores(Array.from({ length: 38 }, (_, offset): [number, number] => [
      13 + offset, offset === 0 ? 27 : trend === 'resumed' && offset === 36 ? 30 : 20,
    ]), 49);
    const result = await publish(input);
    expect(fired(result, 'war-advantage-stalls')).toEqual(trend === 'held' ? ['pair/0/1'] : []);
    if (trend === 'held') expectStory(result, 'war-advantage-stalls', ['Brazil']);
  });
});
