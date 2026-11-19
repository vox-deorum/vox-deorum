import type { Selectable } from 'kysely';
import type { GameEvent } from '../knowledge/schema/timed.js';
import type { NewspaperEvent, NewspaperSourceReference } from './evidence.js';
import { source } from './recorded-city.js';

type EventRow = Selectable<GameEvent>;
type Payload = Record<string, unknown>;

const spyResultNames = ['Undetected', 'Detected', 'Identified', 'Killed', 'KilledNotIdentified'] as const;
type SpyResultName = (typeof spyResultNames)[number];
type Operation = { row: EventRow; sourceID: number; targetID: number; result: SpyResultName };

const revealingResults = new Set<SpyResultName>(['Identified', 'Killed']);
const electionTypes = new Set(['ElectionResultSuccess', 'ElectionResultFailure']);

/** Inputs for private operation and election projection from bounded recorded rows. */
export interface EspionageProjectionInput {
  receiverPlayerID: number;
  players: readonly { Key: number; TeamID: number }[];
  /** Recorded operations and elections in the read window. */
  rows: readonly EventRow[];
  /** PlayerDoTurn markers from the operation turns and the following turn. */
  playerTurns: readonly EventRow[];
  /** TeamTechResearched rows on the operation turns. */
  techGains: readonly EventRow[];
  /** City capture, raze and flip rows from the operation window. */
  cityLosses: readonly EventRow[];
}

/** Project operations and elections only for their exact recorded parties. */
export function projectEspionageEvidence(input: EspionageProjectionInput): NewspaperEvent[] {
  const operations = input.rows.flatMap(row => {
    const operation = readOperation(row);
    return operation ? [operation] : [];
  });
  const technology = projectTechnologyGains(operations, input.techGains, input.players);
  const projected: NewspaperEvent[] = [];
  for (const operation of operations) {
    const event = projectOperation(operation, input, technology);
    if (event) projected.push(event);
  }
  for (const row of input.rows) {
    if (!electionTypes.has(row.Type)) continue;
    const event = projectElection(row, input.receiverPlayerID);
    if (event) projected.push(event);
  }
  return projected;
}

/** Accept a recorded queue row with both parties and a named or numeric outcome. */
function readOperation(row: EventRow): Operation | undefined {
  if (row.Type !== 'EspionageResult') return undefined;
  const { SpyResult, SourcePlayerID, TargetPlayerID } = row.Payload;
  const sourceID = playerID(SourcePlayerID);
  const targetID = playerID(TargetPlayerID);
  const result = typeof SpyResult === 'number' && Number.isInteger(SpyResult)
    ? spyResultNames[SpyResult] : spyResultNames.find(name => name === SpyResult);
  if (!result || sourceID === undefined || targetID === undefined || sourceID === targetID) return undefined;
  return { row, sourceID, targetID, result };
}

/** Find the unique named positive gain for each source operation, checking both directions. */
function projectTechnologyGains(
  operations: readonly Operation[], gains: readonly EventRow[], players: readonly { Key: number; TeamID: number }[]
): Map<number, EventRow> {
  const teams = new Map(players.map(player => [player.Key, player.TeamID]));
  const byID = new Map(gains.filter(isPositiveNamedGain).map(gain => [gain.ID, gain]));
  const uniqueByOperation = new Map<number, EventRow>();
  const operationCountByGain = new Map<number, number>();
  for (const { row, sourceID } of operations) {
    const team = teams.get(sourceID);
    if (team === undefined || team < 0) continue;
    const matches: EventRow[] = [];
    for (let id = row.ID + 1; id <= row.ID + 10; id++) {
      const gain = byID.get(id);
      if (!gain || gain.Payload.TeamID !== team || gain.Turn !== row.Turn) continue;
      matches.push(gain);
      operationCountByGain.set(id, (operationCountByGain.get(id) ?? 0) + 1);
    }
    if (matches.length === 1) uniqueByOperation.set(row.ID, matches[0]);
  }
  return new Map([...uniqueByOperation].filter(([, gain]) => operationCountByGain.get(gain.ID) === 1));
}

/** Check for a positive, named research change that can be attributed to an operation. */
function isPositiveNamedGain(row: EventRow): boolean {
  if (row.Type !== 'TeamTechResearched') return false;
  const change = finiteNumber(row.Payload.ChangeAmount);
  return change !== undefined && change > 0 && namedTech(row.Payload.TechID) !== undefined;
}

/** Project one operation for the exact source or target, with the target's deferred report turn. */
function projectOperation(
  { row, sourceID, targetID, result }: Operation, input: EspionageProjectionInput, technology: ReadonlyMap<number, EventRow>
): NewspaperEvent | undefined {
  if (input.receiverPlayerID === sourceID) {
    const values: Payload = {
      Perspective: 'source', SpyResult: result, SourcePlayerID: sourceID, TargetPlayerID: targetID,
      ...operationCity(row.Payload)
    };
    const gain = technology.get(row.ID);
    const tech = gain ? namedTech(gain.Payload.TechID) : undefined;
    if (tech) values.Tech = tech;
    const related: NewspaperSourceReference[] = gain ? [source('GameEvents', gain)] : [];
    return {
      source: source('GameEvents', row), type: row.Type, values,
      ...(related.length ? { relatedSources: related } : {})
    };
  }

  if (input.receiverPlayerID !== targetID || result === 'Undetected') return undefined;
  const marker = reportMarker(row, input.playerTurns, targetID);
  if (!marker || cityLost(row, marker, targetID, input.cityLosses)) return undefined;
  const values: Payload = {
    Perspective: 'target', SpyResult: result, TargetPlayerID: targetID, ...operationCity(row.Payload)
  };
  // A defender learns the source only from an identified or killed spy.
  if (revealingResults.has(result)) values.SourcePlayerID = sourceID;
  const reportTurn = marker.Turn > row.Turn ? marker.Turn : undefined;
  return {
    source: source('GameEvents', row), type: row.Type, values,
    ...(reportTurn !== undefined ? { reportTurn } : {}),
    relatedSources: [source('GameEvents', marker)]
  };
}

