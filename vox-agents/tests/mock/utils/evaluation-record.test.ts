/**
 * Tests for the evaluation labeler (src/utils/models/evaluation-record.ts): one labeled entry per
 * recorded question, in question order, joining recorded questions, answers, and confidence.
 */
import { describe, expect, it } from 'vitest';
import { labelEvaluation } from '../../../src/utils/models/evaluation-record.js';

describe('labelEvaluation', () => {
  describe('score questions', () => {
    it('should label every level in criteria order and read missing probabilities as zero', () => {
      const entries = labelEvaluation(
        { pace: { type: 'score', instructions: 'How fast should the empire grow?', criteria: ['1: slowly', '5: steadily', '10: fast'] } },
        { pace: { score: 4.2, probabilities: { '2': 0.7, '3': 0.3 } } },
      );

      expect(entries).toHaveLength(1);
      const [entry] = entries;
      expect(entry).toMatchObject({
        id: 'pace', type: 'score', instructions: 'How fast should the empire grow?', answered: true, score: 4.2,
      });
      // Probability key '3' has no criterion, so only the criteria order survives.
      expect(entry.probabilities).toEqual([
        { option: '1: slowly', probability: 0 },
        { option: '5: steadily', probability: 0 },
        { option: '10: fast', probability: 0.7 },
      ]);
    });
  });

  describe('choice questions', () => {
    it('should list options by descending probability and leave out zero-probability options', () => {
      const [entry] = labelEvaluation(
        { research: { type: 'choice', instructions: 'Which technology next?', criteria: { Pottery: 'Pottery', Wheel: 'The wheel' } } },
        { research: { choice: 'Wheel', probabilities: { Pottery: 0.2, Wheel: 0.7, Calendar: 0 } } },
      );

      expect(entry).toMatchObject({ id: 'research', type: 'choice', answered: true, choice: 'Wheel' });
      expect(entry.probabilities).toEqual([
        { option: 'Wheel', probability: 0.7 },
        { option: 'Pottery', probability: 0.2 },
      ]);
    });
  });

  describe('boolean questions', () => {
    it('should carry the probability of true without labeled options', () => {
      const [entry] = labelEvaluation(
        { at_war: { type: 'boolean', instructions: 'Is Greece about to declare war?' } },
        { at_war: { probability: 0.8 } },
      );

      expect(entry).toMatchObject({ id: 'at_war', type: 'boolean', answered: true, probability: 0.8 });
      expect(entry.probabilities).toEqual([]);
    });

    it('should treat a question of an unknown type as boolean', () => {
      const [entry] = labelEvaluation({ odd: { type: 'ranked' } }, { odd: { probability: 0.25 } });

      expect(entry).toMatchObject({ type: 'boolean', answered: true, probability: 0.25 });
      expect(entry.probabilities).toEqual([]);
    });
  });

  describe('unanswered questions', () => {
    it('should mark questions with no answer and keep question order', () => {
      const entries = labelEvaluation(
        {
          a: { type: 'score', criteria: ['1: low', '10: high'] },
          b: { type: 'choice', criteria: { X: 'X' } },
        },
        { a: undefined },
      );

      expect(entries.map(entry => entry.id)).toEqual(['a', 'b']);
      // A score still lists its levels, each at zero; a choice has nothing to list.
      expect(entries[0]).toMatchObject({ answered: false });
      expect(entries[0].probabilities).toEqual([
        { option: '1: low', probability: 0 },
        { option: '10: high', probability: 0 },
      ]);
      expect(entries[0]).not.toHaveProperty('score');
      expect(entries[1]).toMatchObject({ answered: false });
      expect(entries[1].probabilities).toEqual([]);
      expect(entries[1]).not.toHaveProperty('choice');
    });
  });

  describe('confidence', () => {
    it('should attach confidence only to the questions that have one', () => {
      const entries = labelEvaluation(
        { a: { type: 'boolean' }, b: { type: 'boolean' } },
        { a: { probability: 0.5 } },
        { a: 0.9 },
      );

      expect(entries[0]).toMatchObject({ id: 'a', answered: true, confidence: 0.9 });
      expect(entries[1]).not.toHaveProperty('confidence');
    });
  });
});
