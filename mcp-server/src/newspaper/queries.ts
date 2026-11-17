import { sql, type Kysely, type Selectable } from 'kysely';
import type { KnowledgeDatabase } from '../knowledge/schema/base.js';
import type { CityInformation, GameEvent } from '../knowledge/schema/timed.js';
import { isVisible } from '../knowledge/expressions.js';
import { readEvents, readSnapshotRange, readSnapshotsAtCutoff } from '../knowledge/history.js';
import {
  newspaperEvidenceRequestSchema, type NewspaperEvent, type NewspaperEvidence, type NewspaperEvidenceRequest, type NewspaperHistory, type NewspaperSnapshot
} from './evidence.js';
import {
  newspaperEventConfigs, projectNewspaperCity, projectNewspaperDiplomacy, projectNewspaperEvent,
  projectNewspaperPlayer, type NewspaperCityProjectionContext, type NewspaperProjectionContext
} from './projection.js';

type ReceiverField = keyof KnowledgeDatabase['PlayerSummaries'] & `Player${number}`;
type CityRow = Selectable<CityInformation>;

/** Read permitted dated evidence through a caller-owned connection, without refresh or schema changes. */
export async function queryNewspaperEvidence(
  db: Kysely<KnowledgeDatabase>, input: NewspaperEvidenceRequest
): Promise<NewspaperEvidence> {
  const request = newspaperEvidenceRequestSchema.parse(input);
  const { cutoffTurn, previousCheckTurn, receiverPlayerID, comparisonRange } = request;
  const historyFromTurn = request.historyFromTurn === undefined ? undefined : Math.min(request.historyFromTurn, previousCheckTurn);
  const eventFromTurn = (historyFromTurn ?? previousCheckTurn) + 1;
  const fromTurn = Math.min(eventFromTurn, comparisonRange?.fromTurn ?? cutoffTurn, cutoffTurn);
  const visibilityField = `Player${receiverPlayerID}` as ReceiverField;
  const [players, baseSummaries, summaryHistory, cities, events, earlierCities, baselineCities, historyCities, cityLifecycle] = await Promise.all([
    db.selectFrom('PlayerInformations').selectAll().execute(),
    readSnapshotsAtCutoff(db, 'PlayerSummaries', fromTurn - 1),
    readSnapshotRange(db, 'PlayerSummaries', fromTurn, cutoffTurn),
    readSnapshotsAtCutoff(db, 'CityInformations', cutoffTurn),
    readEvents(db, { PlayerID: receiverPlayerID, FromTurn: eventFromTurn, ToTurn: cutoffTurn }),
    comparisonRange ? readSnapshotRange(db, 'CityInformations', comparisonRange.fromTurn, comparisonRange.toTurn) : [],
    historyFromTurn === undefined ? [] : readSnapshotsAtCutoff(db, 'CityInformations', historyFromTurn),
    historyFromTurn === undefined ? [] : readSnapshotRange(db, 'CityInformations', historyFromTurn + 1, cutoffTurn),
    db.selectFrom('GameEvents').selectAll()
      .where('Type', 'in', ['CityRazed', 'CityCaptureComplete', 'CityFlipped', 'PlayerCityFounded', 'UnitCityFounded'])
      .where('Turn', '<=', cutoffTurn).where(isVisible(receiverPlayerID)).execute()
  ]);

  const result: NewspaperEvidence = { request, players: [], cities: [], comparisons: { players: [], cities: [] }, events: [],
    diplomacy: { fromTurn, baseline: [], history: [], gaps: [] } };
  /** Take a row only at an access level supported by the snapshot projection. */
  function visible(row: Pick<CityRow, ReceiverField>): boolean {
    const level = row[visibilityField];
    return level === 1 || level === 2;
  }
  // A visible removal can end an observed city without naming the parties or publishing the event.
  const removals = cityRemovalIndex(cityLifecycle);
  /** Find the first removal after this observation and no later than the given turn. */
  function removalTurn(row: CityRow, untilTurn: number): number | undefined {
    return removals.get(`${row.X}/${row.Y}`)?.find(event => event.Turn <= untilTurn && followsObservation(event, row))?.Turn;
  }
  const currentCities = cities.filter(row => visible(row) && !retiredCity(row, cityLifecycle, result));
  const comparisonCities = earlierCities.filter(visible);
  const activeBaselineCities = historyFromTurn === undefined ? [] :
    baselineCities.filter(row => visible(row) && removalTurn(row, historyFromTurn) === undefined);
  const visibleHistoryCities = historyCities.filter(visible);
  const projectedCities = [currentCities, comparisonCities, activeBaselineCities, visibleHistoryCities];

  const eventTurns = new Map<number, Selectable<GameEvent>[]>();
  let firstCityJoin = cutoffTurn + 1;
  for (const row of events) {
    const sameTurn = eventTurns.get(row.Turn);
    if (sameTurn) sameTurn.push(row);
    else eventTurns.set(row.Turn, [row]);
    if (newspaperEventConfigs[row.Type]?.cityIDs) firstCityJoin = Math.min(firstCityJoin, row.Turn);
  }
  const turns = new Set([cutoffTurn, ...eventTurns.keys()]);
  if (historyFromTurn !== undefined) turns.add(historyFromTurn);
  for (const rows of [summaryHistory, baseSummaries]) {
    for (const row of rows) if (visible(row)) turns.add(row.Turn);
  }
  const staleCityTurns = new Set<number>();
  for (const rows of projectedCities) {
    for (const row of rows) {
      if (row.Owner === 'City-States') firstCityJoin = Math.min(firstCityJoin, row.Turn);
      if (row.Turn >= fromTurn - 1) turns.add(row.Turn);
      else if (!turns.has(row.Turn)) staleCityTurns.add(row.Turn);
    }
  }
  const [permittedLifecycle, cityHistory, cityContacts] = await Promise.all([
    readPermittedLifecycle(db, cityLifecycle, visibilityField),
    firstCityJoin <= cutoffTurn ? readCityJoinHistory(db, firstCityJoin, cutoffTurn, visibilityField) : [],
    readCityContacts(db, staleCityTurns, visibilityField)
  ]);
  const permittedLifecycleIDs = new Set(permittedLifecycle.map(event => event.ID));
  const contexts = new Map<number, NewspaperProjectionContext>();
  const latest = new Map(baseSummaries.map(row => [row.Key, row]));
  const orderedTurns = [...turns].sort((a, b) => a - b);
  /** Resolve contact on the lifecycle event's own turn, including anchors predating the window. */
  function knowsLifecyclePlayer(event: Selectable<GameEvent>, playerID: number): boolean {
    return permittedLifecycleIDs.has(event.ID) &&
      (event.Type === 'CityCaptureComplete' ? event.Payload.NewOwnerID : event.Payload.PlayerID) === playerID;
  }
  const cityContext = { receiverPlayerID, players, cityHistory, cityLifecycle, knowsLifecyclePlayer };
  /** Share the dated context for snapshots and events recorded on the same turn. */
  function setContext(turn: number, summaries: NewspaperProjectionContext['summaries']): void {
    contexts.set(turn, { ...cityContext, summaries, turnEvents: eventTurns.get(turn) });
  }
  let position = 0;
  for (const turn of orderedTurns) {
    if (turn < fromTurn - 1) continue;
    while (position < summaryHistory.length && summaryHistory[position].Turn <= turn) {
      const row = summaryHistory[position++];
      latest.set(row.Key, row);
    }
    setContext(turn, [...latest.values()].sort((a, b) => a.Key - b.Key));
  }
  // Stale facts use the contact and permissions recorded on their own observation turn.
  await Promise.all(orderedTurns.filter(turn => turn < fromTurn - 1).map(
    /** Resolve the original permission context for an observation predating the window. */
    async turn => setContext(turn, await readSnapshotsAtCutoff(db, 'PlayerSummaries', turn))));

  /** Use the narrow dated contact read when no national projection needs this observation turn. */
  function projectCity(row: CityRow): NewspaperSnapshot | undefined {
    if (!visible(row)) return undefined;
    return projectNewspaperCity(row, contexts.get(row.Turn) ?? { ...cityContext, summaries: cityContacts.get(row.Turn)! });
  }
  const summaries = contexts.get(cutoffTurn)!.summaries;
  const earlierPlayers = comparisonRange ? summaryHistory.filter(row =>
    row.Turn >= comparisonRange.fromTurn && row.Turn <= comparisonRange.toTurn) : [];

  for (const [rows, target] of [[baseSummaries, result.diplomacy!.baseline], [summaryHistory, result.diplomacy!.history]] as const) {
    for (const row of rows) {
      if (!visible(row)) continue;
      const projected = projectNewspaperDiplomacy(row, contexts.get(row.Turn)!, result.diplomacy!.gaps);
      if (projected) target.push(projected);
    }
  }
  for (const [rows, target] of [[summaries, result.players], [earlierPlayers, result.comparisons.players]] as const) {
    for (const row of rows) {
      if (!visible(row)) continue;
      const projected = projectNewspaperPlayer(row, contexts.get(row.Turn)!);
      if (projected) target.push(projected);
    }
  }
  for (const [rows, target] of [[currentCities, result.cities], [comparisonCities, result.comparisons.cities]] as const) {
    for (const row of rows) {
      const projected = projectCity(row);
      if (projected) target.push(projected);
    }
  }
  const windowEvents: NewspaperEvent[] = [];
  for (const row of events) {
    const projected = projectNewspaperEvent(row, contexts.get(row.Turn)!);
    if (!projected) continue;
    if (row.Turn > previousCheckTurn) result.events.push(projected);
    if (historyFromTurn !== undefined) windowEvents.push(projected);
  }
  if (historyFromTurn !== undefined) {
    const history: NewspaperHistory = { fromTurn: historyFromTurn, baseline: { players: [], cities: [] },
      snapshots: { players: [], cities: [] }, gaps: [],
      events: windowEvents.sort((a, b) => a.source.turn - b.source.turn || a.source.id - b.source.id) };
    appendHistory(history, 'players', contexts.get(historyFromTurn)!.summaries,
      summaryHistory.filter(row => row.Turn > historyFromTurn),
      /** Project national fields with the historical diplomatic context. */
      row => visible(row) ? projectNewspaperPlayer(row, contexts.get(row.Turn)!) : undefined);
    appendHistory(history, 'cities', activeBaselineCities, historyCities, projectCity, removalTurn);
    history.gaps.sort((a, b) => a.turn - b.turn || a.subjectID - b.subjectID);
    result.history = history;
  }
  return result;
}

