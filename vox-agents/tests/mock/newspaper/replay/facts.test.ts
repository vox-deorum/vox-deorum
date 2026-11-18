import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { compileEditorialExpressions } from '../../../../src/newspaper/editorial/shared/expressions.js';
import { openReplayDatabase } from '../../../../src/newspaper/replay/database.js';
import { readReplayFacts } from '../../../../src/newspaper/replay/facts.js';
import { createReplayRecording } from '../../../helpers/newspaper-replay.js';

describe('facts from a replay recording', () => {
  it('should read only met identities, use private wrap settings for distances, and keep event windows separate', async () => {
    const recording = await createReplayRecording();
    try {
      const sqlite = new Database(recording.filename);
      try {
        sqlite.exec(`
          INSERT INTO PlayerInformations (Key, TeamID, IsMajor, Civilization, Leader, IsHuman)
            VALUES (2, 2, 1, 'Hidden', 'Hidden Leader', 1);
          INSERT INTO GameMetadata VALUES ('mapSize','Standard'), ('mapWidth','10'), ('mapHeight','8'),
            ('mapWrapX','true'), ('mapWrapY','false'), ('maxTurns','0');
        `);
      } finally { sqlite.close(); }
      const db = await openReplayDatabase(recording.filename);
      try {
        const { facts } = await readReplayFacts(db, {receiverPlayerID: 0, previousCheckTurn: 9, cutoffTurn: 10},
          {longTurns: 5, historyTurns: 8});
        const expressions = [
          'players.map(p => p.name).join(",")', 'self.leader', 'game.speedMultiplier', 'game.maxTurns',
          'distance({x: 0, y: 4}, {x: 9, y: 4})', 'game.mapWidth', 'events.map(e => e.type).join(",")',
        ];
        const runner = await compileEditorialExpressions(expressions.map(source => ({rule: 'recording', field: 'when', source})));
        const [[current], [longer]] = await runner.evaluate({facts, groups: [
          {subjects: [{}], expressions: expressions.map((_, i) => i)},
          {subjects: [{}], expressions: [6], windowFromTurn: 2},
        ]});
        expect(current.slice(0, 5)).toMatchObject([
          {value: 'Civ0,Civ1'}, {value: 'Leader0'}, {value: 1.5}, {value: 0}, {value: 1},
        ]);
        expect(current[5]).toHaveProperty('error');
        expect(current[6]).toMatchObject({value: 'TeamSetHasTech'});
        expect(longer[0]).toMatchObject({value: 'DeclareWar,TeamSetHasTech'});
      } finally { await db.destroy(); }
    } finally { await recording.cleanup(); }
  });
});
