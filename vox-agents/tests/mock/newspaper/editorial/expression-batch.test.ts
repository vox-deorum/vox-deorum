import { describe, expect, it } from 'vitest';
import {
  compileEditorialExpressions,
  type ExpressionBatch,
} from '../../../../src/newspaper/editorial/shared/expressions.js';

/** Vary comparisons over present and past snapshots, distance, trade and lists of events. */
function representativeExpression(index: number): string {
  const threshold = Math.floor(index / 5);
  switch (index % 5) {
    case 0:
      return `city.own && city.population - city.before.population > ${threshold}`;
    case 1:
      return `city.distance.own <= ${threshold} && city.before.isPuppet && city.isOccupied`;
    case 2:
      return `city.population >= ${threshold} && city.trained.some(t => settlers.includes(t.unit))`;
    case 3:
      return `city.history.filter(s => s.foodPerTurn > ${threshold}).length >= 3`;
    default:
      return `city.owner.id !== self.id && city.owner.netTradeGold > ${threshold}`;
  }
}

/** Supply 100 cities with player, distance, training, and comparison facts. */
function representativeBatch(): ExpressionBatch {
  const subjects = Array.from({ length: 100 }, (_, id) => ({
    city: {
      id,
      name: `City ${id}`,
      own: id % 6 === 0,
      population: 8 + (id % 15),
      isOccupied: id % 7 === 0,
      distance: { own: id % 11, capital: id % 20 },
      owner: { id: id % 6, name: `Player ${id % 6}`, netTradeGold: id % 25 },
      before: { population: 6 + (id % 15), isPuppet: id % 5 === 0 },
      history: Array.from({ length: 5 }, (_, offset) => ({
        turn: 125 - offset,
        population: 8 + (id % 15) - offset,
        foodPerTurn: 5 + (id % 30) - offset,
      })),
      trained: [{ unit: id % 3 === 0 ? 'Pioneer' : 'Warrior' }, { unit: 'Catapult' }],
    },
  }));
  return {
    globals: { self: { id: 0 }, settlers: ['Settler', 'Pioneer', 'Colonist'] },
    groups: [{ expressions: Array.from({ length: 200 }, (_, index) => index), subjects }],
  };
}

describe('newspaper expression check workload', () => {
  it('should evaluate 200 expressions for 100 subjects in one batch', async () => {
    const batch = representativeBatch();
    const expressions = batch.groups[0].expressions.map((index) => ({
      rule: `sample-${index}`,
      field: 'when',
      source: representativeExpression(index),
    }));
    const start = performance.now();
    const runner = await compileEditorialExpressions(expressions);
    const compiled = performance.now();
    const [cities] = await runner.evaluate(batch);
    const coldEnd = performance.now();

    expect(cities).toHaveLength(100);
    expect(
      cities.every((city) => city.length === 200 && city.every((item) => 'value' in item))
    ).toBe(true);
    expect(cities[0].slice(0, 5)).toEqual([
      { value: true },
      { value: true },
      { value: true },
      { value: true },
      { value: false },
    ]);
    expect(cities[1].slice(0, 5)).toEqual([
      { value: false },
      { value: false },
      { value: false },
      { value: true },
      { value: true },
    ]);

    if (process.env.VD_EXPRESSION_BENCHMARK === '1') {
      const warm = [];
      for (let index = 0; index < 5; index++) {
        const before = performance.now();
        await runner.evaluate(batch);
        warm.push((performance.now() - before).toFixed(1));
      }
      console.info(
        `200 × 100: cold compile ${(compiled - start).toFixed(1)} ms, ` +
          `first check ${(coldEnd - compiled).toFixed(1)} ms, warm checks ${warm.join(', ')} ms`
      );
    }
  });
});
