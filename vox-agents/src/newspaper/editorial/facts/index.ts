/** Build one permission-filtered fact model for all expression groups in a check. */
import {
  eventReportTurn, type NewspaperEvent, type NewspaperEvidence, type NewspaperSnapshot, type NewspaperSourceReference,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { resolveGameSpeedMultiplier } from '../../../knowledge/game-speed.js';
import type { DiplomacyCheck } from '../diplomacy/war-peace.js';
import { buildCityFacts, buildCitySnapshotFacts } from './city.js';
import { buildCongressFact } from './congress.js';
import { buildDiplomacyFacts } from './diplomacy.js';
import { buildEventFacts } from './event.js';
import { buildPlayerFacts, buildPlayerSnapshotFacts } from './player.js';
import { distanceContext, mapWrap, type MapWrap } from './distance.js';
import { fact, rowSources, type FactBuildContext, type FactMetadata, type FactObject } from './model.js';
import { buildTimeline, observedAt, rowsAt, type Observation } from './timeline.js';

export interface FactObservation {
  readonly turn: number;
  readonly segment?: number;
  readonly fields?: FactObject;
  readonly sources?: readonly NewspaperSourceReference[];
}
export interface FactSubject {
  readonly current?: FactObject;
  readonly history: readonly FactObservation[];
}

export interface DatedFact<Id extends number | string> {
  readonly id: Id;
  readonly turn: number;
  readonly fields: FactObject;
  readonly sources: readonly NewspaperSourceReference[];
}

/** Printed-article history for one rule, or one rule and supported subject. */
export interface NewspaperPrintedArticle {
  readonly turn: number;
  readonly count: number;
}

/** Receiver publication memory exposed to expressions as `press` and `printed`. */
export interface NewspaperPress {
  readonly issues: number;
  readonly lastIssueTurn: number | null;
  readonly rules: Readonly<Record<string, NewspaperPrintedArticle>>;
  readonly subjects: Readonly<Record<string, NewspaperPrintedArticle>>;
}

export interface NewspaperFactModel {
  readonly turn: number;
  readonly previous: number;
  readonly earliestWindowTurn: number;
  readonly earliestSnapshotTurn: number;
  readonly longTurns: number;
  readonly receiverId: number;
  readonly game: FactObject;
  /** Prior issue memory, attached by the check rather than by an evidence builder. */
  readonly press?: NewspaperPress;
  readonly subjects: {
    readonly city: readonly number[];
    readonly player: readonly number[];
    readonly event: readonly number[];
    readonly pair: readonly string[];
    readonly incident: readonly string[];
  };
  readonly cities: Readonly<Record<number, FactSubject>>;
  readonly players: Readonly<Record<number, FactSubject>>;
  readonly events: readonly DatedFact<number>[];
  readonly pairs: Readonly<Record<string, FactSubject>>;
  readonly incidents: readonly DatedFact<string>[];
}

const privateWrap = new WeakMap<NewspaperFactModel, MapWrap>();

/** Pass validated wrap periods to the runner's private closure, never to rule bindings. */
export function factModelWrap(model: NewspaperFactModel): MapWrap | undefined {
  return privateWrap.get(model);
}

/** Attach the check's inferred diplomacy without exposing its inspector records or private geometry. */
export function addDiplomacyFacts(model: NewspaperFactModel, diplomacy: DiplomacyCheck): NewspaperFactModel {
  const { pairs, incidents, ids } = buildDiplomacyFacts(model, diplomacy);
  const enriched = {
    ...model, pairs, incidents,
    subjects: { ...model.subjects, pair: ids, incident: incidents.map(item => item.id) },
  };
  const wrap = privateWrap.get(model);
  if (wrap) privateWrap.set(enriched, wrap);
  return enriched;
}
/** Attach the receiver's prior issue memory without adding archive provenance. */
export function addPressFacts(model: NewspaperFactModel, press: NewspaperPress): NewspaperFactModel {
  const enriched = { ...model, press };
  const wrap = privateWrap.get(model);
  if (wrap) privateWrap.set(enriched, wrap);
  return enriched;
}
/** Collect the projected events once in effective reporting turn and insertion order. */
function datedEvents(evidence: NewspaperEvidence): NewspaperEvent[] {
  const byId = new Map((evidence.history?.events ?? []).map(event => [event.source.id, event]));
  for (const event of evidence.events) byId.set(event.source.id, event);
  return [...byId.values()].sort((a, b) =>
    eventReportTurn(a) - eventReportTurn(b) || a.source.id - b.source.id);
}

/** Expose the small set of public game settings and the league agenda used by editorial rules. */
function gameFacts(
  metadata: FactMetadata,
  speedMultiplier: number | undefined,
  evidence: NewspaperEvidence,
  cutoffTurn: number
): FactObject {
  const game: Record<string, ReturnType<typeof fact>> = {};
  if (typeof metadata.gameSpeed === 'string') game.speed = fact(metadata.gameSpeed);
  if (speedMultiplier !== undefined) game.speedMultiplier = fact(speedMultiplier);
  if (typeof metadata.mapSize === 'string') game.mapSize = fact(metadata.mapSize);
  if (typeof metadata.startEra === 'string') game.startEra = fact(metadata.startEra);
  if (typeof metadata.maxTurns === 'number' && Number.isSafeInteger(metadata.maxTurns) && metadata.maxTurns >= 0)
    game.maxTurns = fact(metadata.maxTurns);
  const congress = buildCongressFact(evidence, cutoffTurn);
  if (congress) game.congress = congress;
  return game;
}

/** Prepare compact timelines, preserving raw geometry only in the internal distance inputs. */
export function buildNewspaperFacts(
  evidence: NewspaperEvidence,
  metadata: FactMetadata = {},
  options: { longTurns?: number; ideologies?: readonly string[] } = {}
): NewspaperFactModel {
  const { cutoffTurn, previousCheckTurn, receiverPlayerID } = evidence.request;
  const speed = resolveGameSpeedMultiplier({ GameSpeed: metadata.gameSpeed, GameSpeedMultiplier: metadata.speedMultiplier });
  const longTurns = options.longTurns ?? Math.max(1, Math.round(40 * (speed ?? 1)));
  if (!Number.isSafeInteger(longTurns) || longTurns < 1) throw new RangeError('longTurns must be a positive integer.');

  const events = datedEvents(evidence).filter(event => eventReportTurn(event) <= cutoffTurn);
  const cities = buildTimeline(evidence, 'cities', events);
  const players = buildTimeline(evidence, 'players', events);
  const wrap = mapWrap(metadata);
  const contexts = new Map<number, FactBuildContext>();

  /** Restrict city history to the proved lifetime of the intended original key. */
  function cityObservations(row: NewspaperSnapshot, turn: number) {
    const entries = cities.get(row.subjectID) ?? [];
    const segment = entries.find(entry => entry.row?.source.id === row.source.id)?.segment;
    return segment === undefined ? [] : entries.filter(
      (entry): entry is Observation & { row: NewspaperSnapshot } =>
        entry.row !== undefined && entry.turn <= turn && entry.segment === segment
    );
  }

  /** Obtain a visibility filtered host view at a recorded date. */
  function contextAt(turn: number): FactBuildContext {
    const cached = contexts.get(turn);
    if (cached) return cached;
    let cityRows: NewspaperSnapshot[] | undefined;
    let playerRows: NewspaperSnapshot[] | undefined;
    let eventRows: NewspaperEvent[] | undefined;
    let distances: ReturnType<typeof distanceContext> | undefined;
    /** Initialize map distances only if a cutoff builder needs them. */
    function getDistances() {
      return distances ??= distanceContext(cityRows ??= rowsAt(cities, turn), receiverPlayerID, wrap);
    }
    const context: FactBuildContext = {
      evidence, metadata, receiverId: receiverPlayerID, turn, ideologies: options.ideologies,
      get players() { return playerRows ??= rowsAt(players, turn); },
      get cities() { return cityRows ??= rowsAt(cities, turn); },
      get events() { return eventRows ??= events.filter(event => eventReportTurn(event) <= turn); },
      /** The first projection only approximates founding when the recording itself has a baseline. */
      firstCityTurn(row) {
        const start = metadata.recordingStartTurn;
        if (start === undefined || evidence.history === undefined || evidence.history.fromTurn > start)
          return undefined;
        const first = cityObservations(row, turn)[0];
        if (first?.segment !== 0) return undefined;
        const firstTurn = first.row.source.turn;
        return firstTurn > start ? firstTurn : undefined;
      },
      /** Older observations may describe another city that reused the original key. */
      cityHistory(row) { return cityObservations(row, turn).map(entry => entry.row); },
      /** Event actors need both the event's own permission and contact at its date. */
      playerAt(id, date) { return observedAt(players, id, date); },
      /** Connect a city to recorded receiver cities. */
      cityDistance(row) { return getDistances().cityDistance(row); },
      /** Connect an event location to recorded receiver cities. */
      distanceFromPlot(point) { return getDistances().distanceFromPlot(point); },
      /** Connect two visible networks of cities. */
      playerDistance(ownedCities) { return getDistances().playerDistance(ownedCities); },
    };
    contexts.set(turn, context);
    return context;
  }

  const cutoff = contextAt(cutoffTurn);
  /** Build one stored fact object per changed snapshot, plus cutoff-only inferred facts. */
  function subjects(
    timeline: ReadonlyMap<number, readonly Observation[]>,
    current: readonly NewspaperSnapshot[],
    buildCurrent: (row: NewspaperSnapshot, context: FactBuildContext) => FactObject,
    buildPast: (row: NewspaperSnapshot, context: FactBuildContext) => FactObject,
  ): Readonly<Record<number, FactSubject>> {
    const result: Record<number, FactSubject> = Object.create(null);
    const currentRows = new Map(current.map(row => [row.subjectID, row]));
    for (const [id, entries] of timeline) {
      const row = currentRows.get(id);
      result[id] = {
        current: row && buildCurrent(row, cutoff),
        history: entries.map(entry => entry.row ? {
          turn: entry.turn,
          segment: entry.segment,
          fields: buildPast(entry.row, contextAt(entry.turn)),
          sources: rowSources(entry.row),
        } : { turn: entry.turn }),
      };
    }
    return result;
  }

  const model: NewspaperFactModel = {
    turn: cutoffTurn,
    previous: previousCheckTurn,
    earliestWindowTurn: Math.min(evidence.history?.fromTurn ?? previousCheckTurn, previousCheckTurn),
    earliestSnapshotTurn: Math.max(0, evidence.history?.fromTurn ?? cutoffTurn),
    longTurns,
    receiverId: receiverPlayerID,
    game: gameFacts(metadata, speed, evidence, cutoffTurn),
    subjects: {
      city: cutoff.cities.map(row => row.subjectID),
      player: cutoff.players.map(row => row.subjectID),
      event: events.filter(event => eventReportTurn(event) > previousCheckTurn).map(event => event.source.id),
      pair: [],
      incident: [],
    },
    cities: subjects(cities, cutoff.cities, buildCityFacts, buildCitySnapshotFacts),
    players: subjects(players, cutoff.players, buildPlayerFacts, buildPlayerSnapshotFacts),
    events: events.map(event => ({
      id: event.source.id, turn: eventReportTurn(event), fields: buildEventFacts(event, cutoff), sources: rowSources(event),
    })),
    pairs: {},
    incidents: [],
  };
  privateWrap.set(model, wrap);
  return model;
}
