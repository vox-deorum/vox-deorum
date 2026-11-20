import { sql, type Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../knowledge/schema/base.js';
import type {
  NewspaperCongressEvidence, NewspaperCongressObservation, NewspaperCongressProposal, NewspaperCongressResolution
} from './evidence.js';

/** Recorded row fields needed to project one public Congress observation. */
interface CongressRow {
  ID: number;
  Turn: number;
  CreatedAt: number;
  DiplomaticVictory: unknown;
}

/** Status text the game writes when the league is known but not yet available to observe. */
const lockedStatuses = new Set([
  'Not yet unlocked',
  'Unlocked in Atomic or Information eras'
]);

/** Keep plain objects separate from arrays and other JSON values. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the league label and session timing from the recorded status string. */
function parseSession(status: string): { league: string; votingNow: boolean; countdown?: number } | undefined {
  const match = /^(.*?) - Voting (Now|in (\d+) turns?)$/.exec(status.trim());
  if (!match) return undefined;
  const league = match[1].trim();
  if (match[2] === 'Now') return { league, votingNow: true };
  const countdown = Number(match[3]);
  if (!Number.isInteger(countdown) || countdown < 0) return undefined;
  return { league, votingNow: false, countdown };
}

/** Project one recorded proposal without its direction prefix. */
function projectProposal(key: string, value: unknown): NewspaperCongressProposal | undefined {
  if (!isRecord(value)) return undefined;
  const match = /^(Enact|Repeal): (.+)$/.exec(key);
  if (!match) return undefined;
  const name = match[2].trim();
  if (!name) return undefined;
  return {
    name,
    isEnact: match[1] === 'Enact',
    ...(typeof value.Proposer === 'string' && value.Proposer !== 'Unknown' ? { proposer: value.Proposer } : {}),
    ...(typeof value.Description === 'string' ? { description: value.Description } : {})
  };
}

/** Project one active resolution while keeping a date that may predate the observation. */
function projectResolution(key: string, value: unknown, observedTurn: number): NewspaperCongressResolution | undefined {
  if (!isRecord(value)) return undefined;
  const name = key.trim();
  if (!name) return undefined;
  const enacted = value.EnactedOn;
  return {
    name,
    ...(typeof value.Description === 'string' ? { description: value.Description } : {}),
    ...(typeof enacted === 'number' && Number.isInteger(enacted) && enacted > 0 && enacted <= observedTurn
      ? { enactedTurn: enacted } : {})
  };
}

/** Project readable entries, keeping a recorded empty agenda distinct from a missing one. */
function projectEntries<T>(
  value: unknown, project: (key: string, entry: unknown) => T | undefined
): T[] | undefined {
  if (!isRecord(value)) return undefined;
  const entries: T[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const projected = project(key, entry);
    if (projected !== undefined) entries.push(projected);
  }
  return entries;
}

/** Project one public Congress observation, skipping a row without a readable status. */
function projectCongressObservation(row: CongressRow): NewspaperCongressObservation | undefined {
  const source = { table: 'VictoryProgress' as const, id: row.ID, turn: row.Turn, createdAt: row.CreatedAt };
  const recorded = row.DiplomaticVictory;
  if (typeof recorded === 'string') {
    if (!lockedStatuses.has(recorded.trim())) return undefined;
    return { source, available: false, votingNow: false, proposals: [], activeResolutions: [] };
  }
  if (!isRecord(recorded) || typeof recorded.Status !== 'string') return undefined;
  const session = parseSession(recorded.Status);
  if (!session) return undefined;
  const votes = recorded.VotesNeeded;
  const proposals = projectEntries(recorded.Proposals, projectProposal);
  const activeResolutions = projectEntries(recorded.ActiveResolutions, (name, value) => projectResolution(name, value, row.Turn));
  return {
    source,
    available: true,
    ...(session.league ? { league: session.league } : {}),
    votingNow: session.votingNow,
    ...(session.countdown !== undefined ? { expectedSessionTurn: row.Turn + session.countdown } : {}),
    ...(typeof votes === 'number' && Number.isInteger(votes) ? { diplomaticVictoryVotesNeeded: votes } : {}),
    ...(proposals ? { proposals } : {}),
    ...(activeResolutions ? { activeResolutions } : {})
  };
}

/** Read the public Congress baseline and window without visibility flags or writes. */
export async function readCongressEvidence(
  db: Kysely<KnowledgeDatabase>, previousCheckTurn: number, cutoffTurn: number
): Promise<NewspaperCongressEvidence | undefined> {
  const columns = await sql<{ name: string }>`select name from pragma_table_info('VictoryProgress')`.execute(db);
  const required = ['ID', 'Key', 'Turn', 'CreatedAt', 'DiplomaticVictory'];
  if (!required.every(name => columns.rows.some(column => column.name === name))) return undefined;

  const baselineRows = db.selectFrom('VictoryProgress')
    .select(['ID', 'Turn', 'CreatedAt', 'DiplomaticVictory'])
    .where('Key', '=', 0).where('Turn', '<=', previousCheckTurn)
    .orderBy('Turn', 'desc').orderBy('ID', 'desc').stream();
  let baseline: NewspaperCongressObservation | undefined;
  // A malformed final row cannot hide an earlier usable snapshot before the window.
  for await (const row of baselineRows) {
    baseline = projectCongressObservation(row);
    if (baseline) break;
  }

  const finalRowPerTurn = sql<number>`(select max(ID) from VictoryProgress
    where "Key" = 0 and Turn > ${previousCheckTurn} and Turn <= ${cutoffTurn} group by Turn)`;
  const rows = await db.selectFrom('VictoryProgress')
    .select(['ID', 'Turn', 'CreatedAt', 'DiplomaticVictory'])
    .where('ID', 'in', finalRowPerTurn).orderBy('Turn').orderBy('ID').execute();
  const observations = rows.flatMap(row => {
    const observation = projectCongressObservation(row);
    return observation ? [observation] : [];
  });

  if (!baseline && !observations.length) return undefined;
  return { ...(baseline ? { baseline } : {}), observations };
}
