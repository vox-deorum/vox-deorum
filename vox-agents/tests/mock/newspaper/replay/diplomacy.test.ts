import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { createReplayRecording, replaySettings } from '../../../helpers/newspaper-replay.js';

describe('diplomacy rules in offline replay', () => {
  it('should preserve the score history and repeat audit on resume after a skipped check', async () => {
    const recording = await createReplayRecording('Standard');
    const directory = path.dirname(recording.filename);
    const catalogue = path.join(directory, 'diplomacy-catalogue');
    let session = new ReplaySession();
    try {
      const sqlite = new Database(recording.filename);
      try {
        const insert = sqlite.prepare(`INSERT INTO PlayerSummaries
          (ID, Key, Turn, CreatedAt, Player0, Relationships, Gold, CulturePerTurn, Era, FoundedReligion,
           Resources, DiplomatPoints, OutgoingTradeRoutes, PolicyBranches, Payload, Cities, Population, GoldPerTurn, Technologies)
          SELECT ?, Key, ?, ?, Player0, ?, Gold, CulturePerTurn, Era, FoundedReligion,
                 Resources, DiplomatPoints, OutgoingTradeRoutes, PolicyBranches, Payload, Cities, Population, GoldPerTurn, Technologies
          FROM PlayerSummaries WHERE ID = 1`);
        for (let turn = 7; turn <= 54; turn++) {
          const score = turn === 15 ? 28 : turn >= 40 ? 20 : 10;
          insert.run(400 + turn, turn, 8000 + turn,
            JSON.stringify({ Civ1: [`War (Our Score: ${score}%; Our War Weariness: 0%)`] }));
        }
      } finally { sqlite.close(); }
      await mkdir(catalogue);
      await writeFile(path.join(catalogue, 'defaults.json'), JSON.stringify({ minItems: 1 }));
      const base = await loadEditorialConfig();
      const stalledRule = 'war-advantage-stalls';
      await writeFile(path.join(catalogue, 'triggers.json'), JSON.stringify([
        ...base.triggers.filter(rule => rule.id !== stalledRule).map(rule => ({ id: rule.id, enabled: false })),
        { id: 'wide-war-window', subject: 'pair', window: 45, when: 'false' },
      ]));
      const settings = {
        ...replaySettings(recording.filename), fromTurn: 46, toTurn: 54,
        frequencyStandardTurns: 4, editorialConfigDirectory: catalogue, runId: 'first',
        outputPath: path.join(directory, 'diplomacy.sqlite'),
      };
      await session.configure(settings);
      const skipped = await session.advance();
      expect(skipped.check?.status).toBe('skipped');
      expect(skipped.check?.decision.triggerAudit.find(rule => rule.rule === stalledRule)?.subjects)
        .toMatchObject([{ subject: 'pair/0/1', outcome: 'false', failedWhen: 2 }]);
      const uninterrupted = await session.advance();
      expect(uninterrupted.check?.status).toBe('published');
      const stalled = uninterrupted.check?.decision.triggerAudit.find(rule => rule.rule === stalledRule);
      expect(uninterrupted.evidence.request).toMatchObject({ cutoffTurn: 50, historyFromTurn: 5 });
      expect(stalled).toMatchObject({ windowFromTurn: 10, subjects: [{
        subject: 'pair/0/1', outcome: 'fired', repeat: { lastTurn: 50, armed: false },
        sources: expect.arrayContaining([expect.objectContaining({ id: 415, turn: 15 })]),
      }] });
      const continued = await session.advance();
      expect(continued.check?.decision.triggerAudit.find(rule => rule.rule === stalledRule)?.subjects)
        .toMatchObject([{ subject: 'pair/0/1', outcome: 'repeat', repeat: { lastTurn: 50, armed: false } }]);

      const resumeSettings = { ...settings, runId: 'resumed' };
      await session.configure(resumeSettings);
      await session.advance();
      await session.close();
      session = new ReplaySession();
      await session.configure({ ...resumeSettings, mode: 'resume' });
      const resumed = await session.advance();
      expect(resumed.check?.decision.triggerAudit).toEqual(uninterrupted.check?.decision.triggerAudit);
      expect(resumed.check?.decision.diplomacyInference).toEqual(uninterrupted.check?.decision.diplomacyInference);
      await session.close();
      session = new ReplaySession();
      await session.configure({ ...resumeSettings, mode: 'resume' });
      const repeated = await session.advance();
      expect(repeated.check?.decision.triggerAudit).toEqual(continued.check?.decision.triggerAudit);
    } finally {
      await session.close();
      await recording.cleanup();
    }
  });
});
