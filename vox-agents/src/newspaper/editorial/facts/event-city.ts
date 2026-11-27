import type { NewspaperEvent, NewspaperSnapshot } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { newspaperEventConfigs } from '../../../../../mcp-server/dist/newspaper/projection.js';
import { isRecord } from '../../../utils/guards.js';
import { plot as factPlot } from './distance.js';
import type { FactBuildContext, Plot } from './model.js';

type CityTarget = { plot: Plot; field?: string; id?: number; owner?: number };
type AtPlot = { cities: NewspaperSnapshot[]; events: { event: NewspaperEvent; target: CityTarget }[]; lifecycle: NewspaperEvent[] };
const plotIndexes = new WeakMap<FactBuildContext, Map<string, AtPlot>>();

/** Select the server's reporting metadata for a supported event. */
export function eventConfig(type: string) {
  return Object.hasOwn(newspaperEventConfigs, type) ? newspaperEventConfigs[type] : undefined;
}

/** Read a nonnegative recorded player or city ID. */
export function recordedId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Read recorded text names without treating a hidden or malformed list as empty. */
export function recordedNames(value: unknown): string[] | undefined {
  // The Lua serializer represents a known empty list as an empty object.
  if (isRecord(value) && !Object.keys(value).length) return [];
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}

/** Compare rows by turn and timestamp. Insertion IDs cannot order rows from different tables. */
export function compareFactDates(a: NewspaperEvent | NewspaperSnapshot, b: NewspaperEvent | NewspaperSnapshot): number {
  return a.source.turn - b.source.turn || a.source.createdAt - b.source.createdAt;
}

/** Read the event's main projected location, when present. */
export function eventPlot(event: NewspaperEvent): Plot | undefined {
  return factPlot(event.values.CityX, event.values.CityY) ?? factPlot(event.values.PlotX, event.values.PlotY);
}

/** Both founding hooks record a plot and its founding player. */
export function isFounding(event: NewspaperEvent): boolean {
  return event.type === 'PlayerCityFounded' || event.type === 'UnitCityFounded';
}

/** Both capture hooks record the old and new owners of the city. */
export function isCapture(event: NewspaperEvent): boolean {
  return event.type === 'CityCaptureComplete' || event.type === 'CityFlipped';
}

/** Test whether an observation or event has the named coordinates. */
export function onPlot(plot: Plot, other: Plot | undefined): boolean {
  return plot.x === other?.x && plot.y === other.y;
}

/** Read only positions already permitted by projection; a bare city ID cannot resolve a plot. */
export function eventCityTargets(event: NewspaperEvent): { main?: CityTarget; named: CityTarget[] } {
  const { type, values } = event;
  const config = eventConfig(type);
  const fields = Object.entries(config?.cityIDs ?? {});
  const named: CityTarget[] = [];
  for (const [key, owner] of fields) {
    const field = key.slice(0, -2);
    const plot = fields.length === 1 ? eventPlot(event) : factPlot(values[`${field}X`], values[`${field}Y`]);
    if (plot) named.push({ plot, field, id: recordedId(values[key]), owner: recordedId(values[owner]) });
  }
  if (fields.length) {
    // A trade route has two separate endpoints and no primary city.
    const mainField = (config?.mainCityID ?? (fields.length === 1 ? fields[0][0] : undefined))?.slice(0, -2);
    return { main: named.find(target => target.field === mainField), named };
  }
  const plot = eventPlot(event);
  if (!plot) return { named };
  const main = {
    plot,
    ...(type === 'CityCaptureComplete' ? { id: recordedId(values.CityID), owner: recordedId(values.NewOwnerID) } : {}),
    ...(isFounding(event) || type === 'CityRazed' || type === 'CityBeginsWLTKD' ? { owner: recordedId(values.PlayerID) } : {}),
    ...(type === 'CityConvertsReligion' ? { owner: recordedId(values.OwnerID) } : {}),
  };
  return { main, named };
}

/** Key a projected plot for one check. */
function plotKey(plot: Plot): string {
  return `${plot.x}/${plot.y}`;
}

