import { sql, type Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../knowledge/schema/base.js';
import type { NewspaperTechnology } from './evidence.js';

/** Keep a recorded technology name, rejecting unresolved IDs and the game's empty sentinel. */
export function namedTechnology(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name && name.toLowerCase() !== 'none' ? name : undefined;
}

/** Read only the receiving team's named technology changes, including those before the report window. */
export async function readReceiverTechnologies(
  db: Kysely<KnowledgeDatabase>, teamID: number | undefined, cutoffTurn: number
): Promise<NewspaperTechnology[]> {
  if (teamID === undefined || teamID < 0) return [];
  const rows = await db.selectFrom('GameEvents').select(['ID', 'Turn', 'CreatedAt', 'Payload'])
    .where('Type', '=', 'TeamTechResearched')
    .where(sql<number>`json_extract(Payload, '$.TeamID')`, '=', teamID)
    .where('Turn', '<=', cutoffTurn)
    .orderBy('Turn', 'desc').orderBy('ID', 'desc').execute();
  const latest = new Map<string, NewspaperTechnology>();
  for (const row of rows) {
    const name = namedTechnology(row.Payload.TechID);
    const change = row.Payload.ChangeAmount;
    if (!name || latest.has(name) || typeof change !== 'number' || !Number.isFinite(change) || change === 0) continue;
    latest.set(name, {
      source: { table: 'GameEvents', id: row.ID, turn: row.Turn, createdAt: row.CreatedAt },
      name, gained: change > 0
    });
  }
  return [...latest.values()];
}
