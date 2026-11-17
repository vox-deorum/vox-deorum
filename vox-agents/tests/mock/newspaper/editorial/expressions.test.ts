import { describe, expect, it } from 'vitest';
import { prepareTriggerExpressions } from '../../../../src/newspaper/editorial/config/expressions.js';
import {
  compileEditorialExpressions,
  type ExpressionBatch,
} from '../../../../src/newspaper/editorial/shared/expressions.js';

describe('newspaper expressions', () => {
  describe('catalogue preparation', () => {
    it('should reject duplicate rule IDs before assigning expression slots', async () => {
      await expect(
        prepareTriggerExpressions([
          { id: 'settler-departure', when: 'city.own' },
          { id: 'settler-departure', when: 'city.population > 10' },
        ])
      ).rejects.toThrow('settler-departure');
    });

    it.each([
      ['when[1]', { when: ['city.own', 'city.'] }, 'city.'],
      ['values.lost', { values: { lost: 'city.population -' } }, 'city.population -'],
      ['importance', { importance: '25; 50' }, '25; 50'],
      ['urgent', { urgent: 'true) || (false' }, 'true) || (false'],
      ['group.by', { group: { by: ')' } }, ')'],
    ] as const)(
      'should report the rule, field and source for invalid %s',
      async (field, change, source) => {
        const error = prepareTriggerExpressions([
          { id: 'settler-departure', when: 'city.own', ...change },
        ]);
        await expect(error).rejects.toThrow('settler-departure');
        await expect(error).rejects.toThrow(field);
        await expect(error).rejects.toThrow(source);
      }
    );

    it('should prepare a rule without reading any of the facts it expects at check time', async () => {
      const { runner, slots } = await prepareTriggerExpressions([
        {
          id: 'settler-departure',
          when: ['city.own', 'city.trained.some(event => settlers.includes(event.unit))'],
          values: { lost: 'city.before.population - city.population' },
          importance: '30 + 10 * lost',
          urgent: 'lost > 1',
          group: { by: 'city.owner.id' },
        },
      ]);
      const fields = slots.get('settler-departure')!;
      const results = await runner.evaluate({
        globals: { settlers: ['Settler', 'Pioneer'] },
        groups: [
          {
            expressions: [fields.when[1], fields.values.get('lost')!, fields.groupBy!],
            subjects: [
              {
                city: {
                  own: true,
                  population: 7,
                  before: { population: 9 },
                  trained: [{ unit: 'Pioneer' }],
                  owner: { id: 4 },
                },
              },
            ],
          },
          {
            expressions: [fields.importance!, fields.urgent!],
            subjects: [{ lost: 2 }],
          },
        ],
      });
      expect(results).toEqual([
        [[{ value: true }, { value: 2 }, { value: 4 }]],
        [[{ value: 50 }, { value: true }]],
      ]);
    });
  });

  describe('batched evaluation', () => {
    it.each([NaN, Infinity, -Infinity])(
      'should reject the nonfinite fact %s without treating it as null',
      async (value) => {
        const runner = await compileEditorialExpressions([
          { rule: 'growth', field: 'when', source: 'city.history[0].population === null' },
        ]);
        const check = (population: number | null) =>
          runner.evaluate({
            groups: [{ expressions: [0], subjects: [{ city: { history: [{ population }] } }] }],
          });
        await expect(check(value)).rejects.toThrow('population');
        await expect(check(null)).resolves.toEqual([[[{ value: true }]]]);
      }
    );

    it('should report a failed expression with its source and keep the other results', async () => {
      const missing = { rule: 'annexation', field: 'when[0]', source: 'city.before.isPuppet' };
      const runner = await compileEditorialExpressions([
        missing,
        { rule: 'annexation', field: 'when[1]', source: 'city.isOccupied' },
      ]);
      const results = await runner.evaluate({
        groups: [
          {
            expressions: [0, 1],
            subjects: [
              { city: { before: null, isOccupied: false } },
              { city: { before: { isPuppet: true }, isOccupied: true } },
            ],
          },
        ],
      });
      expect(results).toEqual([
        [
          [{ error: { ...missing, message: expect.any(String) } }, { value: false }],
          [{ value: true }, { value: true }],
        ],
      ]);
    });

    it('should expose only the supplied facts and deterministic JavaScript operations', async () => {
      const sources = [
        '[typeof Date, typeof performance, typeof Math.random, typeof fetch, typeof require, ' +
          'typeof process, typeof WeakRef, typeof setTimeout, typeof queueMicrotask, ' +
          'typeof editorialBatch, typeof beginExpression]' +
          '.every(type => type === "undefined")',
        'city.population = 99',
        'Math.abs = () => 99',
        'Math.abs(city.population - city.before.population)',
        'eval("42")',
        'Function("return 42")()',
      ];
      const runner = await compileEditorialExpressions(
        sources.map((source, index) => ({ rule: 'city-growth', field: `when[${index}]`, source }))
      );
      const batch: ExpressionBatch = {
        globals: { city: { population: 12, before: { population: 12 } } },
        groups: [
          {
            expressions: [0, 1, 2, 3, 4, 5],
            subjects: [{ city: { population: 4, before: { population: 6 } } }],
          },
        ],
      };
      const result = await runner.evaluate(batch);
      expect(result).toEqual([
        [
          [
            { value: true },
            { error: expect.objectContaining({ source: sources[1] }) },
            { error: expect.objectContaining({ source: sources[2] }) },
            { value: 2 },
            { error: expect.objectContaining({ source: sources[4] }) },
            { error: expect.objectContaining({ source: sources[5] }) },
          ],
        ],
      ]);
      expect(await runner.evaluate(batch)).toEqual(result);
    });

    it('should protect shared iterator and generator prototypes and allow normal iteration', async () => {
      const source = `[
        Object.getPrototypeOf([][Symbol.iterator]()),
        Object.getPrototypeOf(''[Symbol.iterator]()),
        Object.getPrototypeOf(new Map()[Symbol.iterator]()),
        Object.getPrototypeOf(new Set()[Symbol.iterator]()),
        Object.getPrototypeOf(''.matchAll(/./g)),
        Object.getPrototypeOf(Iterator.from([1]).map(value => value)),
        Object.getPrototypeOf(Iterator.from({ next: () => ({ done: true }) })),
        Object.getPrototypeOf(Object.getPrototypeOf((function* () {})())),
        Object.getPrototypeOf(function* () {}),
      ].every(Object.isFrozen) && [...(function* () { yield 3; })()][0] === 3`;
      const runner = await compileEditorialExpressions([
        { rule: 'iteration', field: 'when', source },
      ]);
      await expect(
        runner.evaluate({ groups: [{ expressions: [0], subjects: [{}] }] })
      ).resolves.toEqual([[[{ value: true }]]]);
    });

    it('should keep later results when an expression throws an error with an accessor message', async () => {
      const unusual = {
        rule: 'growth',
        field: 'values.note',
        source: `(() => {
          const error = new Error();
          Object.defineProperty(error, 'message', { get() { throw new Error('No message here'); } });
          throw error;
        })()`,
      };
      const ordinary = {
        rule: 'growth',
        field: 'values.reason',
        source: '(() => { throw new Error(reason); })()',
      };
      const runner = await compileEditorialExpressions([
        unusual,
        ordinary,
        { rule: 'growth', field: 'when', source: 'population > 0' },
      ]);
      const reason = 'Population was not sampled';
      const result = await runner.evaluate({
        groups: [{ expressions: [0, 1, 2], subjects: [{ population: 8, reason }] }],
      });
      expect(result).toEqual([
        [
          [
            { error: { ...unusual, message: expect.any(String) } },
            { error: { ...ordinary, message: reason } },
            { value: true },
          ],
        ],
      ]);
    });

    it('should skip a runaway expression for later subjects while continuing healthy work', async () => {
      const runaway = {
        rule: 'growth',
        field: 'values.population',
        source: 'city.stalled ? (() => { while (true) {} })() : city.population',
      };
      const runner = await compileEditorialExpressions([
        { rule: 'growth', field: 'when', source: 'city.population > 0' },
        runaway,
        { rule: 'growth', field: 'importance', source: 'city.population + 40' },
      ]);
      const result = await runner.evaluate({
        groups: [
          {
            expressions: [0, 1, 2],
            subjects: Array.from({ length: 25 }, (_, index) => ({
              city: { stalled: index > 0, population: index + 5 },
            })),
          },
          {
            expressions: [1, 2],
            subjects: [{ city: { stalled: false, population: 8 } }],
          },
        ],
      });
      const interruption = { error: { ...runaway, message: expect.any(String) } };
      const skipped = { error: { ...runaway, message: expect.any(String), skipped: true } };
      expect(result).toEqual([
        [
          [{ value: true }, { value: 5 }, { value: 45 }],
          [{ value: true }, interruption, { value: 46 }],
          ...Array.from({ length: 23 }, (_, index) => [
            { value: true },
            skipped,
            { value: 47 + index },
          ]),
        ],
        [[skipped, { value: 48 }]],
      ]);
      await expect(
        runner.evaluate({
          groups: [{ expressions: [1], subjects: [{ city: { stalled: false, population: 8 } }] }],
        })
      ).resolves.toEqual([[[{ value: 8 }]]]);
    });
  });
});
