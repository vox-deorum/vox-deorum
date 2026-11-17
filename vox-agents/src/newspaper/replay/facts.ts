import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../../../mcp-server/dist/knowledge/schema/base.js';
import type { NewspaperEvidenceRequest } from '../../../../mcp-server/dist/newspaper/evidence.js';
import { queryNewspaperEvidence } from '../../../../mcp-server/dist/newspaper/queries.js';
import { buildNewspaperFacts } from '../editorial/facts/index.js';

/** Read a check's permitted history and the recording metadata needed by its fact builders. */
export async function readReplayFacts(
  db: Kysely<KnowledgeDatabase>,
  request: Pick<NewspaperEvidenceRequest, 'receiverPlayerID' | 'previousCheckTurn' | 'cutoffTurn'>,
  spans: { longTurns: number; longestWindowTurns?: number },
) {
  const {longTurns, longestWindowTurns = 0} = spans;
  if (!Number.isSafeInteger(longTurns) || longTurns < 1 || !Number.isSafeInteger(longestWindowTurns) || longestWindowTurns < 0)
    throw new RangeError('Fact history spans must be whole recorded turns and longTurns must be positive.');
  const window = Math.max(longTurns, longestWindowTurns);
  const evidence = await queryNewspaperEvidence(db, {
    ...request, historyFromTurn: Math.max(-1, request.cutoffTurn - window),
  });
  // Static identities may label a dated observation, but cannot establish contact on their own.
  const ids = [...new Set([...evidence.players, ...evidence.history!.baseline.players,
    ...evidence.history!.snapshots.players].map(row => row.subjectID))];
  const receiverColumn = `Player${request.receiverPlayerID}` as keyof KnowledgeDatabase['PlayerSummaries'] & `Player${number}`;
  const [identities, settings, firstCity, firstSummary] = await Promise.all([
    ids.length ? db.selectFrom('PlayerInformations')
      .select(['Key', 'TeamID', 'Civilization', 'IsMajor', 'IsHuman', 'Leader']).where('Key', 'in', ids).execute() : [],
    db.selectFrom('GameMetadata').select(['Key', 'Value']).where('Key', 'in',
      ['gameSpeed', 'mapSize', 'startEra', 'maxTurns', 'mapWidth', 'mapHeight', 'mapWrapX', 'mapWrapY']).execute(),
    db.selectFrom('CityInformations').select(eb => eb.fn.min('Turn').as('turn'))
      .where(receiverColumn, 'in', [1, 2]).where('Turn', '<=', request.cutoffTurn).executeTakeFirst(),
    db.selectFrom('PlayerSummaries').select(eb => eb.fn.min('Turn').as('turn')).where(receiverColumn, 'in', [1, 2])
      .where('Turn', '<=', request.cutoffTurn).executeTakeFirst(),
  ]);
  const metadata = new Map(settings.map(row => [row.Key, row.Value]));
  const recordingStartTurn = Math.min(firstCity?.turn ?? Infinity, firstSummary?.turn ?? Infinity);
  return buildNewspaperFacts(evidence, {
    playerIdentities: Object.fromEntries(identities.map(row => [row.Key, {
      name: row.Civilization, leader: row.Leader, teamId: row.TeamID,
      major: row.IsMajor === 1 ? true : row.IsMajor === 0 ? false : undefined,
      human: row.IsHuman === 1 ? true : row.IsHuman === 0 ? false : undefined,
    }])),
    recordingStartTurn: Number.isFinite(recordingStartTurn) ? recordingStartTurn : undefined,
    gameSpeed: metadata.get('gameSpeed'),
    mapSize: metadata.get('mapSize'), startEra: metadata.get('startEra'), maxTurns: recordedNumber(metadata.get('maxTurns')),
    mapWidth: metadata.get('mapWidth'), mapHeight: metadata.get('mapHeight'),
    mapWrapX: metadata.get('mapWrapX'), mapWrapY: metadata.get('mapWrapY'),
  }, { longTurns });
}

/** Decode a whole recorded count without turning empty metadata into zero. */
function recordedNumber(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