/** Read only the receiver's contact columns for all old city dates in one pass. */
async function readCityContacts(db: Kysely<KnowledgeDatabase>, turns: ReadonlySet<number>, field: ReceiverField) {
  const contacts = new Map<number, NewspaperCityProjectionContext['summaries']>();
  if (!turns.size) return contacts;
  const dates = [...turns].sort((a, b) => a - b);
  const rows = await db.selectFrom('PlayerSummaries').select(['Key', 'Turn', field])
    .where('Turn', '<=', dates[dates.length - 1]).orderBy('Turn').orderBy('ID').execute();
  const latest = new Map<number, (typeof rows)[number]>();
  let index = 0;
  for (const turn of dates) {
    while (index < rows.length && rows[index].Turn <= turn) {
      const row = rows[index++];
      latest.set(row.Key, row);
    }
    contacts.set(turn, [...latest.values()]);
  }
  return contacts;
}

/** Apply the lifecycle events' dated subject policy, without reading full national rows for old events. */
async function readPermittedLifecycle(
  db: Kysely<KnowledgeDatabase>, events: Selectable<GameEvent>[],
  field: ReceiverField
): Promise<Selectable<GameEvent>[]> {
  const checks = new Map<number, Selectable<GameEvent>[]>();
  const permitted = new Set<number>();
  let lastTurn = -1;
  for (const event of events) {
    // Flips and razing can block a join, without supplying an ownership anchor.
    if (event.Type === 'CityFlipped' || event.Type === 'CityRazed') continue;
    const subjects = newspaperEventConfigs[event.Type].subjects.playerIdFields
      .filter(key => key in event.Payload).map(key => event.Payload[key]);
    if (subjects.some(id => typeof id !== 'number')) continue;
    permitted.add(event.ID);
    for (const subject of subjects as number[]) {
      if (subject === 63) continue;
      const rows = checks.get(subject);
      if (rows) rows.push(event);
      else checks.set(subject, [event]);
    }
    lastTurn = Math.max(lastTurn, event.Turn);
  }
  const permissions = checks.size ? await db.selectFrom('PlayerSummaries').select(['Key', 'Turn', field])
    .where('Key', 'in', [...checks.keys()]).where('Turn', '<=', lastTurn)
    .orderBy('Key').orderBy('Turn').orderBy('ID').execute() : [];
  let index = 0;
  for (const [subject, rows] of [...checks].sort(([a], [b]) => a - b)) {
    let level = 0;
    for (const event of rows.sort((a, b) => a.Turn - b.Turn)) {
      while (index < permissions.length && (permissions[index].Key < subject ||
        (permissions[index].Key === subject && permissions[index].Turn <= event.Turn))) {
        const current = permissions[index++];
        if (current.Key === subject) level = current[field];
      }
      if (level <= 0) permitted.delete(event.ID);
    }
  }
  return events.filter(event => permitted.has(event.ID));
}

