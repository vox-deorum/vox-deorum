/** Turn permitted diplomacy observations into the public pair and incident fields. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { DiplomacyPairObservation } from '../../contracts/diplomacy.js';
import type { DiplomacyCheck } from '../diplomacy/war-peace.js';
import { uniqueSources } from '../shared/sources.js';
import type { FactObservation, FactSubject, NewspaperFactModel, DatedFact } from './index.js';
import { fact, reference, type FactField, type FactObject } from './model.js';

/** Project fields at a known date, preserving the observation and transition behind them. */
function pairFields(
  model: NewspaperFactModel,
  players: readonly [number, number],
  observation: DiplomacyPairObservation,
  turn: number,
  historical: boolean,
): FactObject {
  const [a, b] = players;
  const { state, sources, since, sinceSources, lastWarScore, warScore, scoreSource, peaceAnchored, friends, pact } = observation;
  const involvesSelf = players.includes(model.receiverId);
  const fields: Record<string, FactField> = {
    a: fact(reference('player', a), sources),
    b: fact(reference('player', b), sources),
    involvesSelf: fact(involvesSelf, sources),
  };
  if (involvesSelf) fields.other = fact(reference('player', a === model.receiverId ? b : a), sources);
  const own = identityField(model, a, turn, historical);
  const other = identityField(model, b, turn, historical);
  if (own && other) fields.majors = fact(own.value === true && other.value === true,
    uniqueSources([...(own.sources ?? []), ...(other.sources ?? [])]));
  if (state !== 'unknown') {
    const continuity = uniqueSources([...sources, ...(sinceSources ?? [])]);
    fields.atWar = fact(state === 'war', sources);
    if (state === 'peace') fields.warTurns = fact(0, sources);
    else if (since !== null) fields.warTurns = duration(since);
    if (state === 'peace' && peaceAnchored && since !== null) fields.peaceTurns = duration(since);
    if (state === 'war' && warScore !== undefined) fields.warScore = fact(warScore, scoreSource ? [scoreSource] : sources);
    if (lastWarScore !== undefined) fields.lastWarScore = fact(lastWarScore.score, [lastWarScore.source, ...continuity]);
    if (friends !== undefined) fields.friends = fact(friends, sources);
    if (pact !== undefined) fields.pact = fact(pact, sources);

    /** An incident freezes pair durations at the date of the recorded calls. */
    function duration(since: number): FactField {
      return fact({ $kind: 'elapsed', since }, continuity);
    }
  }
  return fields;
}

/** Read the latest visible player observation, respecting a gap at that date. */
function playerObservation(model: NewspaperFactModel, id: number, turn: number): FactObservation | undefined {
  const history = model.players[id]?.history;
  if (!history) return undefined;
  let lo = 0, hi = history.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (history[mid].turn <= turn) lo = mid + 1;
    else hi = mid;
  }
  return history[lo - 1];
}

/** Source the major flag from the player version the rule can read. */
function identityField(model: NewspaperFactModel, id: number, turn: number, historical: boolean): FactField | undefined {
  return (historical ? playerObservation(model, id, turn)?.fields : model.players[id]?.current)?.major;
}

/** Organize the pair series and project incidents only for this check's reporting period. */
export function buildDiplomacyFacts(model: NewspaperFactModel, diplomacy: DiplomacyCheck): {
  pairs: Record<string, FactSubject>; incidents: DatedFact<string>[]; ids: string[];
} {
  const pairs: Record<string, FactSubject> = Object.create(null);
  const ids: string[] = [];
  const visible = new Set(model.subjects.player);
  for (const [id, pair] of Object.entries(diplomacy.memory.pairs).sort(([, a], [, b]) =>
    a.players[0] - b.players[0] || a.players[1] - b.players[1])) {
    const available = pair.observations.filter(item => item.turn <= model.turn);
    const last = available.at(-1);
    if (!last) continue;
    let segment = 0;
    let previous: DiplomacyPairObservation | undefined;
    const history = available.map((entry): FactObservation => {
      // A row can predate the loaded observation while still establishing that baseline.
      const visibilityTurn = Math.max(entry.turn, model.earliestSnapshotTurn);
      if (previous && (previous.state !== entry.state || previous.since !== entry.since)) segment++;
      previous = entry;
      if (entry.state === 'unknown' ||
        !pair.players.every(player => playerObservation(model, player, visibilityTurn)?.fields))
        return { turn: entry.turn, sources: entry.sources };
      return {
        turn: entry.turn, segment, sources: entry.sources,
        fields: pairFields(model, pair.players, entry, visibilityTurn, true),
      };
    });
    const current = pair.players.every(player => visible.has(player)) &&
      available.some(item => item.state !== 'unknown') ?
      pairFields(model, pair.players, last, model.turn, false) : undefined;
    pairs[id] = { current, history };
    if (current) ids.push(id);
  }

  const incidents: DatedFact<string>[] = [];
  for (const incident of diplomacy.incidents) {
    if (incident.turn <= model.previous || incident.turn > model.turn) continue;
    const { id, turn, root, sources } = incident;
    if (!root.every(player => playerObservation(model, player, turn)?.fields)) continue;
    const fields: Record<string, FactField> = {
      kind: fact(incident.kind, sources),
      turn: fact(turn, sources),
      participants: fact(incident.participants.filter(entry => playerObservation(model, entry.id, turn)?.fields)
        .map(entry => ({
          player: playerLink(entry.id, sources),
          side: fact(entry.side, sources),
          reason: fact(entry.reason, sources),
        })), sources),
      cityStates: fact(incident.cityStates.filter(player => playerObservation(model, player, turn)?.fields)
        .map(player => reference('player', player, visible.has(player) ? undefined : turn)), sources),
      resumed: fact(incident.resumed, sources),
      observed: fact(incident.observed, sources),
      partial: fact(incident.partial, sources),
      concessions: fact(incident.concessions, sources),
      capitulation: fact(incident.capitulation, sources),
    };
    if (!incident.rootRolesUnknown) {
      fields.initiator = playerLink(root[0], sources);
      fields.target = playerLink(root[1], sources);
    }
    if (incident.role !== undefined) fields.role = fact(incident.role, sources);
    if (incident.reason !== undefined) fields.reason = fact(incident.reason, sources);
    if (incident.pair) {
      const players: [number, number] = root[0] < root[1] ? [root[0], root[1]] : [root[1], root[0]];
      fields.pair = fact({
        $kind: 'anchoredPair', id, turn, fields: pairFields(model, players, incident.pair, turn, true),
      }, sources);
    }
    incidents.push({ id, turn, fields, sources });

    /** Use cutoff player facts when available, with the incident-date identity as a fallback. */
    function playerLink(player: number, rows: readonly NewspaperSourceReference[]): FactField {
      const dated = playerObservation(model, player, turn)?.sources ?? [];
      return fact(reference('player', player, visible.has(player) ? undefined : turn), uniqueSources([...rows, ...dated]));
    }
  }
  incidents.sort((a, b) => a.turn - b.turn || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { pairs, incidents, ids };
}
