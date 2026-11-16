import { describe, expect, it, vi } from 'vitest';
import { archiveListSchema, archiveVoteRequestSchema } from '../../../../src/newspaper/contracts/archive.js';
import { replayPreferencesRequestSchema, replaySettingsSchema } from '../../../../src/newspaper/contracts/replay.js';
import { replaySettings } from '../../../helpers/newspaper-replay.js';

describe('offline archive contracts', () => {
  it('should require a receiving run scope and a replaceable numeric vote', () => {
    const vote = { runId: 'branch-a', receiverPlayerID: 7, itemId: 'article', value: 1 };
    expect(archiveVoteRequestSchema.parse(vote)).toEqual(vote);
    expect(archiveVoteRequestSchema.safeParse({ ...vote, value: 2 }).success).toBe(false);
    expect(archiveVoteRequestSchema.safeParse({ ...vote, runId: undefined }).success).toBe(false);
    expect(replayPreferencesRequestSchema.safeParse({ runId: 'branch-a', receiverPlayerID: 7, frequencyStandardTurns: 3, llmEnabled: false }).success).toBe(true);
  });

  it('should distinguish explicit resume and fresh comparison branch settings', () => {
    const settings = replaySettings('source.db');
    expect(replaySettingsSchema.safeParse({ ...settings, mode: 'resume' }).success).toBe(false);
    expect(replaySettingsSchema.safeParse({ ...settings, mode: 'branch' }).success).toBe(false);
    expect(replaySettingsSchema.safeParse({ ...settings, mode: 'resume', runId: 'existing' }).success).toBe(true);
    expect(replaySettingsSchema.safeParse({ ...settings, mode: 'branch', branchFromRunId: 'baseline', runId: 'comparison' }).success).toBe(true);
  });

  it('should import archive contracts without database, editor, or server implementations', async () => {
    vi.resetModules();
    vi.doMock('better-sqlite3', () => { throw new Error('database runtime imported'); });
    vi.doMock('../../../../src/newspaper/replay/session.js', () => { throw new Error('server runtime imported'); });
    try {
      const contracts = await import('../../../../src/newspaper/contracts/archive.js');
      expect(contracts.archiveListSchema.parse({ issues: [] })).toEqual({ issues: [] });
      expect(archiveListSchema.safeParse({ issues: [{ issueId: 'one', runId: 'a', receiverPlayerID: 0, cutoffTurn: 1, title: 'Paper', itemCount: 1 }] }).success).toBe(true);
    } finally {
      vi.doUnmock('better-sqlite3');
      vi.doUnmock('../../../../src/newspaper/replay/session.js');
    }
  });
});
