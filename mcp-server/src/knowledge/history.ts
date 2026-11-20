import { expressionBuilder, sql, type Expression, type Kysely, type Selectable, type SqlBool } from 'kysely';
import type { KnowledgeDatabase } from './schema/base.js';
import { isAfter, isAtTurn, isBeforeOrAt, isVisible } from './expressions.js';

/** Filters shared with the live event tool, with optional inclusive turn bounds. */
export interface EventReadOptions {
  Turn?: number;
  Type?: string;
  After?: number;
  Before?: number;
  PlayerID?: number;
  FromTurn?: number;
  ToTurn?: number;
}

/** World Congress outcomes are public regardless of legacy visibility flags. */
export const resolutionResultEventType = 'ResolutionResult';

/** Widen a receiver's event read to public types, so historic rows need no rewrite. */
export function isVisibleOrPublic(playerID: number): Expression<SqlBool> {
  const eb = expressionBuilder<KnowledgeDatabase, 'GameEvents'>();
  return eb.or([isVisible(playerID), eb('Type', '=', resolutionResultEventType)]);
}

/** Read events without formatting, consolidation, refresh, or connection ownership. */
export async function readEvents(db: Kysely<KnowledgeDatabase>, options: EventReadOptions = {}) {
  let query = db.selectFrom('GameEvents').selectAll();
  if (options.Turn !== undefined) query = query.where(isAtTurn(options.Turn));
  if (options.After !== undefined) query = query.where(isAfter(options.After));
  if (options.Before !== undefined) query = query.where(isBeforeOrAt(options.Before));
  if (options.Type !== undefined) query = query.where('Type', '=', options.Type);
  if (options.PlayerID !== undefined) query = query.where(isVisibleOrPublic(options.PlayerID));
  if (options.FromTurn !== undefined) query = query.where('Turn', '>=', options.FromTurn);
  if (options.ToTurn !== undefined) query = query.where('Turn', '<=', options.ToTurn);
  return query.orderBy('ID').execute();
}

/** Read the current IsLatest row while leaving failed-read refresh to the caller. */
export async function readMutableKnowledge<T extends keyof KnowledgeDatabase>(
  db: Kysely<KnowledgeDatabase>, table: T, key: number, playerID?: number
): Promise<Selectable<KnowledgeDatabase[T]> | undefined> {
  let query = (db.selectFrom(table).selectAll() as any).where('Key', '=', key).where('IsLatest', '=', 1);
  if (playerID !== undefined) query = query.where(`Player${playerID}`, '>', 0);
  return query.executeTakeFirst();
}

/** Read existing store history in descending Version order, optionally filtering row access. */
export async function readMutableKnowledgeHistory<T extends keyof KnowledgeDatabase>(
  db: Kysely<KnowledgeDatabase>, table: T, key: number, playerID?: number
): Promise<Selectable<KnowledgeDatabase[T]>[]> {
  let query = (db.selectFrom(table).selectAll() as any).where('Key', '=', key).orderBy('Version', 'desc');
  if (playerID !== undefined) query = query.where(`Player${playerID}`, '>', 0);
  return query.execute();
}

/** Snapshot tables used by newspaper reporting. */
export type EvidenceSnapshotTable = 'PlayerSummaries' | 'CityInformations';

/** Select each subject's final row by turn then insertion ID, before applying permissions. */
export async function readSnapshotsAtCutoff<T extends EvidenceSnapshotTable>(
  db: Kysely<KnowledgeDatabase>, table: T, cutoffTurn: number
): Promise<Selectable<KnowledgeDatabase[T]>[]> {
  const ids = sql<number>`(select ID from (
    select ID, row_number() over (partition by "Key" order by Turn desc, ID desc) as position
    from ${sql.table(table)} where Turn <= ${cutoffTurn}
  ) where position = 1)`;
  return (db.selectFrom(table).selectAll() as any).where('ID', 'in', ids).orderBy('Key').execute();
}

/** Read bounded comparison versions, retaining only the final insertion for each subject and turn. */
export async function readSnapshotRange<T extends EvidenceSnapshotTable>(
  db: Kysely<KnowledgeDatabase>, table: T, fromTurn: number, toTurn: number
): Promise<Selectable<KnowledgeDatabase[T]>[]> {
  const ids = sql<number>`(select max(ID) from ${sql.table(table)}
    where Turn >= ${fromTurn} and Turn <= ${toTurn} group by "Key", Turn)`;
  return (db.selectFrom(table).selectAll() as any).where('ID', 'in', ids).orderBy('Turn').orderBy('ID').execute();
}
