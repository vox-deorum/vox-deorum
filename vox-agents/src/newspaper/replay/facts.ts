import type { Kysely } from 'kysely';
import type { KnowledgeDatabase } from '../../../../mcp-server/dist/knowledge/schema/base.js';
import type { NewspaperEvidenceRequest } from '../../../../mcp-server/dist/newspaper/evidence.js';
import { queryNewspaperEvidence } from '../../../../mcp-server/dist/newspaper/queries.js';
import { buildNewspaperFacts } from '../editorial/facts/index.js';

type ReplayFactSpans = { longTurns: number; historyTurns?: number; speedMultiplier?: number };

/** Select the same permitted history for publication and evidence inspection. */
export function replayFactRequest(
  request: Omit<NewspaperEvidenceRequest, 'historyFromTurn'>,
  { longTurns, historyTurns = longTurns }: ReplayFactSpans,
): NewspaperEvidenceRequest {
  if (!Number.isSafeInteger(longTurns) || longTurns < 1 || !Number.isSafeInteger(historyTurns) || historyTurns < longTurns)
    throw new RangeError('Fact history must cover the long span in whole recorded turns.');
  return {
    ...request, historyFromTurn: Math.max(-1, request.cutoffTurn - historyTurns),
  };
}

/** Read a check's permitted history and the recording metadata needed by its fact builders. */
export async function readReplayFacts(
  db: Kysely<KnowledgeDatabase>,
  request: Omit<NewspaperEvidenceRequest, 'historyFromTurn'>,
  spans: ReplayFactSpans,
  query = queryNewspaperEvidence,
) {
  const evidence = await query(db, replayFactRequest(request, spans));
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
  const facts = buildNewspaperFacts(evidence, {
    playerIdentities: Object.fromEntries(identities.map(row => [row.Key, {
      name: row.Civilization, leader: row.Leader, teamId: row.TeamID,
      major: row.IsMajor === 1 ? true : row.IsMajor === 0 ? false : undefined,
      human: row.IsHuman === 1 ? true : row.IsHuman === 0 ? false : undefined,
    }])),
    recordingStartTurn: Number.isFinite(recordingStartTurn) ? recordingStartTurn : undefined,
    gameSpeed: metadata.get('gameSpeed'),
    speedMultiplier: spans.speedMultiplier,
    mapSize: metadata.get('mapSize'), startEra: metadata.get('startEra'), maxTurns: recordedNumber(metadata.get('maxTurns')),
    mapWidth: metadata.get('mapWidth'), mapHeight: metadata.get('mapHeight'),
    mapWrapX: metadata.get('mapWrapX'), mapWrapY: metadata.get('mapWrapY'),
  }, { longTurns: spans.longTurns });
  return { evidence, facts };
}

/** Decode a whole recorded count without turning empty metadata into zero. */
function recordedNumber(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

