/**
 * Shared knowledge-database tables for tests that read a game's players and outcome.
 */

import type Database from 'better-sqlite3';

/** Create PlayerInformations and GameMetadata with Rome (player 0) as a major civ that won a Science victory. */
export function seedKnowledgePlayers(db: Database.Database): void {
  db.exec(`
    CREATE TABLE PlayerInformations (
      ID INTEGER PRIMARY KEY, Key INTEGER, Civilization TEXT, Leader TEXT,
      IsMajor INTEGER, IsHuman INTEGER, TeamID INTEGER, Data TEXT
    );
    CREATE TABLE GameMetadata (Key TEXT PRIMARY KEY, Value TEXT);
  `);
  db.prepare(`INSERT INTO PlayerInformations
    (ID, Key, Civilization, Leader, IsMajor, IsHuman, TeamID, Data)
    VALUES (1, 0, 'Rome', 'Augustus', 1, 0, 0, '{}')`).run();
  db.prepare('INSERT INTO GameMetadata (Key, Value) VALUES (?, ?), (?, ?)').run(
    'victoryPlayerID', '0', 'victoryType', 'Science'
  );
}