/** Keep narrow city join inputs, including hidden and different-owner rows that can end an older observation. */
function readCityJoinHistory(
  db: Kysely<KnowledgeDatabase>, fromTurn: number, cutoffTurn: number,
  field: ReceiverField
) {
  const before = sql<number>`(select ID from (
    select ID, row_number() over (partition by "Key", X, Y order by Turn desc, CreatedAt desc, ID desc) as position
    from CityInformations where Turn < ${fromTurn}
  ) where position = 1)`;
  const barriers = sql<number>`(select ID from (
    select ID, row_number() over (partition by X, Y order by Turn desc, CreatedAt desc, ID desc) as position
    from CityInformations where Turn < ${fromTurn} and (Owner != 'City-States' or ${sql.ref(field)} not in (1, 2))
  ) where position = 1)`;
  return db.selectFrom('CityInformations').select(['ID', 'Key', 'Turn', 'CreatedAt', 'Owner', 'Name', 'X', 'Y', field])
    .where(eb => eb.or([
      eb('ID', 'in', before), eb('ID', 'in', barriers), eb.and([eb('Turn', '>=', fromTurn), eb('Turn', '<=', cutoffTurn)])
    ]))
    .orderBy('Turn').orderBy('ID').execute();
}

/** Project final observations, noting loss of access only for previously visible subjects. */
function appendHistory<Row extends { Key: number; Turn: number }>(
  history: NewspaperHistory, subject: 'players' | 'cities', baseline: Row[], rows: Row[],
  project: (row: Row) => NewspaperSnapshot | undefined,
  removalTurn?: (row: Row, untilTurn: number) => number | undefined
): void {
  const visible = new Map<number, Row>();
  const table = subject === 'players' ? 'PlayerSummaries' : 'CityInformations';
  /** Preserve the first gap after a visible observation so it cannot be carried farther. */
  function gap(subjectID: number, turn: number): void {
    history.gaps.push({ table, subjectID, turn });
    visible.delete(subjectID);
  }
  for (const row of baseline) {
    const projected = project(row);
    if (!projected) continue;
    history.baseline[subject].push(projected);
    visible.set(row.Key, row);
  }
  for (const row of rows) {
    const previous = visible.get(row.Key);
    const removed = previous && removalTurn?.(previous, row.Turn - 1);
    if (removed !== undefined) gap(row.Key, removed);
    const projected = project(row);
    if (projected) {
      history.snapshots[subject].push(projected);
      visible.set(row.Key, row);
    } else if (visible.has(row.Key)) {
      gap(row.Key, row.Turn);
    }
  }
  if (removalTurn) for (const row of visible.values()) {
    const removed = removalTurn(row, Infinity);
    if (removed !== undefined) gap(row.Key, removed);
  }
}

