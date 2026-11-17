import type { Kysely, Selectable } from 'kysely';
import type { KnowledgeDatabase } from '../knowledge/schema/base.js';
import type { CityInformation, GameEvent } from '../knowledge/schema/timed.js';
import { isVisible } from '../knowledge/expressions.js';
import { readEvents, readSnapshotRange, readSnapshotsAtCutoff } from '../knowledge/history.js';
import { newspaperEvidenceRequestSchema, type NewspaperEvidence, type NewspaperEvidenceRequest } from './evidence.js';
import { projectNewspaperCity, projectNewspaperDiplomacy, projectNewspaperEvent, projectNewspaperPlayer, type NewspaperProjectionContext } from './projection.js';

/** Read permitted dated evidence through a caller-owned connection, without refresh or schema changes. */
export async function queryNewspaperEvidence(
  db: Kysely<KnowledgeDatabase>, input: NewspaperEvidenceRequest
): Promise<NewspaperEvidence> {
  const request = newspaperEvidenceRequestSchema.parse(input);
  const fromTurn = Math.min(request.previousCheckTurn + 1, request.comparisonRange?.fromTurn ?? request.cutoffTurn, request.cutoffTurn);
  const [players, baseSummaries, summaryHistory, cities, events, earlierCities, lifecycle] = await Promise.all([
    db.selectFrom('PlayerInformations').selectAll().execute(),
    readSnapshotsAtCutoff(db, 'PlayerSummaries', fromTurn - 1),
    readSnapshotRange(db, 'PlayerSummaries', fromTurn, request.cutoffTurn),
    readSnapshotsAtCutoff(db, 'CityInformations', request.cutoffTurn),
    readEvents(db, { PlayerID: request.receiverPlayerID, FromTurn: request.previousCheckTurn + 1, ToTurn: request.cutoffTurn }),
    request.comparisonRange ? readSnapshotRange(db, 'CityInformations', request.comparisonRange.fromTurn, request.comparisonRange.toTurn) : [],
    db.selectFrom('GameEvents').selectAll().where('Type', 'in', ['CityRazed', 'CityCaptureComplete'])
      .where('Turn', '<=', request.cutoffTurn).where(isVisible(request.receiverPlayerID)).execute()
  ]);
  const contexts = new Map<number, NewspaperProjectionContext>();
  const latest = new Map(baseSummaries.map(row => [row.Key, row]));
  const turns = [...new Set([request.cutoffTurn, ...summaryHistory.map(row => row.Turn), ...events.map(row => row.Turn)])].sort((a, b) => a - b);
  let position = 0;
  for (const turn of turns) {
    while (position < summaryHistory.length && summaryHistory[position].Turn <= turn) {
      const row = summaryHistory[position++];
      latest.set(row.Key, row);
    }
    contexts.set(turn, { receiverPlayerID: request.receiverPlayerID, players,
      summaries: [...latest.values()].sort((a, b) => a.Key - b.Key) });
  }
  const cutoffContext = contexts.get(request.cutoffTurn)!;
  const summaries = cutoffContext.summaries;
  // Stale national facts still use permission records from their own observation turn.
  const staleTurns = [...new Set(baseSummaries.map(row => row.Turn))];
  await Promise.all(staleTurns.map(
    /** Resolve the original permission context for a national observation predating the window. */
    async turn => {
      contexts.set(turn, { receiverPlayerID: request.receiverPlayerID, players,
        summaries: await readSnapshotsAtCutoff(db, 'PlayerSummaries', turn) });
    }));
  const comparisonRange = request.comparisonRange;
  const earlierPlayers = comparisonRange ? summaryHistory.filter(row =>
    row.Turn >= comparisonRange.fromTurn && row.Turn <= comparisonRange.toTurn) : [];

  const result: NewspaperEvidence = { request, players: [], cities: [], comparisons: { players: [], cities: [] }, events: [],
    diplomacy: { fromTurn, baseline: [], history: [], gaps: [] } };
  for (const [rows, target] of [[baseSummaries, result.diplomacy!.baseline], [summaryHistory, result.diplomacy!.history]] as const) {
    for (const row of rows) {
      const projected = projectNewspaperDiplomacy(row, contexts.get(row.Turn)!, result.diplomacy!.gaps);
      if (projected) target.push(projected);
    }
  }
  for (const [rows, target] of [[summaries, result.players], [earlierPlayers, result.comparisons.players]] as const) {
    for (const row of rows) {
      const projected = projectNewspaperPlayer(row, contexts.get(row.Turn)!);
      if (projected) target.push(projected);
    }
  }
  for (const [rows, target] of [[cities, result.cities], [earlierCities, result.comparisons.cities]] as const) {
    for (const row of rows) {
      const projected = projectNewspaperCity(row, cutoffContext);
      if (projected && target === result.cities && retiredCity(row, lifecycle, result)) continue;
      if (projected) target.push(projected);
    }
  }
  for (const row of events) {
    const projected = projectNewspaperEvent(row, contexts.get(row.Turn)!);
    if (projected) result.events.push(projected);
  }
  return result;
}

/** Retire observed city rows only when coordinates and recorded ordering establish a later removal. */
function retiredCity(row: Selectable<CityInformation>, events: Selectable<GameEvent>[], result: NewspaperEvidence): boolean {
  for (const event of events) {
    if (event.Turn < row.Turn) continue;
    const payload = event.Payload;
    if (typeof payload.CityX !== 'number' || typeof payload.CityY !== 'number') {
      addLimitation(result, 'cityLifecycleUnresolved');
      continue;
    }
    if (payload.CityX !== row.X || payload.CityY !== row.Y) continue;
    if (event.Turn > row.Turn || event.CreatedAt > row.CreatedAt) return true;
    if (event.CreatedAt === row.CreatedAt) {
      addLimitation(result, 'cityLifecycleOrderUnknown');
    }
  }
  return false;
}

/** Record each lifecycle limitation once across all affected cities and events. */
function addLimitation(result: NewspaperEvidence, limitation: NonNullable<NewspaperEvidence['limitations']>[number]): void {
  result.limitations ??= [];
  if (!result.limitations.includes(limitation)) result.limitations.push(limitation);
}
