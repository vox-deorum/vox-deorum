import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { compileEditorialExpressions } from '../../../../src/newspaper/editorial/shared/expressions.js';
import { reference } from '../../../../src/newspaper/editorial/facts/model.js';
import { openReplayDatabase } from '../../../../src/newspaper/replay/database.js';
import { readReplayFacts } from '../../../../src/newspaper/replay/facts.js';
import { createReplayRecording } from '../../../helpers/newspaper-replay.js';

describe('facts from a replay recording', () => {
  it('should evaluate Congress rules on recorded agendas and public vote results', async () => {
    const recording = await createReplayRecording();
    try {
      const sqlite = new Database(recording.filename);
      try {
        const snapshot = sqlite.prepare(`INSERT INTO VictoryProgress (ID, Key, Turn, Payload,
          DominationVictory, ScienceVictory, CulturalVictory, DiplomaticVictory)
          VALUES (?, 0, ?, '{}', 'Not available', 'Not available', 'Not available', ?)`);
        snapshot.run(201, 5, JSON.stringify({ Status: 'World Congress - Voting in 10 turns', Proposals: {} }));
        snapshot.run(202, 10, JSON.stringify({
          Status: 'World Congress - Voting in 5 turns', Proposals: { 'Enact: World Religion': { Proposer: 'Civ1' } },
        }));
        sqlite.prepare(`INSERT INTO GameEvents (ID, Turn, Type, Payload) VALUES (?, ?, ?, ?)`)
          .run(205, 10, 'ResolutionResult', JSON.stringify({
            ProposerPlayerID: 1, ProposerPlayer: { Civilization: 'Civ1' },
            ResolutionType: 'Scholars in Residence', IsEnact: true, Passed: false,
          }));
      } finally { sqlite.close(); }
      const db = await openReplayDatabase(recording.filename);
      try {
        const { facts } = await readReplayFacts(db, { receiverPlayerID: 0, previousCheckTurn: 9, cutoffTurn: 10 },
          { longTurns: 6, historyTurns: 8 });
        const runner = await compileEditorialExpressions([
          'game.congress.expectedSessionTurn === 15 && game.congress.newProposals.some(proposal => proposal.isEnact && proposal.name === "World Religion")',
          'events.some(event => event.type === "ResolutionResult" && event.passed === false && event.proposerName === "Civ1")',
        ].map(source => ({ rule: 'congress', field: 'when', source })));
        const [[[agenda, result]]] = await runner.evaluate({ facts, groups: [{ expressions: [0, 1], subjects: [{}] }] });
        expect(agenda).toMatchObject({ value: true, sources: expect.arrayContaining([
          expect.objectContaining({ table: 'VictoryProgress', id: 201 }),
          expect.objectContaining({ table: 'VictoryProgress', id: 202 }),
        ]) });
        expect(result).toMatchObject({ value: true, sources: expect.arrayContaining([
          expect.objectContaining({ table: 'GameEvents', id: 205 }),
        ]) });
      } finally { await db.destroy(); }
    } finally { await recording.cleanup(); }
  });

  it('should report a new diplomat at cutoff and read policy names without one', async () => {
    const recording = await createReplayRecording();
    try {
      const sqlite = new Database(recording.filename);
      try {
        sqlite.exec(`
          UPDATE CityInformations SET IsCapital = 1 WHERE ID = 21;
          UPDATE PlayerSummaries SET PolicyBranches = '{"Tradition":["Aristocracy"]}' WHERE ID = 6;
          UPDATE PlayerSummaries SET Spies = '{"Agent":{"Role":"Diplomat","Location":"Port (Civ1)","State":"Schmoozing","Network":200}}' WHERE ID = 3;
        `);
      } finally { sqlite.close(); }
      const db = await openReplayDatabase(recording.filename);
      try {
        const { facts } = await readReplayFacts(db, { receiverPlayerID: 0, previousCheckTurn: 9, cutoffTurn: 10 },
          { longTurns: 6 });
        const foreign = facts.players[1];
        expect(foreign.current?.ourDiplomatThere?.value).toBe(true);
        expect(foreign.current?.policyBranches?.value).toMatchObject({ Tradition: { value: ['Aristocracy'] } });
        // Before the diplomat arrived, the visible player's policies are still readable by name.
        const earlier = foreign.history.find(row => row.turn === 5)?.fields?.policyBranches?.value as
          Record<string, { value: unknown }> | undefined;
        expect(Array.isArray(earlier?.Tradition?.value)).toBe(true);
        const runner = await compileEditorialExpressions([
          { rule: 'recording', field: 'when', source: 'player.history.length' },
        ]);
        const [[[observations]]] = await runner.evaluate({ facts, groups: [{
          expressions: [0], subjects: [{ player: reference('player', 1) }], windowFromTurn: 4,
        }] });
        expect(observations).toMatchObject({ value: 1 });
      } finally { await db.destroy(); }
    } finally { await recording.cleanup(); }
  });

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