/** Group dated removals by plot so they can end a city observation without joining unrelated IDs. */
function cityRemovalIndex(lifecycle: Selectable<GameEvent>[]): Map<string, Selectable<GameEvent>[]> {
  const plots = new Map<string, Selectable<GameEvent>[]>();
  for (const event of lifecycle) {
    const { CityX: x, CityY: y } = event.Payload;
    if ((event.Type !== 'CityRazed' && event.Type !== 'CityCaptureComplete') || typeof x !== 'number' || typeof y !== 'number') continue;
    const key = `${x}/${y}`;
    const eventsAtPlot = plots.get(key);
    if (eventsAtPlot) eventsAtPlot.push(event);
    else plots.set(key, [event]);
  }
  for (const events of plots.values()) events.sort((a, b) => a.Turn - b.Turn);
  return plots;
}

/** Compare dates across tables only when the turn or its recorded timestamp establishes the order. */
function followsObservation(
  event: Selectable<GameEvent>, snapshot: Selectable<CityInformation>
): boolean {
  return event.Turn > snapshot.Turn || (event.Turn === snapshot.Turn && event.CreatedAt > snapshot.CreatedAt);
}

/** Retire observed city rows only when coordinates and recorded ordering establish a later removal. */
function retiredCity(row: Selectable<CityInformation>, events: Selectable<GameEvent>[], result?: NewspaperEvidence): boolean {
  for (const event of events) {
    if (event.Type !== 'CityRazed' && event.Type !== 'CityCaptureComplete') continue;
    if (event.Turn < row.Turn) continue;
    const payload = event.Payload;
    if (typeof payload.CityX !== 'number' || typeof payload.CityY !== 'number') {
      if (result) addLimitation(result, 'cityLifecycleUnresolved');
      continue;
    }
    if (payload.CityX !== row.X || payload.CityY !== row.Y) continue;
    if (followsObservation(event, row)) return true;
    if (result && event.CreatedAt === row.CreatedAt) {
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
