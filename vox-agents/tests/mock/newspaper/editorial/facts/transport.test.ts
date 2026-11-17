import { describe, expect, it } from 'vitest';
import type { NewspaperSourceReference } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import type { NewspaperFactModel } from '../../../../../src/newspaper/editorial/facts/index.js';
import { fact, reference, windowFacts, type FactObject } from '../../../../../src/newspaper/editorial/facts/model.js';
import { packNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/transport.js';
import { compileEditorialExpressions } from '../../../../../src/newspaper/editorial/shared/expressions.js';

const player = { table: 'PlayerSummaries', id: 3, turn: 4, createdAt: 779 } as const;
const earlier = { table: 'PlayerSummaries', id: 2, turn: 1, createdAt: 775 } as const;
const recordedEvent = { table: 'GameEvents', id: 4500001, turn: 4, createdAt: 780 } as const;

/** Preserve a passed source array under each field to exercise citation reuse after packing. */
function playerFields(source: NewspaperSourceReference): FactObject {
  return {
    id: fact(7, [{ ...source }]),
    score: fact(20, [{ ...source }]),
    sources: fact(['Recorded', { sources: fact(4, [{ ...source }]) }], [{ ...source }]),
  };
}

/** Build just enough data to pass recorded fields, a gap and joined citations through QuickJS. */
function model(): NewspaperFactModel {
  return {
    turn: 4, previous: 2, earliestWindowTurn: 0, earliestSnapshotTurn: 0, longTurns: 4,
    receiverId: 7, game: {}, subjects: { player: [7], event: [recordedEvent.id], city: [] },
    players: {
      7: {
        current: {
          ...playerFields(player),
          events: windowFacts([{ turn: 4, field: fact(reference('event', recordedEvent.id), [recordedEvent, player]) }], [player]),
        },
        history: [
          { turn: 1, segment: 0, fields: playerFields(earlier), sources: [earlier] },
          { turn: 2 },
          { turn: 4, segment: 0, fields: playerFields(player), sources: [player] },
        ],
      },
    },
    cities: {},
    events: [{ id: recordedEvent.id, turn: 4, fields: { type: fact('CityTrained', [recordedEvent]) }, sources: [recordedEvent] }],
  };
}

describe('newspaper fact transport', () => {
  describe('QuickJS wire', () => {
    it('should share repeated citations without editing the input model', () => {
      const facts = model();
      const original = JSON.stringify(facts);
      const packed = packNewspaperFacts(facts);

      expect(JSON.stringify(facts)).toBe(original);
      expect(packed.sources).toHaveLength(3);
      expect(packed.sourceLists).toHaveLength(4);
      expect(JSON.stringify(packed)).toEqual(JSON.stringify(packNewspaperFacts(facts)));
      expect(JSON.stringify(packed).length).toBeLessThan(original.length);
    });

    it('should keep recorded field names, source order and hidden gaps through lazy reads', async () => {
      const expressions = ['self.sources[1].sources', 'self.events[0].type', 'self.previous.score', 'self.at(3).score'];
      const runner = await compileEditorialExpressions(expressions.map(source => ({ rule: 'wire', field: 'values.fact', source })));
      const [[results]] = await runner.evaluate({
        facts: model(),
        groups: [{ subjects: [{}], expressions: [0, 1, 2, 3] }],
      });

      expect(results).toEqual([
        { value: 4, sources: [player] },
        { value: 'CityTrained', sources: [player, recordedEvent] },
        { error: expect.objectContaining({ hidden: 'player.previous' }) },
        { value: 20, sources: [earlier] },
      ]);
    });
  });
});