/** Group dated events and current cities at their projected plots once per context. */
function atPlot(context: FactBuildContext, plot: Plot): AtPlot | undefined {
  let index = plotIndexes.get(context);
  if (!index) {
    const plots = new Map<string, AtPlot>();
    /** Allocate a plot index only when a readable row names it. */
    const entry = (position: Plot): AtPlot => {
      const key = plotKey(position);
      const known = plots.get(key);
      if (known) return known;
      const value: AtPlot = { cities: [], events: [], lifecycle: [] };
      plots.set(key, value);
      return value;
    };

    for (const city of context.cities) {
      const position = factPlot(city.values.X, city.values.Y);
      if (position) entry(position).cities.push(city);
    }
    for (const event of context.events) {
      const { main, named } = eventCityTargets(event);
      for (const target of main && !main.field ? [main, ...named] : named) entry(target.plot).events.push({ event, target });
      const position = eventPlot(event);
      if (position && (isFounding(event) || isCapture(event) || event.type === 'CityRazed')) entry(position).lifecycle.push(event);
    }
    index = plots;
    plotIndexes.set(context, index);
  }
  return index.get(plotKey(plot));
}

/** Select permitted events that name this city or its plot, preserving their chronological order. */
export function eventsForCity(city: NewspaperSnapshot, context: FactBuildContext): NewspaperEvent[] {
  const plot = factPlot(city.values.X, city.values.Y);
  if (!plot) return [];
  const records = atPlot(context, plot)?.events ?? [];
  const events = records.filter(({ event, target }) => resolveEventCity(event, target, context) === city).map(({ event }) => event);
  return [...new Set(events)].sort((a, b) => compareFactDates(a, b) || a.source.id - b.source.id);
}

/** Resolve the current city only when the projected location and dated evidence support the join. */
export function resolveEventCity(event: NewspaperEvent, target: CityTarget, context: FactBuildContext): NewspaperSnapshot | undefined {
  const plot = atPlot(context, target.plot);
  if (!plot || plot.cities.length !== 1) return undefined;
  const city = plot.cities[0];
  const founding = isFounding(event);
  const capture = isCapture(event);
  const established = founding || capture;
  const owner = recordedId(city.values.OwnerID);
  let expected = event.type === 'CityFlipped' ? recordedId(event.values.NewOwnerID) : target.owner;
  const transferTurns = new Set<number>(capture ? [event.source.turn] : []);
  let lastTransfer = capture ? event : undefined;

  for (const change of plot.lifecycle) {
    const order = compareFactDates(change, event) || change.source.id - event.source.id;
    if (order <= 0) continue;
    if (change.type === 'CityRazed') return undefined;
    if (isFounding(change)) {
      if (founding && change.type !== event.type && change.source.turn === event.source.turn &&
        change.values.PlayerID !== undefined && change.values.PlayerID === event.values.PlayerID) continue;
      return undefined;
    }
    const oldOwner = recordedId(change.values.OldOwnerID);
    const newOwner = recordedId(change.values.NewOwnerID);
    if (oldOwner === undefined || newOwner === undefined) return undefined;
    // A revolt can also emit CityCaptureComplete for the same transfer.
    if (lastTransfer && lastTransfer.source.turn === change.source.turn && lastTransfer.type !== change.type &&
      lastTransfer.values.OldOwnerID === oldOwner && lastTransfer.values.NewOwnerID === newOwner) continue;
    if (expected !== undefined && oldOwner !== expected) return undefined;
    expected = newOwner;
    transferTurns.add(change.source.turn);
    lastTransfer = change;
  }

  if (event.type === 'CityRazed' || (expected !== undefined && expected !== owner) ||
    (lastTransfer && (expected === undefined || owner !== expected || compareFactDates(city, lastTransfer) < 0))) return undefined;
  const transferred = lastTransfer !== undefined && lastTransfer !== event;
  if (!transferred && event.type !== 'CityFlipped' && target.id !== undefined && city.subjectID !== target.id) return undefined;
  const gap = context.evidence.history?.gaps.some(row => row.table === 'CityInformations' &&
    (row.subjectID === city.subjectID || row.subjectID === target.id) && row.turn >= event.source.turn &&
    row.turn <= context.turn && !transferTurns.has(row.turn));
  if (gap) return undefined;
  if (established) return compareFactDates(city, event) >= 0 ? city : undefined;

  // An ordinary event on the plot requires an already observed city. For ID joins, MCP's
  // dated position is itself an observation, unless a later visibility gap breaks the link.
  if (context.cityHistory(city).some(row => compareFactDates(row, event) <= 0)) return city;
  const positionJoin = target.id !== undefined && event.relatedSources?.some(source => source.table === 'CityInformations');
  if (!positionJoin) return undefined;
  const reused = !transferred && context.evidence.history?.snapshots.cities.some(row => row.subjectID === target.id &&
    compareFactDates(row, event) >= 0 && compareFactDates(row, city) <= 0 &&
    (!onPlot(target.plot, factPlot(row.values.X, row.values.Y)) || (target.owner !== undefined && row.values.OwnerID !== target.owner)));
  return reused ? undefined : city;
}
