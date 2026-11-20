import { sql, type Kysely, type Selectable } from 'kysely';
import type { KnowledgeDatabase } from '../knowledge/schema/base.js';
import type { PlayerInformation } from '../knowledge/schema/public.js';
import type { NewspaperCulturalInfluenceObservation } from './evidence.js';

/** Recorded row fields needed to project one public cultural influence observation. */
export interface CulturalInfluenceRow {
  ID: number;
  Turn: number;
  CreatedAt: number;
  CulturalVictory: unknown;
}

type Reading = NewspaperCulturalInfluenceObservation['readings'][number];
type ParsedReading = Omit<Reading, 'otherPlayerID' | 'direction'>;
type Level = Reading['level'];
type Trend = NonNullable<Reading['trend']>;

const levels = new Set<Level>(['Exotic', 'Familiar', 'Popular', 'Influential', 'Dominant']);
const simpleTrend = /^(Falling|Static|Rising Slowly) \(tourism\/culture ratio (-?\d+)%\)$/;
const risingWithEta = /^Rising \((\d+) turns to Influential, tourism\/culture ratio (-?\d+)%\)$/;
const risingOnly = /^Rising \(tourism\/culture ratio (-?\d+)%\)$/;

/** Keep plain objects separate from arrays and other JSON values. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the level, percentage and optional trend from one recorded influence string. */
function parseReading(value: unknown): ParsedReading | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(Exotic|Familiar|Popular|Influential|Dominant) \((\d+)%\) - (.*)$/.exec(value);
  if (!match || !levels.has(match[1] as Level)) return undefined;
  const percentage = Number(match[2]);
  if (!Number.isSafeInteger(percentage) || percentage < 0) return undefined;

  const trendText = match[3]!.trim();
  if (!trendText) return { level: match[1] as Level, percentage };

  let trend = simpleTrend.exec(trendText);
  if (trend) {
    const ratio = Number(trend[2]);
    if (!Number.isSafeInteger(ratio)) return undefined;
    return {
      level: match[1] as Level, percentage, trend: trend[1] as Trend, tourismCultureRatio: ratio
    };
  }

  trend = risingWithEta.exec(trendText);
  if (trend) {
    const turns = Number(trend[1]);
    const ratio = Number(trend[2]);
    if (!Number.isSafeInteger(turns) || turns < 0 || !Number.isSafeInteger(ratio)) return undefined;
    return {
      level: match[1] as Level, percentage, trend: 'Rising', turnsToInfluential: turns, tourismCultureRatio: ratio
    };
  }

  trend = risingOnly.exec(trendText);
  if (trend) {
    const ratio = Number(trend[1]);
    if (!Number.isSafeInteger(ratio)) return undefined;
    return { level: match[1] as Level, percentage, trend: 'Rising', tourismCultureRatio: ratio };
  }

  // An unfamiliar trend cannot be dropped while keeping the rest of the reading as if it were complete.
  return undefined;
}

/** Read the latest global row before the window and the final row from each turn inside it. */
export async function readCulturalInfluenceRows(
  db: Kysely<KnowledgeDatabase>, previousCheckTurn: number, cutoffTurn: number
): Promise<CulturalInfluenceRow[] | undefined> {
  const columns = await sql<{ name: string }>`select name from pragma_table_info('VictoryProgress')`.execute(db);
  const required = ['ID', 'Key', 'Turn', 'CreatedAt', 'CulturalVictory'];
  if (!required.every(name => columns.rows.some(column => column.name === name))) return undefined;

  const baseline = await db.selectFrom('VictoryProgress')
    .select(['ID', 'Turn', 'CreatedAt', 'CulturalVictory'])
    .where('Key', '=', 0).where('Turn', '<=', previousCheckTurn)
    .orderBy('Turn', 'desc').orderBy('ID', 'desc').limit(1).executeTakeFirst();

  const finalRowPerTurn = sql<number>`(select max(ID) from VictoryProgress
    where "Key" = 0 and Turn > ${previousCheckTurn} and Turn <= ${cutoffTurn} group by Turn)`;
  const rows = await db.selectFrom('VictoryProgress')
    .select(['ID', 'Turn', 'CreatedAt', 'CulturalVictory'])
    .where('ID', 'in', finalRowPerTurn).orderBy('Turn').orderBy('ID').execute();

  // A status or malformed row stays in place so later comparisons cannot bridge over it.
  if (!baseline && !rows.length) return undefined;
  return [...(baseline ? [baseline] : []), ...rows];
}

/** Project the readings that involve the receiver and a uniquely resolved, known major. */
export function projectCulturalInfluence(
  row: CulturalInfluenceRow,
  receiverId: number,
  players: readonly Selectable<PlayerInformation>[],
  isKnown: (playerID: number) => boolean
): NewspaperCulturalInfluenceObservation {
  const source = { table: 'VictoryProgress' as const, id: row.ID, turn: row.Turn, createdAt: row.CreatedAt };
  const readings: Reading[] = [];
  const recorded = row.CulturalVictory;
  if (!isRecord(recorded)) return { source, readings };

  // Resolve every major label before applying contact, so a duplicate name cannot select a known player.
  const labels = new Map<string, number[]>();
  for (const player of players) {
    if (player.IsMajor !== 1 || typeof player.Civilization !== 'string') continue;
    const ids = labels.get(player.Civilization);
    if (ids) ids.push(player.Key);
    else labels.set(player.Civilization, [player.Key]);
  }

  const receiver = players.find(player => player.Key === receiverId && player.IsMajor === 1);
  if (!receiver || typeof receiver.Civilization !== 'string' || labels.get(receiver.Civilization)?.length !== 1)
    return { source, readings };

  const receiverBlock = recorded[receiver.Civilization];
  const outgoing = isRecord(receiverBlock) && isRecord(receiverBlock.Influences) ? receiverBlock.Influences : undefined;

  for (const [label, ids] of labels) {
    if (ids.length !== 1) continue;
    const otherPlayerID = ids[0]!;
    if (otherPlayerID === receiverId || !isKnown(otherPlayerID)) continue;

    const outward = outgoing && Object.hasOwn(outgoing, label) ? parseReading(outgoing[label]) : undefined;
    if (outward) readings.push({ otherPlayerID, direction: 'outgoing', ...outward });

    const otherBlock = recorded[label];
    const inward = isRecord(otherBlock) && isRecord(otherBlock.Influences) && Object.hasOwn(otherBlock.Influences, receiver.Civilization)
      ? parseReading(otherBlock.Influences[receiver.Civilization]) : undefined;
    if (inward) readings.push({ otherPlayerID, direction: 'incoming', ...inward });
  }

  readings.sort((a, b) => a.otherPlayerID - b.otherPlayerID ||
    (a.direction === 'outgoing' ? 0 : 1) - (b.direction === 'outgoing' ? 0 : 1));
  return { source, readings };
}
