import type { Selectable } from 'kysely';
import type { CityInformation, GameEvent } from '../knowledge/schema/timed.js';
import type { NewspaperSourceReference } from './evidence.js';
import type { NewspaperCityProjectionContext } from './projection.js';

type CityRecord = Selectable<CityInformation>;
/** Fields a city join needs, allowing the query to omit full snapshots and other receivers' access flags. */
export type NewspaperCityObservation = Pick<CityRecord, 'ID' | 'Key' | 'Turn' | 'CreatedAt' | 'Owner' | 'Name' | 'X' | 'Y'> &
  Partial<Pick<CityRecord, keyof CityRecord & `Player${number}`>>;
type CityRow = NewspaperCityObservation;
type EventRow = Selectable<GameEvent>;
type DatedRow = Pick<CityRow, 'Turn' | 'CreatedAt'>;

/** Capture original row identity and dates before metadata is discarded. */
export function source(table: NewspaperSourceReference['table'], row: DatedRow & { ID: number }): NewspaperSourceReference {
  return { table, id: row.ID, turn: row.Turn, createdAt: row.CreatedAt };
}

/** Read recorded access without the live visibility helper's missing-summary fallback. */
export function visibility(row: Record<string, unknown> | undefined, receiver: number): number | undefined {
  const level = row?.[`Player${receiver}`];
  return typeof level === 'number' ? level : undefined;
}

/** Check dated contact, treating the barbarian slot as known without a national summary. */
export function knowsPlayer(id: unknown, context: NewspaperCityProjectionContext): boolean {
  return id === 63 || (typeof id === 'number' && (visibility(context.summaries.find(row => row.Key === id), context.receiverPlayerID) ?? 0) > 0);
}

/** Compare cross-table dates. Insertion IDs cannot order a snapshot against an event. */
function compareDates(a: DatedRow, b: DatedRow): number {
  return a.Turn - b.Turn || a.CreatedAt - b.CreatedAt;
}

/** Break a same-second tie only within one table. */
function compareRows(a: DatedRow & { ID: number }, b: DatedRow & { ID: number }): number {
  return compareDates(a, b) || a.ID - b.ID;
}

/** Require actual map coordinates, including 0 but excluding sentinel positions. */
function plotKey(x: unknown, y: unknown): string | undefined {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && typeof y === 'number' && Number.isInteger(y) && y >= 0
    ? `${x},${y}` : undefined;
}

/** Preserve every observation at a plot or sharing a per-owner city ID, newest first. */
function indexRows<K, T extends DatedRow & { ID: number }>(rows: readonly T[], keyFor: (row: T) => K | undefined): Map<K, T[]> {
  const index = new Map<K, T[]>();
  for (const row of [...rows].sort((a, b) => compareRows(b, a))) {
    const key = keyFor(row);
    if (key === undefined) continue;
    const existing = index.get(key);
    if (existing) existing.push(row);
    else index.set(key, [row]);
  }
  return index;
}

const cityIndexes = new WeakMap<readonly CityRow[], { byID: Map<number, CityRow[]>; byPlot: Map<string, CityRow[]> }>();
const lifecycleIndexes = new WeakMap<readonly EventRow[], { byPlot: Map<string, EventRow[]>; flips: Map<unknown, EventRow[]> }>();

/** Index a query's city observations once for both kinds of joins. */
function cityIndex(rows: readonly CityRow[] | undefined) {
  if (!rows) return undefined;
  const cached = cityIndexes.get(rows);
  if (cached) return cached;
  const index = { byID: indexRows(rows, row => row.Key), byPlot: indexRows(rows, row => plotKey(row.X, row.Y)) };
  cityIndexes.set(rows, index);
  return index;
}

/** Use only the recorded plot of a lifecycle event. CityFlipped refers to its old owner's ID. */
function lifecycleIndex(rows: readonly EventRow[] | undefined) {
  if (!rows) return undefined;
  const cached = lifecycleIndexes.get(rows);
  if (cached) return cached;
  const index = {
    byPlot: indexRows(rows, ({ Type, Payload }) => Type === 'PlayerCityFounded' || Type === 'UnitCityFounded' ? plotKey(Payload.PlotX, Payload.PlotY) :
      Type === 'CityCaptureComplete' || Type === 'CityRazed' ? plotKey(Payload.CityX, Payload.CityY) : undefined),
    flips: indexRows(rows, ({ Type, Payload }) => Type === 'CityFlipped' ? Payload.CityID : undefined)
  };
  lifecycleIndexes.set(rows, index);
  return index;
}

