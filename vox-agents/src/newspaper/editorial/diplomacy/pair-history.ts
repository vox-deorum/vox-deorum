/** Advance dated, direction-aware pair history from permitted calls and summaries. */
import type { NewspaperDiplomacySnapshot, NewspaperEvidence, NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { DiplomacyMemory, DiplomacyPair, DiplomacyPairObservation } from '../../contracts/diplomacy.js';
import { uniqueSources } from '../shared/sources.js';
import { createDiplomacyPair, diplomacyPairKey, type DiplomacyFacts } from './diplomacy-facts.js';
import type { DiplomaticIncident } from './diplomacy-incidents.js';

const peaceContinuityGapStandardTurns = 10;

interface Opening {
  pair: DiplomacyPair;
  observation: DiplomacyPairObservation;
  resumed: boolean;
  sources: NewspaperSourceReference[];
}

export interface PairIncidentContext {
  resumed: boolean;
  partialSources: NewspaperSourceReference[];
  observation: DiplomacyPairObservation;
  resumedSources: NewspaperSourceReference[];
}

/** Append the observation and reset the continuity anchor when the known state changes. */
function record(
  pair: DiplomacyPair, turn: number, state: DiplomacyPair['state'], sources: NewspaperSourceReference[],
  relations: { relation: NewspaperDiplomacySnapshot['relationships'][number]; row: NewspaperDiplomacySnapshot }[] = [],
  peaceCall = false, restartPeace = false,
): DiplomacyPairObservation {
  if (pair.state !== state || restartPeace || (peaceCall && !pair.peaceAnchored)) {
    if (state === 'peace' && pair.state === 'war') pair.lastWarScore = pair.latestWarScore;
    else if (state === 'war' || (state === 'peace' && pair.lastKnownState !== 'peace')) pair.lastWarScore = undefined;
    pair.peaceAnchored = state === 'peace' && (peaceCall || pair.state === 'war' || pair.peaceAnchored);
    pair.state = state;
    pair.since = state === 'unknown' ? null : turn;
    pair.sinceSources = sources;
    pair.latestWarScore = undefined;
  }
  pair.lastObserved = turn;
  pair.foughtBefore ||= state === 'war';
  if (state !== 'unknown') {
    pair.lastKnownState = state;
    pair.lastKnownSources = uniqueSources([...(pair.sinceSources ?? []), ...sources]);
  }
  const scoreReport = state === 'war' ? relations.find(({ row }) => row.subjectID === pair.perspective) : undefined;
  const score = scoreReport?.relation.warScore;
  if (scoreReport && score !== undefined && Number.isFinite(score) && Math.abs(score) <= 100) {
    pair.latestWarScore = { turn, score, source: scoreReport.row.source };
  }
  if (state === 'war' && pair.since === turn) pair.lastWarSources = pair.sinceSources;
  const scoreSample = scoreReport && score !== undefined && pair.latestWarScore?.turn === turn ? pair.latestWarScore : undefined;
  const observation: DiplomacyPairObservation = {
    turn, state, since: pair.since, peaceAnchored: pair.peaceAnchored, sources,
    ...(pair.sinceSources ? { sinceSources: pair.sinceSources } : {}),
    ...(state === 'peace' && pair.lastWarScore ? { lastWarScore: pair.lastWarScore } : {}),
    ...(scoreSample ? { warScore: scoreSample.score, scoreSource: scoreSample.source } : {}),
    ...(state !== 'unknown' && relations.length ? {
      observers: relations.map(({ row }) => row.subjectID),
      friends: relations.some(({ relation }) => relation.friendship),
      pact: relations.some(({ relation }) => relation.defensivePact),
    } : {}),
  };
  if (pair.observations.at(-1)?.turn === turn) pair.observations.pop();
  pair.observations.push(observation);
  return observation;
}

/** Process transitions in turn order, using native calls before each day's final observations. */
export function advancePairHistory(
  evidence: NewspaperEvidence, facts: DiplomacyFacts, memory: DiplomacyMemory, incidents: DiplomaticIncident[], retain: number,
): { openings: Opening[]; byIncident: Map<string, PairIncidentContext> } {
  const { cutoffTurn: cutoff, receiverPlayerID: receiver } = evidence.request;
  const firstNewTurn = (memory.throughTurn ?? -Infinity) + 1;
  const openings: Opening[] = [];
  const byIncident = new Map<string, PairIncidentContext>();
  const days = new Map<number, { calls: DiplomaticIncident[]; rows: Map<number, NewspaperDiplomacySnapshot>; gaps: Map<number, NewspaperSourceReference | undefined> }>();
  /** Keep one bucket per actual recording date, including dates with only a visibility gap. */
  function day(turn: number) {
    let value = days.get(turn);
    if (!value) days.set(turn, value = { calls: [], rows: new Map(), gaps: new Map() });
    return value;
  }
  for (const incident of incidents) if (incident.turn >= firstNewTurn) day(incident.turn).calls.push(incident);
  for (const row of facts.snapshots) if (row.source.turn >= firstNewTurn) day(row.source.turn).rows.set(row.subjectID, row);
  for (const gap of evidence.history?.gaps ?? [])
    if (gap.table === 'PlayerSummaries' && gap.turn >= firstNewTurn && gap.turn <= cutoff) day(gap.turn).gaps.set(gap.subjectID, undefined);
  // A readable source can carry a relationship gap even when its player identity was not resolved.
  for (const gap of evidence.diplomacy?.gaps ?? [])
    if (gap.source.turn >= firstNewTurn && gap.source.turn <= cutoff) day(gap.source.turn).gaps.set(gap.subjectID, gap.source);
  /** Reuse the stable perspective and retain pair continuity across publication checks. */
  function pairFor(a: number, b: number): DiplomacyPair {
    return memory.pairs[diplomacyPairKey(a, b)] ??= createDiplomacyPair(a, b, receiver);
  }
  for (const [turn, { calls, rows, gaps }] of [...days].sort(([a], [b]) => a - b)) {
    const native = new Map<string, DiplomaticIncident>();
    /** Read only the endpoints' permitted reports for this date. */
    const pairReports = (pair: DiplomacyPair) => {
      return pair.players.flatMap((player, index) => {
        const row = rows.get(player);
        if (!row) return [];
        const relation = row.relationships.find(entry => entry.targetPlayerID === pair.players[1 - index]);
        return relation && relation.state !== 'unknown' ? [{ relation, row }] : [];
      });
    };
    for (const incident of calls) {
      const visited = new Set<string>();
      for (const { players: [a, b] } of incident.pairs) {
        const key = diplomacyPairKey(a, b);
        if (a === b || visited.has(key)) continue;
        visited.add(key);
        const pair = pairFor(a, b);
        const previousCall = native.get(key);
        if (incident.kind === 'peace' && pair.players.every(player => facts.major(player) === true)) {
          const callStart = incident.events[0].source.createdAt;
          const previousCallEnd = previousCall?.events.at(-1)?.source.createdAt ?? -Infinity;
          const earlierReports = pairReports(pair).filter(({ row }) => previousCallEnd < row.source.createdAt && row.source.createdAt < callStart);
          if (earlierReports.length && earlierReports.every(({ relation }) => relation.state === 'war'))
            record(pair, turn, 'war', earlierReports.map(({ row }) => row.source), earlierReports);
        }
        const resumed = incident.kind === 'war' && pair.foughtBefore && pair.lastKnownState === 'peace';
        const resumedSources = resumed ? uniqueSources([...(pair.lastWarSources ?? []), ...(pair.lastKnownSources ?? [])]) : [];
        // Keep the source of the actual call per pair; the incident retains the larger cascade separately.
        const pairSources = incident.root && key === diplomacyPairKey(...incident.root) ? [incident.events[0].source] :
          [[a, b], [b, a]].flatMap(([player, opponent]) => {
            const row = rows.get(player);
            return row?.relationships.some(relation => relation.targetPlayerID === opponent && relation.state === incident.kind) ? [row.source] : [];
          });
        const observation = record(pair, turn, incident.kind, pairSources, [], incident.kind === 'peace');
        native.set(key, incident);
        if (incident.root && key === diplomacyPairKey(...incident.root))
          byIncident.set(incident.id, { resumed, observation, resumedSources, partialSources: [] });
      }
    }
    const affected = new Set<string>();
    for (const row of rows.values()) for (const relation of row.relationships)
      if (row.subjectID !== relation.targetPlayerID) {
        pairFor(row.subjectID, relation.targetPlayerID);
        affected.add(diplomacyPairKey(row.subjectID, relation.targetPlayerID));
      }
    for (const [key, pair] of Object.entries(memory.pairs))
      if (pair.players.some(player => rows.has(player) || gaps.has(player))) affected.add(key);
    for (const key of affected) {
      const pair = memory.pairs[key];
      let relations = pairReports(pair);
      const states = new Set(relations.map(({ relation }) => relation.state));
      let agreed = states.size === 1 ? relations[0].relation.state : 'unknown';
      const call = native.get(key);
      const last = pair.observations.at(-1);
      if (!relations.length && !call && !pair.players.some(player => gaps.has(player) ||
        rows.get(player)?.relationships.some(relation => pair.players.includes(relation.targetPlayerID)) ||
        (rows.has(player) && (last?.observers?.includes(player) || !last?.observers)))) continue;
      // An opposite summary might predate a call. Only strictly later reports can establish a further transition.
      const callEnd = call?.events.at(-1)?.source.createdAt;
      const laterTransition = callEnd !== undefined && agreed !== 'unknown' && agreed !== call?.kind &&
        relations.every(({ row }) => row.source.createdAt > callEnd);
      if (call && !laterTransition) {
        // The call establishes state even when the two final reports disagree. Only matching reports may add facts.
        agreed = call.kind;
        const callStart = call.events[0].source.createdAt;
        relations = relations.filter(({ relation, row }) => relation.state === agreed && row.source.createdAt >= callStart);
        if (!relations.length) continue;
      }
      const sources = uniqueSources([
        ...(call && !laterTransition ? last?.sources ?? [] : []),
        ...(call ? relations.map(({ row }) => row.source) : pair.players.flatMap(player => {
          const source = rows.get(player)?.source ?? gaps.get(player);
          return source ? [source] : [];
        })),
      ]);
      const wasWar = pair.foughtBefore;
      const previousState = pair.state;
      const previousKnownState = pair.lastKnownState;
      const resumedSources = wasWar && previousKnownState === 'peace' ? uniqueSources([...(pair.lastWarSources ?? []), ...(pair.lastKnownSources ?? [])]) : [];
      const restartPeace = agreed === 'peace' && previousState === 'peace' && pair.lastObserved !== null &&
        facts.standard(turn - pair.lastObserved) > peaceContinuityGapStandardTurns;
      const bothMajor = pair.players.every(player => facts.major(player) === true);
      const observation = record(pair, turn, agreed, sources, bothMajor ? relations : relations.map(({ relation, row }) => ({ relation: { ...relation, warScore: undefined }, row })), false, restartPeace);
      if (call && !laterTransition) {
        const context = byIncident.get(call.id);
        if (context && agreed === call.kind && call.root && key === diplomacyPairKey(...call.root)) context.observation = observation;
      } else if (agreed === 'war' && previousKnownState !== 'war') {
        const resumed = wasWar && previousKnownState === 'peace';
        openings.push({ pair, observation, resumed, sources: uniqueSources([...sources, ...resumedSources]) });
      }
    }
    for (const incident of calls) {
      if (incident.kind !== 'peace' || !incident.root) continue;
      const context = byIncident.get(incident.id);
      if (!context) continue;
      const key = diplomacyPairKey(...incident.root);
      context.partialSources = uniqueSources(Object.entries(memory.pairs).flatMap(([otherKey, pair]) =>
        otherKey !== key && pair.state === 'war' && pair.players.some(player => incident.root!.includes(player)) &&
        pair.lastObserved !== null && facts.standard(turn - pair.lastObserved) <= facts.causalFreshness
          ? pair.observations.at(-1)?.sources ?? [] : []));
    }
  }
  const from = cutoff - retain;
  for (const pair of Object.values(memory.pairs)) {
    const index = pair.observations.findIndex(observation => observation.turn >= from);
    // Keep the nearest baseline for a lookup at the start of the retained span.
    pair.observations = index < 0 ? pair.observations.slice(-1) : pair.observations.slice(Math.max(0, index - 1));
  }
  memory.throughTurn = cutoff;
  return { openings, byIncident };
}