/** Keep a recorded city name and valid operation plot without exposing other payload fields. */
function operationCity(payload: Payload): Payload {
  const values: Payload = {};
  const position = plot(payload.CityX, payload.CityY);
  if (position) {
    values.CityX = position.x;
    values.CityY = position.y;
  }
  const name = nestedLabel(payload.City, 'City');
  if (name) values.CityName = name;
  return values;
}

/** Use the first later PlayerDoTurn for the exact defender on the same or next turn. */
function reportMarker(
  operation: EventRow, playerTurns: readonly EventRow[], targetID: number
): EventRow | undefined {
  let marker: EventRow | undefined;
  for (const row of playerTurns) {
    if (row.Type !== 'PlayerDoTurn' || row.Payload.PlayerID !== targetID) continue;
    if (row.Turn < operation.Turn || row.Turn > operation.Turn + 1) continue;
    if (row.Turn === operation.Turn && row.ID <= operation.ID) continue;
    if (!marker || row.Turn < marker.Turn || (row.Turn === marker.Turn && row.ID < marker.ID)) marker = row;
  }
  return marker;
}

/** Skip a defender report when a recorded loss between the operation and its marker ends the city. */
function cityLost(
  operation: EventRow, marker: EventRow, targetID: number, losses: readonly EventRow[]
): boolean {
  return losses.some(loss => {
    if (!between(loss, operation, marker)) return false;
    if (loss.Type === 'CityCaptureComplete' || loss.Type === 'CityRazed') return samePlot(loss.Payload, operation.Payload);
    if (loss.Type !== 'CityFlipped' || loss.Payload.OldOwnerID !== targetID) return false;
    // The revolt hook records the city before the new owner acquires it.
    const cityID = playerID(record(operation.Payload.City)?.CityID);
    return cityID !== undefined && loss.Payload.CityID === cityID;
  });
}

/** Bound loss evidence to the operation and its marker, without using later activity. */
function between(loss: EventRow, operation: EventRow, marker: EventRow): boolean {
  if (loss.Turn < operation.Turn || loss.Turn > marker.Turn) return false;
  if (loss.Turn === operation.Turn && loss.ID <= operation.ID) return false;
  return loss.Turn !== marker.Turn || loss.ID < marker.ID;
}

/** Project an election result only for the affected player. */
function projectElection(row: EventRow, receiverPlayerID: number): NewspaperEvent | undefined {
  const payload = row.Payload;
  const owner = playerID(payload.PlayerID);
  if (owner === undefined || owner !== receiverPlayerID) return undefined;
  const success = row.Type === 'ElectionResultSuccess';
  if (!success) {
    const spyID = payload.SpyID;
    if (typeof spyID !== 'number' || !Number.isInteger(spyID) || spyID < 0) return undefined;
  }
  const change = success ? finiteNumber(payload.Value) : electionLoss(finiteNumber(payload.DiminishAmount));
  if (change === undefined) return undefined;
  const values: Payload = { PlayerID: owner, InfluenceChange: change };
  const cityState = cityStateLabel(payload);
  if (cityState) values.CityState = cityState;
  const position = plot(payload.CityX, payload.CityY) ?? plot(payload.CapitalX, payload.CapitalY);
  if (position) {
    values.CityX = position.x;
    values.CityY = position.y;
  }
  return { source: source('GameEvents', row), type: row.Type, values };
}

/** Convert a failed election's hundredths of influence loss to a signed change. */
function electionLoss(diminish: number | undefined): number | undefined {
  if (diminish === undefined) return undefined;
  return diminish === 0 ? 0 : -diminish / 100;
}

/** Read a city-state name only from recorded city metadata naming a city-state owner. */
function cityStateLabel(payload: Payload): string | undefined {
  for (const field of ['City', 'Capital']) {
    const city = record(payload[field]);
    const prefix = 'City-State ';
    if (!city || !nestedLabel(city, 'City') || typeof city.Owner !== 'string' || !city.Owner.startsWith(prefix)) continue;
    const label = city.Owner.slice(prefix.length).trim();
    if (label) return label;
  }
  return undefined;
}

/** Read a nonempty nested city label. */
function nestedLabel(value: unknown, field: string): string | undefined {
  const label = record(value)?.[field];
  return typeof label === 'string' && label.trim() ? label.trim() : undefined;
}

/** Keep a recorded technology name, rejecting the game's empty sentinel. */
function namedTech(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name && name.toLowerCase() !== 'none' ? name : undefined;
}

/** Read a finite recorded number. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Read a nonnegative integer player ID. */
function playerID(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Read a record object without accepting arrays. */
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Read a valid map plot, including zero and excluding sentinel positions. */
function plot(x: unknown, y: unknown): { x: number; y: number } | undefined {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 &&
    typeof y === 'number' && Number.isInteger(y) && y >= 0 ? { x, y } : undefined;
}

/** Compare two payloads at the same recorded plot. */
function samePlot(left: Payload, right: Payload): boolean {
  const a = plot(left.CityX, left.CityY);
  const b = plot(right.CityX, right.CityY);
  return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y;
}
