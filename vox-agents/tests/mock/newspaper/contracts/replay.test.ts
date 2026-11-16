import { describe, expect, it, vi } from 'vitest';
import { replaySettingsSchema, replayEvidenceResponseSchema } from '../../../../src/newspaper/contracts/replay.js';
import { replaySettings } from '../../../helpers/newspaper-replay.js';

/** Build an envelope whose evidence includes falsy values and row references. */
function response() {
  return {
    session: {
      settings: replaySettingsSchema.parse(replaySettings('recording.db')),
      speed: { multiplier: 1, source: 'assumedStandard', recordedName: null, label: 'Standard assumption' },
      publicationIntervalTurns: 5, comparisonTurns: 5,
      cursor: { cutoffTurn: 10, previousCheckTurn: 9, finished: false },
    },
    evidence: {
      request: { receiverPlayerID: 0, cutoffTurn: 10, previousCheckTurn: 9 },
      players: [{ subjectID: 0, source: { table: 'PlayerSummaries', id: 3, turn: 10, createdAt: 1010 }, values: { Gold: 0, FoundedReligion: null } }],
      cities: [], comparisons: { players: [], cities: [] },
      events: [{ source: { table: 'GameEvents', id: 102, turn: 10, createdAt: 2010 }, type: 'TeamSetHasTech', values: { HasTech: false } }],
    },
  };
}

describe('replay contracts', () => {
  it('should validate serialized evidence with the MCP contract and preserve zero, false, null and absent fields', () => {
    const value = JSON.parse(JSON.stringify(response()));
    expect(replayEvidenceResponseSchema.parse(value)).toEqual(value);
    value.evidence.players[0].source.table = 'UnrelatedTable';
    expect(replayEvidenceResponseSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    { fromTurn: 20, toTurn: 10 }, { receiverPlayerID: 22 }, { publicationInterval: 0 },
    { comparisonTurns: -1 }, { speedMultiplierOverride: 0 }, { speedMultiplierOverride: Infinity },
    { databasePath: '   ' }, { durationUnit: 'years' },
  ])('should reject invalid replay settings %j', change => {
    expect(replaySettingsSchema.safeParse({ ...replaySettings('recording.db'), ...change }).success).toBe(false);
  });

  it('should reject evidence windows that fail MCP cutoff rules', () => {
    const value = response();
    value.evidence.request.previousCheckTurn = 11;
    expect(replayEvidenceResponseSchema.safeParse(value).success).toBe(false);
  });

  it('should import contracts without database, server, query or rendering runtime', async () => {
    vi.resetModules();
    vi.doMock('kysely', () => { throw new Error('database runtime imported'); });
    vi.doMock('../../../../src/newspaper/replay/session.js', () => { throw new Error('session runtime imported'); });
    vi.doMock('../../../../../mcp-server/dist/newspaper/queries.js', () => { throw new Error('query runtime imported'); });
    try {
      const contracts = await import('../../../../src/newspaper/contracts/replay.js');
      expect(contracts.replayEvidenceResponseSchema.parse(response())).toEqual(response());
    } finally {
      vi.doUnmock('kysely');
      vi.doUnmock('../../../../src/newspaper/replay/session.js');
      vi.doUnmock('../../../../../mcp-server/dist/newspaper/queries.js');
    }
  });
});
