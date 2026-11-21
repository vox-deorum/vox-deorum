import { sql, type Kysely, type Selectable, type SqlBool } from 'kysely';
import type { KnowledgeDatabase } from '../knowledge/schema/base.js';
import type { CityInformation, GameEvent, TacticalZones } from '../knowledge/schema/timed.js';
import { isVisible } from '../knowledge/expressions.js';
import { readEvents, readSnapshotRange, readSnapshotsAtCutoff } from '../knowledge/history.js';
import type { RecordedRoster } from './espionage.js';
import {
  eventReportTurn, newspaperEvidenceRequestSchema,
  type NewspaperEvent, type NewspaperEvidence, type NewspaperEvidenceRequest, type NewspaperHistory, type NewspaperSnapshot,
  type NewspaperTacticalPostureChange, type NewspaperTacticalZone
} from './evidence.js';
import {
  newspaperEventConfigs, newspaperWorldNewsTypes, projectNewspaperCity, projectNewspaperDiplomacy,
  projectNewspaperEvent, projectNewspaperPlayer, projectTacticalZones,
  type NewspaperCityProjectionContext, type NewspaperProjectionContext
} from './projection.js';
import { projectEspionageEvidence } from './espionage-operations.js';
import { readReceiverTechnologies } from './technologies.js';
import { readCongressEvidence } from './congress.js';
import { projectCulturalInfluence, readCulturalInfluenceRows } from './cultural-influence.js';
import { knowsPlayer } from './recorded-city.js';

type ReceiverField = keyof KnowledgeDatabase['PlayerSummaries'] & `Player${number}`;
type CityRow = Selectable<CityInformation>;
type TacticalRow = Pick<Selectable<TacticalZones>, 'ID' | 'Turn' | 'CreatedAt' | 'ZoneID' | 'City' | 'Domain' | 'Posture' | 'Units'>;

