import { eventReportTurn, type NewspaperEvent, type NewspaperSnapshot,
  type NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { isRecord } from '../../../utils/guards.js';
import { uniqueSources } from '../shared/sources.js';
import { compareFactDates, eventsForCity, isCapture, isFounding, recordedId, recordedNames } from './event-city.js';
import { eventPlayerFact, recordedBoolean } from './event.js';
import { fact, recordedFact, reference, rowSources, windowFacts, type FactBuildContext, type FactField, type FactObject } from './model.js';

const cityFields = [
  'Name', 'X', 'Y', 'Population', 'MajorityReligion', 'DefenseStrength', 'HitPoints', 'MaxHitPoints',
  'IsCapital', 'IsPuppet', 'IsOccupied', 'IsCoastal', 'Wonders', 'RazingTurns', 'ResistanceTurns',
  'FoodStored', 'FoodPerTurn', 'ProductionStored', 'ProductionPerTurn', 'CurrentProduction',
  'ProductionTurnsLeft', 'GoldPerTurn', 'SciencePerTurn', 'CulturePerTurn', 'FaithPerTurn',
  'TourismPerTurn', 'HappinessDelta', 'BuildingCount', 'ImportantBuildings', 'GreatWorkCount'
] as const;

// Projected cause readings keep the order used to break ties for the largest cause.
const unhappinessSources = [
  ['culture', 'Culture'], ['gold', 'Gold'], ['science', 'Science'], ['distress', 'Distress'],
  ['religion', 'Religion'], ['isolation', 'Isolation'], ['famine', 'Famine'],
  ['pillaged', 'PillagedTiles'], ['buildings', 'Buildings'], ['specialists', 'Specialists'],
] as const;

type DatedFact = { turn: number; field: FactField };
type Change = { row: NewspaperSnapshot | NewspaperEvent; value: string | number | null | undefined; sources: NewspaperSourceReference[] };
type SnapshotChange = Change & { before: NewspaperSnapshot; lastReligionReport?: NewspaperEvent };

/** Copy stored city fields and link only the owner resolved by dated evidence projection. */
export function buildCitySnapshotFacts(row: NewspaperSnapshot, context: FactBuildContext): FactObject {
  const sources = rowSources(row);
  const fields: Record<string, FactField> = { id: fact(row.subjectID, sources) };
  for (const key of cityFields) {
    const raw = row.values[key];
    const value = recordedFact(cityValue(key, raw), sources);
    if (value) fields[key[0].toLowerCase() + key.slice(1)] = value;
  }
  // Share of hit points lost, so rules need not repeat the arithmetic and its guards.
  const hitPoints = fields.hitPoints?.value, maxHitPoints = fields.maxHitPoints?.value;
  if (typeof hitPoints === 'number' && typeof maxHitPoints === 'number' && maxHitPoints > 0)
    fields.damage = fact((maxHitPoints - hitPoints) / maxHitPoints, sources);
  const unhappiness = unhappinessCauses(row.values.UnhappinessSources);
  const causes = unhappiness && recordedFact(unhappiness, sources);
  if (causes) fields.unhappiness = causes;
  // Presence is projected as a boolean. Keep an observed false distinct from an absent reading.
  const spyPresent = recordedBoolean(row.values.OurSpyPresent);
  if (spyPresent !== undefined) fields.ourSpyPresent = fact(spyPresent, sources);
  const owner = recordedId(row.values.OwnerID);
  if (owner !== undefined && context.players.some(player => player.subjectID === owner)) {
    fields.owner = fact(reference('player', owner), sources);
  }
  return fields;
}

// Columns where a stored null means "none". Any other empty column is a gap and stays hidden.
const nullableCityFields = new Set<typeof cityFields[number]>([
  'MajorityReligion', 'CurrentProduction', 'Wonders', 'ImportantBuildings'
]);

/** Normalize the two known list columns and recorded city flags, keeping null only where it means "none". */
function cityValue(key: typeof cityFields[number], raw: unknown): unknown {
  if (raw === null) return nullableCityFields.has(key) ? null : undefined;
  if (key === 'Wonders' || key === 'ImportantBuildings') return recordedNames(raw);
  return key.startsWith('Is') ? recordedBoolean(raw) : raw;
}

/** Read projected unhappiness causes, reading a missing cause as zero and naming the largest positive one. */
function unhappinessCauses(value: unknown): Record<string, number | string | null> | undefined {
  if (!isRecord(value)) return undefined;
  const causes: Record<string, number> = {};
  for (const [name, field] of unhappinessSources) {
    const reading = Object.hasOwn(value, field) ? value[field] : 0;
    if (typeof reading !== 'number' || !Number.isFinite(reading)) return undefined;
    causes[name] = reading;
  }
  let top: string | null = null;
  for (const [name] of unhappinessSources) {
    if (causes[name] <= 0) continue;
    if (top === null || causes[name] > causes[top]) top = name;
  }
  return { ...causes, top };
}

/** Read the most recent different known owner in the same continuous city history. */
function observedFormerOwner(city: NewspaperSnapshot, rows: NewspaperSnapshot[], context: FactBuildContext): FactField | undefined {
  const owner = recordedId(city.values.OwnerID);
  if (owner === undefined) return undefined;
  for (let i = rows.length - 1; i >= 0; i--) {
    const prior = rows[i];
    if (prior.source.id === city.source.id) continue;
    const oldOwner = recordedId(prior.values.OwnerID);
    if (oldOwner === owner) continue;
    return oldOwner !== undefined && context.players.some(player => player.subjectID === oldOwner)
      ? fact(reference('player', oldOwner), [...rowSources(prior), ...rowSources(city)]) : undefined;
  }
  return undefined;
}

/** Build fields shared by every window entry, preserving the evidence for the date. */
function dated(turn: number, fields: FactObject, sources: NewspaperSourceReference[]): DatedFact {
  return { turn, field: fact({ turn: fact(turn, sources), ...fields }, sources) };
}

/** Keep a visible training completion, adding a dated port only for the receiver's own training. */
function trained(event: NewspaperEvent, receiverId: number): DatedFact {
  const sources = rowSources(event);
  const fields: Record<string, FactField> = {};
  if (typeof event.values.Unit === 'string' && event.values.Unit.trim()) fields.unit = fact(event.values.Unit, sources);
  for (const key of ['WithGold', 'WithFaith'] as const) {
    const value = recordedBoolean(event.values[key]);
    if (value !== undefined) fields[key === 'WithGold' ? 'withGold' : 'withFaith'] = fact(value, sources);
  }
  // Generic event visibility can come from another owner's unit or city, so the port stays private.
  const port = event.values.Port;
  if (event.values.PlayerID === receiverId && typeof port === 'string' && port.trim())
    fields.port = fact(port, sources);
  return dated(event.source.turn, fields, sources);
}

/** Read a recorded religion name, ID, or known lack of a majority. */
function religion(value: unknown): string | number | null | undefined {
  if (value === null || value === -1) return null;
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  return undefined;
}

/** Compare two religions only when both observations use comparable identities. */
function religionChanged(before: Change['value'], after: Change['value']): boolean {
  return before !== undefined && after !== undefined && before !== after &&
    (before === null || after === null || typeof before === typeof after);
}

/** Decide whether a report falls between the two observations establishing a snapshot change. */
function insideInterval(row: NewspaperSnapshot | NewspaperEvent, snapshot: SnapshotChange): boolean {
  return compareFactDates(row, snapshot.before) > 0 && compareFactDates(row, snapshot.row) <= 0;
}

/** Merge snapshot confirmation without turning it into a second change after the dated one. */
function mergeChanges(events: Change[], snapshots: SnapshotChange[], field: 'building' | 'religion'): DatedFact[] {
  const changes = [...events];
  for (const snapshot of snapshots) {
    const candidates = events.filter(entry => insideInterval(entry.row, snapshot));
    let observed = candidates.filter(entry => entry.value === snapshot.value).at(-1);
    const lastReport = snapshot.lastReligionReport;
    if (lastReport) {
      const lastReligion = religion(lastReport.values.Religion);
      if (religionChanged(lastReligion, snapshot.value) && compareFactDates(lastReport, snapshot.row) < 0) {
        // A later contradictory report establishes a real return to the snapshot's majority.
        observed = undefined;
      } else if (!observed && lastReligion !== undefined && !religionChanged(lastReligion, snapshot.value)) {
        // A localized snapshot may confirm an interval that already contains a dated change.
        observed = candidates.filter(entry => entry.value === lastReligion).at(-1);
      }
    }
    if (observed) observed.sources.push(...(lastReport ? rowSources(lastReport) : []), ...snapshot.sources);
    else changes.push(snapshot);
  }
  return changes.sort((a, b) => compareFactDates(a.row, b.row)).map(({ row, value, sources }) => {
    const support = uniqueSources(sources);
    return dated(row.source.turn, value === undefined ? {} : { [field]: fact(value, support) }, support);
  });
}

/** Collect recorded completions and observed changes within a continuously readable city history. */
function cityChanges(events: NewspaperEvent[], rows: NewspaperSnapshot[]) {
  const constructions: Change[] = [];
  const conversions: Change[] = [];
  const religionReports: NewspaperEvent[] = [];
  for (const event of events) {
    if (event.type === 'CityConstructed') {
      const building = event.values.Building;
      constructions.push({ row: event, value: typeof building === 'string' && building.trim() ? building : undefined,
        sources: rowSources(event) });
    } else if (event.type === 'CityConvertsReligion') {
      const previous = rows.filter(row => row.values.OwnerID === event.values.OwnerID && compareFactDates(row, event) < 0).at(-1);
      const lastReligionEvent = religionReports.at(-1);
      const previousEvent = lastReligionEvent?.values.OwnerID === event.values.OwnerID ? lastReligionEvent : undefined;
      const useEvent = previousEvent && (!previous || compareFactDates(previousEvent, previous) >= 0);
      const before = useEvent ? religion(previousEvent.values.Religion) : religion(previous?.values.MajorityReligion);
      const after = religion(event.values.Religion);
      const comparison = useEvent ? previousEvent : previous;
      // This hook also fires when only follower counts change. Its first report establishes a baseline.
      if (comparison && religionChanged(before, after)) conversions.push({ row: event, value: after,
        sources: [...rowSources(comparison), ...rowSources(event)] });
      religionReports.push(event);
    }
  }
  const wonders: SnapshotChange[] = [];
  const majorities: SnapshotChange[] = [];
  for (let i = 1; i < rows.length; i++) {
    const [before, now] = [rows[i - 1], rows[i]];
    const sources = [...rowSources(before), ...rowSources(now)];
    const oldWonders = recordedNames(before.values.Wonders);
    const newWonders = recordedNames(now.values.Wonders);
    if (oldWonders && newWonders) for (const name of new Set(newWonders)) {
      if (!oldWonders.includes(name)) wonders.push({ row: now, before, value: name, sources });
    }
    const oldReligion = religion(before.values.MajorityReligion);
    const newReligion = religion(now.values.MajorityReligion);
    if (newReligion === undefined) continue;
    const snapshot = { row: now, before, value: newReligion, sources };
    const lastReport = religionReports.filter(row => insideInterval(row, snapshot) && religion(row.values.Religion) !== undefined).at(-1);
    const returned = lastReport && compareFactDates(lastReport, now) < 0 && religionChanged(religion(lastReport.values.Religion), newReligion);
    if (religionChanged(oldReligion, newReligion) || returned) majorities.push({ ...snapshot, lastReligionReport: lastReport,
      sources: returned ? [...rowSources(lastReport), ...sources] : sources });
  }
  return { built: mergeChanges(constructions, wonders, 'building'), conversions: mergeChanges(conversions, majorities, 'religion') };
}

/** Build cutoff city facts and the date-indexed entries filtered by the trigger's window. */
export function buildCityFacts(row: NewspaperSnapshot, context: FactBuildContext): FactObject {
  const sources = rowSources(row);
  const fields: Record<string, FactField> = { ...buildCitySnapshotFacts(row, context) };
  const owner = recordedId(row.values.OwnerID);
  if (owner !== undefined) {
    fields.own = fact(owner === context.receiverId, sources);
    fields.foreign = fact(owner !== context.receiverId, sources);
  }
  const { own, capital, nearestOwn } = context.cityDistance(row);
  if (own || capital) fields.distance = fact({ ...(own && { own }), ...(capital && { capital }) }, sources);
  if (nearestOwn) fields.nearestOwn = nearestOwn;

  const history = [...new Map([...context.cityHistory(row), row].map(snapshot => [snapshot.source.id, snapshot])).values()]
    .sort((a, b) => compareFactDates(a, b) || a.source.id - b.source.id);
  const events = eventsForCity(row, context);
  const founders = events.filter(isFounding);
  const firstTurn = founders[0]?.source.turn ?? context.firstCityTurn(row);
  if (firstTurn !== undefined) {
    const first = history.find(snapshot => snapshot.source.turn === firstTurn);
    const support = founders.length ? founders.filter(event => event.source.turn === firstTurn).flatMap(rowSources)
      : first && first.source.id !== row.source.id ? rowSources(first) : [];
    fields.founded = fact(firstTurn, [...sources, ...support]);
  }
  const latest = events.filter(isCapture).at(-1);
  if (latest) {
    const captureSources = [...sources, ...rowSources(latest)];
    const capture: Record<string, FactField> = { turn: fact(latest.source.turn, captureSources) };
    const from = eventPlayerFact(latest.values.OldOwnerID, latest, context, captureSources);
    const by = eventPlayerFact(latest.values.NewOwnerID, latest, context, captureSources);
    const conquest = latest.type === 'CityFlipped' ? false : recordedBoolean(latest.values.IsConquest);
    if (from) capture.from = fields.formerOwner = from;
    if (by) capture.by = by;
    if (conquest !== undefined) capture.conquest = fact(conquest, captureSources);
    fields.captured = fact(capture, captureSources);
  } else {
    const formerOwner = observedFormerOwner(row, history, context);
    if (formerOwner) fields.formerOwner = formerOwner;
  }

  const { built, conversions } = cityChanges(events, history);
  const eventEntries = events.map(event => ({ turn: eventReportTurn(event),
    field: fact(reference('event', event.source.id), [...sources, ...rowSources(event)]) }))
    .sort((a, b) => a.turn - b.turn);
  fields.events = windowFacts(eventEntries, sources);
  fields.trained = windowFacts(events.filter(event => event.type === 'CityTrained')
    .map(event => trained(event, context.receiverId)), sources);
  fields.built = windowFacts(built, sources);
  fields.conversions = windowFacts(conversions, sources);
  if (context.evidence.tacticalPostureChanges) {
    const changes = context.evidence.tacticalPostureChanges.filter(change =>
      Math.abs(change.zoneID) === row.subjectID && change.city === row.values.Name
    );
    fields.tacticalPostureChanges = windowFacts(changes.map(change => dated(change.source.turn, {
      zoneID: fact(change.zoneID, [change.source]),
      domain: fact(change.domain, [change.source]),
      posture: fact(change.posture, [change.source]),
      previousPosture: fact(change.previousPosture.posture, [change.previousPosture.source]),
      ...(owner === undefined ? {} : { owner: fact(reference('player', owner, change.source.turn), sources) }),
      receiver: fact(reference('player', context.receiverId, change.source.turn))
    }, [change.source, change.previousPosture.source])), sources);
  }
  return fields;
}
