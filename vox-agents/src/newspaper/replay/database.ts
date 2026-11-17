import { openReadonlyGameDb } from '../../knowledge/database.js';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

/** Open an existing recording without schema setup; the replay session owns its destruction. */
export async function openReplayDatabase(databasePath: string) {
  const db = openReadonlyGameDb(databasePath);
  if (!db) throw new Error(`Could not open replay recording: ${databasePath}`);
  // Initialize Kysely's lazy driver without SQL so destroy() closes even an unused source.
  await db.connection().execute(async () => undefined);
  return db;
}

/** Bind durable runs to the recording's bytes, independent of its current filename. */
export async function replaySourceIdentity(databasePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(databasePath)) hash.update(chunk);
  return hash.digest('hex');
}

/** Recover only recorded identities needed to interpret team and ownership references. */
export async function readReplayIdentities(db: Awaited<ReturnType<typeof openReplayDatabase>>, receiverPlayerID: number) {
  const players = await db.selectFrom('PlayerInformations').select(['Key', 'TeamID', 'Civilization', 'IsMajor']).execute();
  const receiver = players.find(player => player.Key === receiverPlayerID);
  return {
    receiverTeamId: receiver?.TeamID ?? undefined,
    receiverOwnerName: receiver?.Civilization ?? undefined,
    civilization: receiver?.Civilization ?? undefined,
    playerNames: Object.fromEntries(players.filter(player => player.Civilization).map(player => [String(player.Key), player.Civilization!])),
    playerTeamIds: Object.fromEntries(players.filter(player => player.TeamID !== null).map(player => [String(player.Key), player.TeamID!])),
    majorPlayerIds: players.filter(player => player.IsMajor === 1).map(player => player.Key),
  };
}
