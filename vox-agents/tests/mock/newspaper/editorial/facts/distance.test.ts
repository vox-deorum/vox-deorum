import { describe, expect, it } from 'vitest';
import type {
  NewspaperEvent, NewspaperEvidence, NewspaperSnapshot,
} from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { reference, type FactMetadata, type FactReference } from '../../../../../src/newspaper/editorial/facts/model.js';
import { compileEditorialExpressions } from '../../../../../src/newspaper/editorial/shared/expressions.js';

/** Record a visible city observation at one plot. */
function city(id: number, turn: number, x: number, y: number, owner: number, key = id): NewspaperSnapshot {
  return {
    subjectID: key, source: { table: 'CityInformations', id, turn, createdAt: 10 * turn + 5 },
    values: { OwnerID: owner, X: x, Y: y, IsCapital: 1 },
  };
}

/** Record a visible player observation at a contact date. */
function player(id: number, turn = 0): NewspaperSnapshot {
  return { subjectID: id, source: { table: 'PlayerSummaries', id: 100 * turn + id + 1, turn, createdAt: 10 * turn }, values: {} };
}

/** Record a permitted event with a projected plot. */
function event(id: number, turn: number, values: NewspaperEvent['values']): NewspaperEvent {
  return { source: { table: 'GameEvents', id, turn, createdAt: 10 * turn + 8 }, type: 'PlayerCityFounded', values };
}

/** Build one cutoff fact model with reporting period (5, 10]. */
function facts(
  cities: NewspaperSnapshot[],
  players: NewspaperSnapshot[],
  events: NewspaperEvent[] = [],
  metadata: FactMetadata = {},
): ReturnType<typeof buildNewspaperFacts> {
  const evidence: NewspaperEvidence = {
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10, historyFromTurn: -1 },
    cities,
    players,
    events: events.filter(row => row.source.turn > 5),
    comparisons: { players: [], cities: [] },
    history: {
      fromTurn: -1,
      baseline: { players: [], cities: [] },
      snapshots: { players, cities },
      gaps: [],
      events,
    },
  };
  return buildNewspaperFacts(evidence, { recordingStartTurn: 0, ...metadata });
}

/** Evaluate distance expressions over one subject binding. */
async function evaluate(
  model: ReturnType<typeof buildNewspaperFacts>,
  expressions: string[],
  subjects: Record<string, FactReference>,
) {
  const runner = await compileEditorialExpressions(expressions.map((source, index) => ({
    rule: 'distance', field: `values.${index}`, source,
  })));
  const [[results]] = await runner.evaluate({
    facts: model,
    groups: [{ expressions: expressions.map((_, index) => index), subjects: [subjects] }],
  });
  return results;
}

describe('newspaper distance expressions', () => {
  const home = city(10, 0, 0, 2, 0);
  const farHome = city(11, 0, 10, 2, 0);
  const rival = city(20, 9, 13, 2, 1);
  const nearRival = city(21, 9, 4, 2, 1);
  const oldRival = player(1, 2);
  const currentRival = player(1, 9);

  it('should use the minimum pair of cutoff city plots with both ownership rows cited', async () => {
    const model = facts([home, farHome, rival, nearRival], [player(0), currentRival]);
    const [forward, reverse] = await evaluate(model, ['distance(rival, self)', 'distance(self, rival)'],
      { rival: reference('player', 1) });

    expect(forward).toMatchObject({ value: 3 });
    expect(forward.sources).toEqual(expect.arrayContaining([farHome.source, rival.source]));
    expect(reverse).toMatchObject({ value: 3 });
    expect(reverse.sources).toEqual(expect.arrayContaining([farHome.source, rival.source]));
  });

  it('should combine player, city, plot, and event operands', async () => {
    const founded = event(100, 8, { PlayerID: 1, PlotX: 8, PlotY: 2 });
    const model = facts([home, farHome, rival, nearRival], [player(0), currentRival], [founded]);
    const [cityDistance, plotDistance, eventDistance, ownDistance] = await evaluate(model, [
      'distance(city, rival)',
      'distance({ x: 10, y: 2 }, rival)',
      'distance(founded, rival)',
      'distance(city, self)',
    ], { city: reference('city', 10), founded: reference('event', 100), rival: reference('player', 1) });

    expect(cityDistance).toMatchObject({ value: 4 });
    expect(plotDistance).toMatchObject({ value: 3 });
    expect(eventDistance).toMatchObject({ value: 4 });
    expect(ownDistance).toMatchObject({ value: 0 });
  });

  it('should use cutoff cities for a dated player operand', async () => {
    const model = facts([home, farHome, rival, nearRival], [player(0), oldRival, currentRival]);
    const [dated] = await evaluate(model, ['distance(rival.before, self)'], { rival: reference('player', 1) });

    expect(dated).toMatchObject({ value: 3 });
    expect(dated.sources).toEqual(expect.arrayContaining([farHome.source, rival.source]));
  });

  it('should apply map wrapping to the nearest periodic plot', async () => {
    const wrapped = facts([city(10, 0, 0, 2, 0), city(20, 9, 9, 2, 1)], [player(0), player(1)],
      [], { mapWidth: 10, mapHeight: 10, mapWrapX: true, mapWrapY: false });
    const flat = facts([city(10, 0, 0, 2, 0), city(20, 9, 9, 2, 1)], [player(0), player(1)],
      [], { mapWidth: 10, mapHeight: 10, mapWrapX: false, mapWrapY: false });
    const [acrossWrap] = await evaluate(wrapped, ['distance(self, rival)'], { rival: reference('player', 1) });
    const [acrossMap] = await evaluate(flat, ['distance(self, rival)'], { rival: reference('player', 1) });

    expect(acrossWrap).toMatchObject({ value: 1 });
    expect(acrossMap).toMatchObject({ value: 9 });
  });

  it('should hide distance when a player has no cutoff city coordinates', async () => {
    const model = facts([home, farHome, rival], [player(0), currentRival, player(2)]);
    const [unavailable] = await evaluate(model, ['distance(minor, self)'], { minor: reference('player', 2) });

    expect(unavailable).toMatchObject({ error: { hidden: 'distance' } });
  });
});
