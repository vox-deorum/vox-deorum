/** Serializable facts and the dated, visibility filtered inputs used to build them. */
import type {
  NewspaperEvent,
  NewspaperEvidence,
  NewspaperSnapshot,
  NewspaperSourceReference,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { isRecord } from '../../../utils/guards.js';

export type FactKind = 'city' | 'player' | 'event' | 'pair' | 'incident';
export type FactReference = {
  readonly $kind: 'reference';
  readonly kind: FactKind;
  readonly id: number | string;
  readonly turn?: number;
};
export interface FactWindow {
  readonly $kind: 'window';
  readonly entries: readonly { turn: number; field: FactField }[];
}
interface FactElapsed {
  readonly $kind: 'elapsed';
  readonly since: number;
}
interface FactAnchoredPair {
  readonly $kind: 'anchoredPair';
  readonly id: string;
  readonly turn: number;
  readonly fields: FactObject;
}
export type FactValue = null | boolean | number | string | readonly FactValue[] | FactObject |
  FactReference | FactWindow | FactElapsed | FactAnchoredPair;
export interface FactField {
  readonly value: FactValue;
  readonly sources?: readonly NewspaperSourceReference[];
}
export interface FactObject {
  readonly [name: string]: FactField;
}

/** Add provenance to a readable value. Omit the field altogether when it is unknown. */
export function fact(value: FactValue, sources?: readonly NewspaperSourceReference[]): FactField {
  return sources?.length ? { value, sources } : { value };
}

/** Link to a subject visible at the containing fact's turn or an explicitly dated turn. */
export function reference(kind: FactKind, id: number | string, turn?: number): FactReference {
  return { $kind: 'reference', kind, id, ...(turn === undefined ? {} : { turn }) };
}

/** Keep window entries dated until the runner selects the group's reporting window. */
export function windowFacts(entries: FactWindow['entries'], sources?: FactField['sources']): FactField {
  return fact({ $kind: 'window', entries }, sources);
}

/** Cite the observation and the visible rows its projection joined. */
export function rowSources(row: NewspaperSnapshot | NewspaperEvent): NewspaperSourceReference[] {
  return [row.source, ...row.relatedSources ?? []];
}

/** Convert permitted recorded JSON into fact data without copying unsupported values. */
export function recordedFact(value: unknown, sources?: FactField['sources']): FactField | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))) return fact(value, sources);
  if (Array.isArray(value)) {
    const items: FactValue[] = [];
    for (const item of value) {
      const converted = recordedFact(item);
      if (!converted) return undefined;
      items.push(converted.value);
    }
    return fact(items, sources);
  }
  if (!isRecord(value)) return undefined;
  const members: Record<string, FactField> = Object.create(null);
  for (const [name, member] of Object.entries(value)) {
    const converted = recordedFact(member);
    if (converted) members[name] = converted;
  }
  return fact(members, sources);
}

/** Archive metadata available to the internal builder; raw geometry is never a fact. */
export interface FactMetadata {
  gameSpeed?: string;
  speedMultiplier?: number;
  mapSize?: string;
  startEra?: string;
  maxTurns?: number;
  mapWidth?: unknown;
  mapHeight?: unknown;
  mapWrapX?: unknown;
  mapWrapY?: unknown;
  recordingStartTurn?: number;
  playerIdentities?: Readonly<Record<string, {
    name?: string;
    leader?: string;
    teamId?: number;
    major?: boolean;
    human?: boolean;
  }>>;
}

export interface Plot { x: number; y: number }

export interface CityDistance {
  own?: FactField;
  capital?: FactField;
  nearestOwn?: FactField;
}

/** Dated evidence access shared by builders; current-only inference runs at the cutoff. */
export interface FactBuildContext {
  readonly evidence: NewspaperEvidence;
  readonly metadata: FactMetadata;
  readonly receiverId: number;
  readonly turn: number;
  /** Effective ideology branch names from the catalogue constants. */
  readonly ideologies?: readonly string[];
  readonly players: readonly NewspaperSnapshot[];
  readonly cities: readonly NewspaperSnapshot[];
  readonly events: readonly NewspaperEvent[];
  firstCityTurn(row: NewspaperSnapshot): number | undefined;
  cityHistory(row: NewspaperSnapshot): readonly NewspaperSnapshot[];
  playerAt(id: number, turn: number): NewspaperSnapshot | undefined;
  cityDistance(row: NewspaperSnapshot): CityDistance;
  distanceFromPlot(plot: Plot): CityDistance;
  playerDistance(ownedCities: readonly NewspaperSnapshot[]): FactField | undefined;
}
