import { openReadonlyGameDb } from '../../knowledge/database.js';

/** Open an existing recording without schema setup; the replay session owns its destruction. */
export async function openReplayDatabase(databasePath: string) {
  const db = openReadonlyGameDb(databasePath);
  if (!db) throw new Error(`Could not open replay recording: ${databasePath}`);
  // Initialize Kysely's lazy driver without SQL so destroy() closes even an unused source.
  await db.connection().execute(async () => undefined);
  return db;
}