/** Require a permitted city observation even when it is only used to join a plot. */
function canReadCity(row: CityRow, context: NewspaperCityProjectionContext): boolean {
  const level = visibility(row, context.receiverPlayerID);
  return level === 1 || level === 2;
}

/** An event that the receiver could not see supplies neither an ownership anchor nor a lifecycle boundary. */
function canReadEvent(event: EventRow, context: NewspaperCityProjectionContext): boolean {
  return (visibility(event, context.receiverPlayerID) ?? 0) > 0;
}

/** Resolve a city-state at this observation by recorded transfers or a unique city-state name. */
export function cityOwner(row: CityRow, context: NewspaperCityProjectionContext): { id: number; event?: EventRow } | undefined {
  if (!canReadCity(row, context)) return undefined;
  if (row.Owner !== 'City-States') {
    const owners = context.players.filter(player => (player.IsMajor === 1 || player.Key === 63) && player.Civilization === row.Owner);
    return owners.length === 1 && knowsPlayer(owners[0].Key, context) ? { id: owners[0].Key } : undefined;
  }

  const plot = plotKey(row.X, row.Y);
  if (plot === undefined) return undefined;
  const earlier = cityIndex(context.cityHistory)?.byPlot.get(plot) ?? [];
  const boundary = earlier.find(other => compareRows(other, row) < 0 &&
    (!canReadCity(other, context) || other.Owner !== 'City-States' || other.Key !== row.Key));
  const lifecycle = lifecycleIndex(context.cityLifecycle)?.byPlot.get(plot) ?? [];
  const anchor = lifecycle.find(event => compareDates(event, row) <= 0 && canReadEvent(event, context));
  if (anchor && (!boundary || compareDates(anchor, boundary) > 0)) {
    if (compareDates(anchor, row) === 0 || anchor.Type === 'CityRazed') return undefined;
    const id = anchor.Type === 'CityCaptureComplete' ? anchor.Payload.NewOwnerID : anchor.Payload.PlayerID;
    if (typeof id !== 'number' || id === 63 || !knowsPlayer(id, context) || !context.knowsLifecyclePlayer?.(anchor, id) ||
      !context.players.some(player => player.Key === id && player.IsMajor === 0)) return undefined;
    return { id, event: anchor };
  }
  if (boundary) return undefined;
  const names = context.players.filter(player => player.IsMajor === 0 && player.Key !== 63 && player.Civilization === row.Name);
  return names.length === 1 && knowsPlayer(names[0].Key, context) ? { id: names[0].Key } : undefined;
}

/** Join a city within its recorded owner, date and lifetime. Leave simultaneous or competing observations unresolved. */
export function cityAtEvent(event: EventRow, id: unknown, ownerID: unknown, context: NewspaperCityProjectionContext):
  { row: CityRow; ownerEvent?: EventRow } | undefined {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || !knowsPlayer(ownerID, context)) return undefined;
  const cities = cityIndex(context.cityHistory);
  const rows = cities?.byID.get(id) ?? [];
  const lifecycle = lifecycleIndex(context.cityLifecycle);
  const seen = new Set<string>();
  let found: { row: CityRow; ownerEvent?: EventRow } | undefined;
  for (const row of rows) {
    if (compareDates(row, event) > 0) continue;
    const plot = plotKey(row.X, row.Y);
    if (plot === undefined) return undefined;
    if (seen.has(plot)) continue;
    seen.add(plot);
    const owner = cityOwner(row, context);
    if (owner && owner.id !== ownerID) continue;
    const newer = cities?.byPlot.get(plot)?.find(other => compareDates(other, event) <= 0);
    if (newer && compareRows(newer, row) > 0) {
      if (!canReadCity(newer, context) || compareDates(newer, event) === 0) return undefined;
      continue;
    }
    const change = lifecycle?.byPlot.get(plot)?.find(change => compareRows(change, event) < 0 &&
      compareDates(change, row) >= 0 && canReadEvent(change, context));
    const flip = lifecycle?.flips.get(id)?.find(flip => flip.Payload.OldOwnerID === ownerID && compareRows(flip, event) < 0 &&
      compareDates(flip, row) >= 0 && canReadEvent(flip, context));
    if (change || flip) {
      if ((change && compareDates(change, row) === 0) || (flip && compareDates(flip, row) === 0)) return undefined;
      continue;
    }
    if (found || !owner || compareDates(row, event) === 0) return undefined;
    found = { row, ownerEvent: owner.event };
  }
  return found;
}