/** Read permitted dated evidence through a caller-owned connection, without refresh or schema changes. */
export async function queryNewspaperEvidence(
  db: Kysely<KnowledgeDatabase>, input: NewspaperEvidenceRequest
): Promise<NewspaperEvidence> {
  const request = newspaperEvidenceRequestSchema.parse(input);
  const { cutoffTurn, previousCheckTurn, receiverPlayerID, comparisonRange } = request;
  const historyFromTurn = request.historyFromTurn === undefined ? undefined : Math.min(request.historyFromTurn, previousCheckTurn);
  const eventFromTurn = (historyFromTurn ?? previousCheckTurn) + 1;
  // A defender report can follow an operation on the exclusive event bound, so private reads start at that bound.
  const operationFromTurn = eventFromTurn - 1;
  const fromTurn = Math.min(eventFromTurn, comparisonRange?.fromTurn ?? cutoffTurn, cutoffTurn);
  const visibilityField = `Player${receiverPlayerID}` as ReceiverField;
  const playersRead = db.selectFrom('PlayerInformations').selectAll().execute();
  const [players, baseSummaries, summaryHistory, cities, events, uncheckedEvents, earlierCities, baselineCities, historyCities,
    cityLifecycle, espionageRows, tacticalZones, technologies, congress, culturalInfluenceRows] = await Promise.all([
    playersRead,
    readSnapshotsAtCutoff(db, 'PlayerSummaries', fromTurn - 1),
    readSnapshotRange(db, 'PlayerSummaries', fromTurn, cutoffTurn),
    readSnapshotsAtCutoff(db, 'CityInformations', cutoffTurn),
    readEvents(db, { PlayerID: receiverPlayerID, FromTurn: eventFromTurn, ToTurn: cutoffTurn }),
    db.selectFrom('GameEvents').selectAll().where('Type', 'in', [...newspaperWorldNewsTypes, 'GreatPersonExpended', 'UnitConverted'])
      .where(eb => eb.or([eb('Type', '!=', 'UnitCreated'), sql<SqlBool>`json_type(Payload, '$.Unit.GreatPerson') = 'text'`]))
      .where('Turn', '>=', eventFromTurn).where('Turn', '<=', cutoffTurn).execute(),
    comparisonRange ? readSnapshotRange(db, 'CityInformations', comparisonRange.fromTurn, comparisonRange.toTurn) : [],
    historyFromTurn === undefined ? [] : readSnapshotsAtCutoff(db, 'CityInformations', historyFromTurn),
    historyFromTurn === undefined ? [] : readSnapshotRange(db, 'CityInformations', historyFromTurn + 1, cutoffTurn),
    db.selectFrom('GameEvents').selectAll()
      .where('Type', 'in', ['CityRazed', 'CityCaptureComplete', 'CityFlipped', 'PlayerCityFounded', 'UnitCityFounded'])
      .where('Turn', '<=', cutoffTurn).where(isVisible(receiverPlayerID)).execute(),
    db.selectFrom('GameEvents').selectAll()
      .where('Type', 'in', ['EspionageResult', 'ElectionResultSuccess', 'ElectionResultFailure'])
      .where('Turn', '>=', operationFromTurn).where('Turn', '<=', cutoffTurn)
      .orderBy('Turn').orderBy('ID').execute(),
    readTacticalZones(db, Math.max(0, previousCheckTurn), cutoffTurn, receiverPlayerID, visibilityField),
    playersRead.then(rows => readReceiverTechnologies(db, rows.find(player => player.Key === receiverPlayerID)?.TeamID, cutoffTurn)),
    readCongressEvidence(db, previousCheckTurn, cutoffTurn),
    readCulturalInfluenceRows(db, previousCheckTurn, cutoffTurn)
  ]);
  const operationTurns = [...new Set(espionageRows.filter(row => row.Type === 'EspionageResult').map(row => row.Turn))]
    .sort((a, b) => a - b);
  const operationEndTurn = operationTurns.length ? Math.min(cutoffTurn, operationTurns[operationTurns.length - 1]! + 1) : cutoffTurn;
  let playerTurns: Selectable<GameEvent>[] = [];
  let techGains: Selectable<GameEvent>[] = [];
  let cityLosses: Selectable<GameEvent>[] = [];
  if (operationTurns.length) {
    [playerTurns, techGains, cityLosses] = await Promise.all([
      db.selectFrom('GameEvents').selectAll().where('Type', '=', 'PlayerDoTurn')
        .where('Turn', '>=', operationTurns[0]!).where('Turn', '<=', operationEndTurn)
        .orderBy('Turn').orderBy('ID').execute(),
      db.selectFrom('GameEvents').selectAll().where('Type', '=', 'TeamTechResearched')
        .where('Turn', 'in', operationTurns).orderBy('Turn').orderBy('ID').execute(),
      db.selectFrom('GameEvents').selectAll()
        .where('Type', 'in', ['CityRazed', 'CityCaptureComplete', 'CityFlipped'])
        .where('Turn', '>=', operationTurns[0]!).where('Turn', '<=', operationEndTurn)
        .orderBy('Turn').orderBy('ID').execute()
    ]);
  }

  const result: NewspaperEvidence = { request, players: [], cities: [], comparisons: { players: [], cities: [] }, events: [],
    diplomacy: { fromTurn, baseline: [], history: [], gaps: [] } };
  if (technologies.length) result.receiverTechnologies = technologies;
  if (congress) result.congress = congress;
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

  const seenEventIDs = new Set(events.map(row => row.ID));
  const unwitnessedEvents: Selectable<GameEvent>[] = [];
  const unitLifecycle = new Map<number, Selectable<GameEvent>[]>();
  for (const row of uncheckedEvents) {
    // These rows classify births and deaths, including when only the creation or removal was witnessed.
    if (row.Type === 'GreatPersonExpended' || row.Type === 'UnitConverted') {
      const changes = unitLifecycle.get(row.Turn);
      if (changes) changes.push(row);
      else unitLifecycle.set(row.Turn, [row]);
    } else if (!seenEventIDs.has(row.ID)) unwitnessedEvents.push(row);
  }
  const boundedEvents = [...events, ...unwitnessedEvents].sort((a, b) => a.ID - b.ID);
  const eventTurns = new Map<number, Selectable<GameEvent>[]>();
  for (const row of events) {
    const sameTurn = eventTurns.get(row.Turn);
    if (sameTurn) sameTurn.push(row);
    else eventTurns.set(row.Turn, [row]);
  }
  // World news needs its own summary context but never joins the turn's witnessed events.
  const turns = new Set([cutoffTurn, ...eventTurns.keys(), ...unwitnessedEvents.map(row => row.Turn)]);
  for (const row of culturalInfluenceRows ?? []) turns.add(row.Turn);
  // Diplomatic events use the preceding turn; snapshots use their observation or the cutoff.
  let firstCityJoin = fromTurn - 1;
  if (historyFromTurn !== undefined) turns.add(historyFromTurn);
  for (const rows of [summaryHistory, baseSummaries]) {
    for (const row of rows) if (visible(row)) turns.add(row.Turn);
  }
  const oldCityDates = new Set<number>();
  const staleCityTurns = new Set<number>();
  for (const rows of projectedCities) {
    for (const row of rows) {
      if (row.Owner === 'City-States') firstCityJoin = Math.min(firstCityJoin, row.Turn);
      if (row.Turn < fromTurn - 1) oldCityDates.add(row.Turn);
      if (row.Turn >= fromTurn - 1) turns.add(row.Turn);
      else if (!turns.has(row.Turn)) staleCityTurns.add(row.Turn);
    }
  }
  const [permittedLifecycle, cityHistory, cityContacts] = await Promise.all([
    readPermittedLifecycle(db, cityLifecycle, visibilityField),
    readCityJoinHistory(db, firstCityJoin, cutoffTurn, visibilityField, [...oldCityDates].filter(turn => turn < firstCityJoin)),
    readCityContacts(db, staleCityTurns, visibilityField, receiverPlayerID)
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
  /** Accept a private receiver roster only at full recorded receiver access. */
  function ownRoster(row: (RecordedRoster & Partial<Pick<CityRow, ReceiverField>>) | undefined): RecordedRoster | undefined {
    return row?.[visibilityField] === 2 ? row : undefined;
  }
  /** Share the dated context for snapshots and events recorded on the same turn. */
  function setContext(turn: number, summaries: NewspaperProjectionContext['summaries'], earlierRoster?: RecordedRoster): void {
    const rosters = new Map(summaries.filter(row => row.Spies != null).map(row => [row.Key, row]));
    contexts.set(turn, {
      ...cityContext, summaries, turnEvents: eventTurns.get(turn), unitLifecycle: unitLifecycle.get(turn),
      espionage: { turn, receiverRoster: ownRoster(rosters.get(receiverPlayerID)), earlierRoster, rosters }
    });
  }
  let position = 0;
  for (const turn of orderedTurns) {
    if (turn < fromTurn - 1) continue;
    let earlier = latest.get(receiverPlayerID);
    while (position < summaryHistory.length && summaryHistory[position].Turn <= turn) {
      const row = summaryHistory[position++];
      latest.set(row.Key, row);
      if (row.Key === receiverPlayerID && row.Turn < turn) earlier = row;
    }
    setContext(turn, [...latest.values()].sort((a, b) => a.Key - b.Key),
      earlier && earlier.Turn < turn ? ownRoster(earlier) : undefined);
  }
  // Stale facts use the contact and permissions recorded on their own observation turn.
  await Promise.all(orderedTurns.filter(turn => turn < fromTurn - 1).map(
    /** Resolve the original permission context for an observation predating the window. */
    async turn => setContext(turn, await readSnapshotsAtCutoff(db, 'PlayerSummaries', turn))));

  const cutoffContext = contexts.get(cutoffTurn)!;
  if (culturalInfluenceRows?.length) {
    const culturalInfluence: NonNullable<NewspaperEvidence['culturalInfluence']> = { observations: [] };
    for (const row of culturalInfluenceRows) {
      const observed = contexts.get(row.Turn)!;
      const projected = projectCulturalInfluence(row, receiverPlayerID, players,
        playerID => knowsPlayer(playerID, observed) && knowsPlayer(playerID, cutoffContext));
      if (row.Turn <= previousCheckTurn) culturalInfluence.baseline = projected;
      else culturalInfluence.observations.push(projected);
    }
    if (culturalInfluence.baseline?.readings.length || culturalInfluence.observations.some(row => row.readings.length))
      result.culturalInfluence = culturalInfluence;
  }
  /** Use the narrow dated contact read when no national projection needs this observation turn. */
  function projectCity(row: CityRow, current = false): NewspaperSnapshot | undefined {
    if (!visible(row)) return undefined;
    const contacts = cityContacts.get(row.Turn);
    const context: NewspaperCityProjectionContext = contexts.get(row.Turn) ?? { ...cityContext, summaries: contacts ?? [], espionage: {
      turn: row.Turn, receiverRoster: ownRoster(contacts?.find(contact => contact.Key === receiverPlayerID)), rosters: new Map()
    } };
    return projectNewspaperCity(row, context, cutoffContext, current);
  }
  const summaries = cutoffContext.summaries;
  const earlierPlayers = comparisonRange ? summaryHistory.filter(row =>
    row.Turn >= comparisonRange.fromTurn && row.Turn <= comparisonRange.toTurn) : [];

  for (const [rows, target] of [[baseSummaries, result.diplomacy!.baseline], [summaryHistory, result.diplomacy!.history]] as const) {
    for (const row of rows) {
      if (!visible(row)) continue;
      const projected = projectNewspaperDiplomacy(row, contexts.get(row.Turn)!, result.diplomacy!.gaps);
      if (projected) target.push(projected);
    }
  }
  for (const [rows, target, current] of [[summaries, result.players, true], [earlierPlayers, result.comparisons.players, false]] as const) {
    for (const row of rows) {
      if (!visible(row)) continue;
      const projected = projectNewspaperPlayer(row, current ? cutoffContext : contexts.get(row.Turn)!);
      if (projected) target.push(projected);
    }
  }
  for (const [rows, target, current] of [[currentCities, result.cities, true], [comparisonCities, result.comparisons.cities, false]] as const) {
    for (const row of rows) {
      const projected = projectCity(row, current);
      if (projected) target.push(projected);
    }
  }
  if (tacticalZones) {
    result.tacticalZones = projectTacticalZones(
      tacticalZones.filter(zone => zone.Turn === cutoffTurn), result.cities, result.players, cutoffContext
    );
    if (result.tacticalZones.some(zone => zone.city) && previousCheckTurn >= 0 && previousCheckTurn < cutoffTurn)
      await attachPreviousPostures(db, result.tacticalZones, currentCities, previousCheckTurn, visibilityField,
        tacticalZones.filter(zone => zone.Turn === previousCheckTurn));
    result.tacticalPostureChanges = await readTacticalPostureChanges(
      db, tacticalZones, currentCities, previousCheckTurn, cutoffTurn, visibilityField, removals
    );
  }
  const projectedEvents = projectEspionageEvidence({
    receiverPlayerID, players, rows: espionageRows, playerTurns, techGains, cityLosses
  });
  for (const row of boundedEvents) {
    const projected = projectNewspaperEvent(row, contexts.get(row.Turn)!);
    if (projected) projectedEvents.push(projected);
  }
  projectedEvents.sort((a, b) => eventReportTurn(a) - eventReportTurn(b) || a.source.id - b.source.id);
  const windowEvents: NewspaperEvent[] = [];
  for (const projected of projectedEvents) {
    const turn = eventReportTurn(projected);
    if (turn > previousCheckTurn) result.events.push(projected);
    if (historyFromTurn !== undefined && turn > historyFromTurn) windowEvents.push(projected);
  }
  if (historyFromTurn !== undefined) {
    const history: NewspaperHistory = { fromTurn: historyFromTurn, baseline: { players: [], cities: [] },
      snapshots: { players: [], cities: [] }, gaps: [], events: windowEvents };
    appendHistory(history, 'players', contexts.get(historyFromTurn)!.summaries,
      summaryHistory.filter(row => row.Turn > historyFromTurn),
      /** Use the baseline date for its as-of view and the recorded date for each following observation. */
      row => visible(row) ? projectNewspaperPlayer(row, contexts.get(Math.max(row.Turn, historyFromTurn))!) : undefined);
    appendHistory(history, 'cities', activeBaselineCities, historyCities, row => projectCity(row), removalTurn);
    history.gaps.sort((a, b) => a.turn - b.turn || a.subjectID - b.subjectID);
    result.history = history;
  }
  return result;
}

/** Read dated contact and only the receiver's own roster for old city dates in one pass. */
async function readCityContacts(db: Kysely<KnowledgeDatabase>, turns: ReadonlySet<number>, field: ReceiverField, receiver: number) {
  type Contact = RecordedRoster & Pick<CityRow, ReceiverField>;
  const contacts = new Map<number, Contact[]>();
  if (!turns.size) return contacts;
  const dates = [...turns].sort((a, b) => a - b);
  const rows = await db.selectFrom('PlayerSummaries').select(['ID', 'Key', 'Turn', 'CreatedAt', field])
    .select(sql<RecordedRoster['Spies']>`case when "Key" = ${receiver} then Spies end`.as('Spies'))
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

/** Read the receiver's full-access sightings, keeping the latest insertion per nonzero zone and turn. */
async function readTacticalZones(
  db: Kysely<KnowledgeDatabase>, from: number, cutoff: number, receiver: number, field: ReceiverField
): Promise<TacticalRow[] | undefined> {
  const table = await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name = 'TacticalZones'`.execute(db);
  if (!table.rows.length) return undefined;
  return db.selectFrom('TacticalZones')
    .select(['ID', 'Turn', 'CreatedAt', 'ZoneID', 'City', 'Domain', 'Posture', 'Units'])
    .where('ID', 'in', sql<number>`(select max(ID) from TacticalZones
      where Turn between ${from} and ${cutoff} and PlayerID = ${receiver} and ${sql.ref(field)} = 2 and ZoneID != 0
      group by Turn, ZoneID)`)
    .orderBy('Turn').orderBy('ZoneID').execute();
}

/** Compare the same readable city and domain across two sightings, without interpreting absent zones. */
async function attachPreviousPostures(
  db: Kysely<KnowledgeDatabase>, zones: NewspaperTacticalZone[], currentCities: readonly CityRow[],
  turn: number, field: ReceiverField, previousZones: readonly TacticalRow[]
): Promise<void> {
  if (!previousZones.length) return;
  const priorCities = await readSnapshotsAtCutoff(db, 'CityInformations', turn);
  const byZone = new Map(previousZones.map(zone => [zone.ZoneID, zone]));
  const byCity = new Map(priorCities.map(city => [city.Key, city]));
  const current = new Map(currentCities.map(city => [city.Key, city]));
  for (const zone of zones) {
    const prior = byZone.get(zone.zoneID);
    if (!zone.city || prior?.City !== zone.city || prior.Domain !== zone.domain) continue;
    const id = Math.abs(zone.zoneID);
    const before = byCity.get(id);
    const after = current.get(id);
    if (!before || !after || (before[field] !== 1 && before[field] !== 2) || before.Name !== zone.city ||
        before.X !== after.X || before.Y !== after.Y || before.Owner !== after.Owner) continue;
    zone.previousPosture = {
      posture: prior.Posture,
      source: { table: 'TacticalZones', id: prior.ID, turn: prior.Turn, createdAt: prior.CreatedAt }
    };
  }
}

/** Report changed postures only across consecutive sightings of a continuously readable city. */
async function readTacticalPostureChanges(
  db: Kysely<KnowledgeDatabase>, rows: readonly TacticalRow[], currentCities: readonly CityRow[],
  from: number, cutoff: number, field: ReceiverField, removals: ReadonlyMap<string, readonly Selectable<GameEvent>[]>
): Promise<NewspaperTacticalPostureChange[]> {
  const cityById = new Map(currentCities.map(city => [city.Key, city]));
  const lastByZone = new Map<number, TacticalRow>();
  const changes: NewspaperTacticalPostureChange[] = [];
  for (const row of rows) {
    const prior = lastByZone.get(row.ZoneID);
    lastByZone.set(row.ZoneID, row);
    if (row.Turn <= from || !prior || prior.Turn !== row.Turn - 1 || prior.Posture === row.Posture ||
        prior.Domain !== row.Domain || !row.City || prior.City !== row.City ||
        cityById.get(Math.abs(row.ZoneID))?.Name !== row.City) continue;
    changes.push({
      zoneID: row.ZoneID, domain: row.Domain, city: row.City, posture: row.Posture,
      source: { table: 'TacticalZones', id: row.ID, turn: row.Turn, createdAt: row.CreatedAt },
      previousPosture: {
        posture: prior.Posture,
        source: { table: 'TacticalZones', id: prior.ID, turn: prior.Turn, createdAt: prior.CreatedAt }
      }
    });
  }
  if (!changes.length) return changes;

  const ids = [...new Set(changes.map(change => Math.abs(change.zoneID)))];
  const datedCities = await db.selectFrom('CityInformations').select(['Key', 'Turn', 'Name', 'Owner', 'X', 'Y', field])
    .where('ID', 'in', sql<number>`(select ID from (
      select ID, row_number() over (partition by "Key", max(Turn, ${from}) order by Turn desc, ID desc) as position
      from CityInformations where "Key" in (${sql.join(ids)}) and Turn <= ${cutoff}
    ) where position = 1)`)
    .orderBy('Turn', 'desc').execute();
  const knownSince = new Map<number, number>();
  const interrupted = new Set<number>();
  for (const city of datedCities) {
    if (interrupted.has(city.Key)) continue;
    const current = cityById.get(city.Key)!;
    if ((city[field] === 1 || city[field] === 2) && city.Name === current.Name && city.Owner === current.Owner &&
        city.X === current.X && city.Y === current.Y) knownSince.set(city.Key, city.Turn);
    else interrupted.add(city.Key);
  }
  return changes.filter(change => {
    const id = Math.abs(change.zoneID);
    const since = knownSince.get(id);
    const city = cityById.get(id)!;
    const priorTurn = change.previousPosture.source.turn;
    return since !== undefined && priorTurn >= since &&
      !removals.get(`${city.X}/${city.Y}`)?.some(event => event.Turn >= priorTurn);
  });
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
  field: ReceiverField, oldDates: number[]
) {
  const before = sql<number>`(select ID from (
    select ID, row_number() over (partition by "Key", X, Y order by Turn desc, ID desc) as position
    from CityInformations where Turn < ${fromTurn}
  ) where position = 1)`;
  const barriers = sql<number>`(select ID from (
    select ID, row_number() over (partition by X, Y order by Turn desc, CreatedAt desc, ID desc) as position
    from CityInformations where Turn < ${fromTurn} and (Owner != 'City-States' or ${sql.ref(field)} not in (1, 2))
  ) where position = 1)`;
  // A stale city needs a dated roster join at its own observation, without loading the intervening turns.
  const anchors = sql<number>`(select ID from (
    select CityInformations.ID, row_number() over (partition by dates.value, X, Y order by Turn desc, CityInformations.ID desc) as position
    from CityInformations join json_each(${JSON.stringify(oldDates)}) as dates on Turn <= dates.value
  ) where position = 1)`;
  return db.selectFrom('CityInformations').select(['ID', 'Key', 'Turn', 'CreatedAt', 'Owner', 'Name', 'X', 'Y', 'IsCapital', field])
    .where(eb => eb.or([
      eb('ID', 'in', before), eb('ID', 'in', barriers), ...(oldDates.length ? [eb('ID', 'in', anchors)] : []),
      eb.and([eb('Turn', '>=', fromTurn), eb('Turn', '<=', cutoffTurn)])
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
