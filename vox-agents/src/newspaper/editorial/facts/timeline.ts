/** Index visible observations without carrying them through visibility or lifecycle gaps. */
import type { NewspaperEvent, NewspaperEvidence, NewspaperSnapshot } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { plot } from './distance.js';
import { compareFactDates, eventPlot, isCapture, isFounding } from './event-city.js';

export interface Observation {
  turn: number;
  row?: NewspaperSnapshot;
  segment?: number;
}
type Subject = 'cities' | 'players';
type Timeline = ReadonlyMap<number, readonly Observation[]>;

/** Index the readable lifecycle events by plot, where they can explain an ownership change. */
function cityLifecycle(events: readonly NewspaperEvent[]): Map<string, NewspaperEvent[]> {
  const plots = new Map<string, NewspaperEvent[]>();
  for (const event of events) {
    if (event.type !== 'CityRazed' && !isCapture(event) && !isFounding(event)) continue;
    const position = eventPlot(event);
    if (!position) continue;
    const key = `${position.x}/${position.y}`;
    const atPlot = plots.get(key) ?? [];
    atPlot.push(event);
    plots.set(key, atPlot);
  }
  for (const atPlot of plots.values()) atPlot.sort((a, b) => compareFactDates(a, b) || a.source.id - b.source.id);
  return plots;
}

/** Decide whether two observations with the same original key describe the same city. */
function continuesCity(old: NewspaperSnapshot, next: NewspaperSnapshot, plots: ReturnType<typeof cityLifecycle>): boolean {
  const position = plot(next.values.X, next.values.Y);
  if (!position || old.values.X !== position.x || old.values.Y !== position.y) return false;
  const events = plots.get(`${position.x}/${position.y}`) ?? [];
  const lifecycle = events.filter(event => compareFactDates(event, old) >= 0 && compareFactDates(event, next) <= 0);
  if (lifecycle.some(event => (event.type === 'CityRazed' || isFounding(event)) &&
    compareFactDates(event, old) > 0)) return false;
  const from = old.values.OwnerID;
  const to = next.values.OwnerID;
  if (typeof from !== 'number' || typeof to !== 'number') return false;
  if (from === to) return true;
  // A change in a continuously readable city can name the former owner without a capture hook.
  const name = old.values.Name;
  if (typeof name === 'string' && name.trim() && name === next.values.Name) return true;
  let owner = from;
  for (const event of lifecycle) {
    const successor = event.values.NewOwnerID;
    if (isCapture(event) && event.values.OldOwnerID === owner && typeof successor === 'number') owner = successor;
  }
  return owner === to;
}

/** Add a per-turn row or barrier, treating the projected cutoff as authoritative. */
export function buildTimeline(evidence: NewspaperEvidence, subject: Subject, events: readonly NewspaperEvent[]): Timeline {
  const { history, request } = evidence;
  const rows = new Map<number, Map<number, NewspaperSnapshot | undefined>>();
  /** Preserve the final projected observation for each date. */
  function record(id: number, turn: number, row?: NewspaperSnapshot): void {
    const dates = rows.get(id) ?? new Map<number, NewspaperSnapshot | undefined>();
    dates.set(turn, row);
    rows.set(id, dates);
  }
  if (history) {
    for (const row of history.baseline[subject]) record(row.subjectID, history.fromTurn, row);
    for (const row of history.snapshots[subject]) record(row.subjectID, row.source.turn, row);
    const table = subject === 'cities' ? 'CityInformations' : 'PlayerSummaries';
    for (const gap of history.gaps)
      if (gap.table === table) record(gap.subjectID, gap.turn);
  }
  const cutoffRows = new Map(evidence[subject].map(row => [row.subjectID, row]));
  for (const id of new Set([...rows.keys(), ...cutoffRows.keys()])) {
    const row = cutoffRows.get(id);
    const prior = latest(rows.get(id), request.cutoffTurn);
    // A dated grant can change the projection while the underlying observation stays the same.
    if (row && (!prior || prior.source.id !== row.source.id ||
      JSON.stringify([prior.values, prior.relatedSources]) !== JSON.stringify([row.values, row.relatedSources])))
      record(id, request.cutoffTurn, row);
    else if (!row && prior)
      record(id, request.cutoffTurn);
  }
  if (subject === 'players') rows.delete(63);
  const result = new Map<number, Observation[]>();
  const lifecycle = cityLifecycle(subject === 'cities' ? events : []);
  for (const [id, dates] of [...rows].sort(([a], [b]) => a - b)) {
    let segment = 0;
    let prior: NewspaperSnapshot | undefined;
    const entries: Observation[] = [];
    for (const [turn, row] of [...dates].sort(([a], [b]) => a - b)) {
      if (subject === 'cities' && prior && (!row || entries.at(-1)?.row && !continuesCity(prior, row, lifecycle)))
        segment++;
      entries.push(row ? { turn, row, segment } : { turn });
      if (row) prior = row;
    }
    result.set(id, entries);
  }
  return result;
}

/** Find the most recent projection, leaving a visibility gap undefined. */
function latest(rows: ReadonlyMap<number, NewspaperSnapshot | undefined> | undefined, turn: number): NewspaperSnapshot | undefined {
  let date = -Infinity;
  let latestRow: NewspaperSnapshot | undefined;
  for (const [candidate, row] of rows ?? []) {
    if (candidate <= turn && candidate > date) {
      date = candidate;
      latestRow = row;
    }
  }
  return latestRow;
}

/** Resolve a subject's latest observation or gap at a recorded turn. */
function asOf(entries: readonly Observation[], turn: number): Observation | undefined {
  let start = 0;
  let end = entries.length;
  while (start < end) {
    const mid = (start + end) >>> 1;
    if (entries[mid].turn <= turn) start = mid + 1;
    else end = mid;
  }
  return entries[start - 1];
}

/** Return the readable row at this date, if the subject had one. */
export function observedAt(timeline: Timeline, id: number, turn: number): NewspaperSnapshot | undefined {
  return asOf(timeline.get(id) ?? [], turn)?.row;
}

/** List only dated subjects with readable rows, in original ID order. */
export function rowsAt(timeline: Timeline, turn: number): NewspaperSnapshot[] {
  const rows: NewspaperSnapshot[] = [];
  for (const entries of timeline.values()) {
    const row = asOf(entries, turn)?.row;
    if (row) rows.push(row);
  }
  return rows;
}
