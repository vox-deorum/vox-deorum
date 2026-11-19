/** Hex distances on Civilization V's offset rows. */
import type { NewspaperSnapshot } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { fact, reference, rowSources, type CityDistance, type FactMetadata, type Plot } from './model.js';

/** Validated wrap periods. A zero means that axis does not wrap. */
export interface MapWrap { x: number; y: number }

/** Read a dimension from typed metadata or the archive's string storage. */
function dimension(value: unknown): number | undefined {
  const size = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof size === 'number' && Number.isSafeInteger(size) && size > 0 ? size : undefined;
}

/** Read a flag without treating arbitrary nonempty strings as true. */
function flag(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/** Incomplete or invalid settings fall back to the geometry older recordings used. */
export function mapWrap(metadata: FactMetadata): MapWrap {
  const width = dimension(metadata.mapWidth);
  const height = dimension(metadata.mapHeight);
  const wrapX = flag(metadata.mapWrapX);
  const wrapY = flag(metadata.mapWrapY);
  return width && height && wrapX !== undefined && wrapY !== undefined
    ? { x: wrapX ? width : 0, y: wrapY ? height : 0 }
    : { x: 0, y: 0 };
}

/** Read only valid plot coordinates from a snapshot or an expression's plot. */
export function plot(x: unknown, y: unknown): Plot | undefined {
  if (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 &&
      typeof y === 'number' && Number.isSafeInteger(y) && y >= 0) return { x, y };
  return undefined;
}

/** Count hex steps using the nearest periodic image. Also called inside QuickJS. */
export function hexDistance(a: Plot, b: Plot, wrap: MapWrap): number {
  const dq = b.x - Math.floor(b.y / 2) - (a.x - Math.floor(a.y / 2));
  const dr = b.y - a.y;
  const row = wrap.y ? Math.round(dr / wrap.y) : 0;
  const steps = wrap.y ? 1 : 0;
  let closest = Infinity;
  for (let shift = row - steps; shift <= row + steps; shift++) {
    const r = dr - shift * wrap.y;
    let q = dq + shift * Math.floor(wrap.y / 2);
    if (wrap.x) q -= Math.round((q + r / 2) / wrap.x) * wrap.x;
    closest = Math.min(closest, Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)));
  }
  return closest;
}

/** Find the closest pair between two plot sets, retaining each selected entry. */
export function nearestPlotPair<A extends Plot, B extends Plot>(a: readonly A[], b: readonly B[], wrap: MapWrap) {
  let best: { distance: number; from: A; to: B } | undefined;
  for (const from of a) for (const to of b) {
    const distance = hexDistance(from, to, wrap);
    if (!best || distance < best.distance) best = { distance, from, to };
  }
  return best;
}

/** Pair each usable city plot with the recorded row that supplies it. */
function cityPlots(rows: readonly NewspaperSnapshot[]) {
  return rows.flatMap(row => {
    const point = plot(row.values.X, row.values.Y);
    return point ? [{ ...point, row }] : [];
  });
}

/** Index the receiver's readable coordinates for cutoff or dated inference. */
export function distanceContext(
  cities: readonly NewspaperSnapshot[],
  receiverId: number,
  wrap: MapWrap
) {
  const owned = cities.filter(row => row.values.OwnerID === receiverId);
  const capitals = owned.filter(row => row.values.IsCapital === true || row.values.IsCapital === 1);
  const capital = capitals.length === 1 ? capitals[0] : undefined;
  const capitalPlot = plot(capital?.values.X, capital?.values.Y);
  const located = cityPlots(owned);

  /** Identify the closest readable city, with city ID breaking ties. */
  function closest(point: Plot) {
    const nearest = nearestPlotPair([point], located, wrap);
    return nearest && { row: nearest.to.row, distance: nearest.distance };
  }

  /** Compute a plot's distances and cite the actual cities used in the calculation. */
  function distanceFromPlot(point: Plot, origin?: NewspaperSnapshot): CityDistance {
    const result: CityDistance = {};
    const sources = origin ? rowSources(origin) : [];
    const nearest = origin?.values.OwnerID === receiverId ? { row: origin, distance: 0 } : closest(point);
    if (nearest) {
      const nearestSources = [...sources, ...rowSources(nearest.row)];
      result.own = fact(nearest.distance, nearestSources);
      result.nearestOwn = fact(reference('city', nearest.row.subjectID), nearestSources);
    }
    if (capital && capitalPlot)
      result.capital = fact(hexDistance(point, capitalPlot, wrap), [...sources, ...rowSources(capital)]);
    return result;
  }

  /** Compute city distances; a city known to be ours is its own nearest city. */
  function cityDistance(row: NewspaperSnapshot): CityDistance {
    const point = plot(row.values.X, row.values.Y);
    if (point) return distanceFromPlot(point, row);
    if (row.values.OwnerID !== receiverId) return {};
    const sources = rowSources(row);
    return { own: fact(0, sources), nearestOwn: fact(reference('city', row.subjectID), sources) };
  }

  /** Find the closest readable pair for another player's distance to the receiver. */
  function playerDistance(rows: readonly NewspaperSnapshot[]) {
    const nearest = nearestPlotPair(cityPlots(rows), located, wrap);
    return nearest && fact(nearest.distance, [...rowSources(nearest.from.row), ...rowSources(nearest.to.row)]);
  }

  return { distanceFromPlot, cityDistance, playerDistance };
}
