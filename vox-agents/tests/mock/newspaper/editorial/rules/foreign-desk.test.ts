import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { context, event, evidence, relationship, scores, snapshot } from '../../../../helpers/newspaper-diplomacy.js';

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
      snapshots: { cities: [...earlierCities, ...cities], players: input.players.map(row =>
        ({ ...row, source: { ...row.source, turn: 0, createdAt: 0 } })) },
      events: input.events, gaps: [],
    },
  };
  return runEditorialCheck({
    campaignId: 'fixture', timelineId: 'foreign-desk', receiver: { playerId: 0, label: 'France' },
    evidence: projected, facts: buildNewspaperFacts(projected, { playerIdentities }),
    config: await loadEditorialConfig(), context, speedMultiplier: 1, state: createInitialPublicationState(),
  });
}

/** Find a stock rule's account in the issue and verify the visible names made it into the story. */
function expectStory(result: Awaited<ReturnType<typeof publish>>, id: string, names: string[]) {
  const record = result.state.issues[0]?.items.find(item => item.templateIds.includes(`${id}-account`));
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

describe('stock foreign desk', () => {
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
  });

  it('should still report the capture when the capital itself has no readable city name', async () => {
    const result = await publish(evidence([
      event('CityCaptureComplete', 1, 9, 2, 1,
        { IsCapital: true, IsConquest: true, OldOwnerID: 1, NewOwnerID: 2, CityX: 4, CityY: 0 }),
    ], [snapshot(0, 8, [relationship(1), relationship(2)])]), [home]);
    expectStory(result, 'nearby-capital-falls', ['Brazil', 'India']);
  });

  it('should print the city name only once in the headline when the former owner shares its name', async () => {
    const result = await publish(evidence([
      event('CityCaptureComplete', 1, 9, 11, 10,
        { IsCapital: true, IsConquest: true, OldOwnerID: 10, NewOwnerID: 11, CityX: 4, CityY: 0 }),
    ], [snapshot(0, 8, [relationship(10), relationship(11)])]), [home, city(20, 10, 11, 'Geneva', 4)]);
    const item = expectStory(result, 'nearby-capital-falls', ['Geneva', 'Sidon']);
    expect(JSON.stringify(item.headline).match(/Geneva/g)).toHaveLength(1);
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
    expectStory(result, 'enemy-wonder-nearby', ['Petra', 'Sao Paulo', 'Brazil']);
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
    expectStory(result, 'vassals-join-war', ['France', 'Brazil', 'Iroquois']);
    const related = result.state.issues[0].items.filter(item => item.seriesKeys.some(key => key.includes('incident/war/10/1')));
    expect(related).toHaveLength(1);
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
