/** Check the compact offline checkpoint and its supported format. */
import { describe, expect, it } from 'vitest';
import { createInitialPublicationState, publicationStateSchema } from '../../../../src/newspaper/contracts/publication.js';

describe('publication memory', () => {
  it('should create current memory without accumulating audit decisions', () => {
    const state = createInitialPublicationState();
    expect(state.schemaVersion).toBe(4);
    expect(state).not.toHaveProperty('decisions');
    expect(publicationStateSchema.parse(state)).toEqual(state);
  });

  it('should retain current memory with the cursor, votes, preferences and series', () => {
    const state = createInitialPublicationState({ frequencyStandardTurns: 3, llmEnabled: true });
    state.lastCheckTurn = 25;
    state.previousDesignId = 'modern';
    state.votes['published-item'] = 1;
    state.series['city/3/growth'] = { importance: 20, evaluatedTurn: 25, lastPublishedTurn: 20, lastIssueId: 'old-issue', lastItemId: 'published-item' };
    expect(publicationStateSchema.parse(state)).toEqual(state);
  });

  it.each([1, 2, 3, 99])('should reject unsupported memory version %s', schemaVersion => {
    expect(publicationStateSchema.safeParse({ ...createInitialPublicationState(), schemaVersion }).success).toBe(false);
  });
});
