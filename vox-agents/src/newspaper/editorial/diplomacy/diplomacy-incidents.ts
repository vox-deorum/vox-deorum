/** Reconstruct likely local diplomatic incidents from native call order and observed obligations. */
import type {
  NewspaperEvidence,
  NewspaperEvent,
  NewspaperSourceReference,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import {
  hasDefensivePact,
  isMasterOf,
  isVassalOf,
} from '../../../../../mcp-server/dist/diplomacy/relationships.js';
import type { DiplomacyInference } from '../../contracts/diplomacy.js';
import { uniqueSources } from '../shared/sources.js';
import { nativeDiplomacySource, type DiplomacyFacts } from './diplomacy-facts.js';

export interface IncidentParticipant {
  id: number;
  side: number;
  cause: string;
  anchor?: number;
}
export interface DiplomaticIncident {
  id: string;
  kind: 'war' | 'peace';
  turn: number;
  root?: [number, number];
  deliberate: boolean;
  events: NewspaperEvent[];
  participants: IncidentParticipant[];
  sources: NewspaperSourceReference[];
  pairs: { players: [number, number]; confidence: 'likely' | 'corroborated' }[];
  stage: string;
  concessionTypes: string;
  capitulation?: boolean;
  audit: DiplomacyInference;
}

/** Read an event identity without treating unknown IDs or booleans as a player. */
function id(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
/** Find a directed or reciprocal observed master/vassal obligation. */
function vassal(facts: DiplomacyFacts, child: number, master: number, turn: number): boolean {
  return (
    isVassalOf(facts.relationship(child, master, turn)) ||
    isMasterOf(facts.relationship(master, child, turn))
  );
}
/** Find a defensive pact from either visible side of the agreement. */
function pact(facts: DiplomacyFacts, a: number, b: number, turn: number): boolean {
  return (
    hasDefensivePact(facts.relationship(a, b, turn)) ||
    hasDefensivePact(facts.relationship(b, a, turn))
  );
}
/** Resolve an obligation to a side, preferring master/vassal causes over a defensive pact. */
function obligation(
  facts: DiplomacyFacts,
  player: number,
  side: number,
  turn: number,
  defending: boolean,
  beforeId = Infinity,
  opponent?: number
): string | undefined {
  if (vassal(facts, player, side, turn)) return 'followingMaster';
  if (vassal(facts, side, player, turn)) return 'vassalsJoining';
  if (
    facts.major(player) === false &&
    facts.ally(player, turn, beforeId, opponent)?.playerID === side
  )
    return 'cityStateJoining';
  if (defending && pact(facts, player, side, turn)) return 'defensivePact';
  return undefined;
}
/** Include a participant once, keeping the strongest supported obligation explanation. */
function participate(
  incident: DiplomaticIncident,
  player: number,
  side: number,
  cause: string,
  anchor?: number
): void {
  const existing = incident.participants.find((entry) => entry.id === player);
  if (!existing) incident.participants.push({ id: player, side, cause, anchor });
  else if (existing.cause === 'participation' && cause !== 'participation') {
    existing.side = side;
    existing.cause = cause;
    existing.anchor = anchor;
  }
}
/** Resolve an obligation through any already joined member of a side, including allied city-states. */
function sideOf(
  incident: DiplomaticIncident,
  player: number,
  facts: DiplomacyFacts,
  beforeId: number,
  opponent?: number
): IncidentParticipant | undefined {
  const existing = incident.participants.find((entry) => entry.id === player);
  if (existing) return existing;
  const candidates = incident.participants.flatMap((entry) => {
    const cause = obligation(
      facts,
      player,
      entry.id,
      incident.turn,
      entry.side === incident.root?.[1],
      beforeId,
      opponent
    );
    return cause ? [{ id: player, side: entry.side, cause, anchor: entry.id }] : [];
  });
  if (new Set(candidates.map((entry) => entry.side)).size !== 1) return undefined;
  return (
    candidates.find((entry) => ['followingMaster', 'vassalsJoining'].includes(entry.cause)) ??
    candidates[0]
  );
}
/** Corroborate a real acting pair without interpreting recursive origin/target payloads as complete pairs. */
function observedState(
  facts: DiplomacyFacts,
  a: number,
  b: number,
  turn: number,
  kind: 'war' | 'peace'
): boolean {
  return facts.snapshots.some(
    (row) =>
      row.source.turn === turn &&
      ((row.subjectID === a &&
        row.relationships.some((entry) => entry.targetPlayerID === b && entry.state === kind)) ||
        (row.subjectID === b &&
          row.relationships.some((entry) => entry.targetPlayerID === a && entry.state === kind)))
  );
}
/** Attach recursive calls using sides and obligations, never a shared origin or turn alone. */
function attaches(
  incident: DiplomaticIncident,
  event: NewspaperEvent,
  origin: number,
  target: number,
  facts: DiplomacyFacts
): boolean {
  if (!incident.root || event.source.turn !== incident.turn) return false;
  const [a, b] = incident.root;
  const originSide = sideOf(incident, origin, facts, event.source.id, target);
  const targetSide = sideOf(incident, target, facts, event.source.id, origin);
  if (originSide && targetSide && originSide.side !== targetSide.side) return true;
  if (origin === a && target === b) return true;
  if (origin === a && target === a) {
    return [...new Set(facts.snapshots.map((row) => row.subjectID))].some(
      (player) =>
        player !== a &&
        player !== b &&
        !!obligation(
          facts,
          player,
          b,
          incident.turn,
          event.values.IsAggressor !== false,
          event.source.id
        )
    );
  }
  if (origin === a) return !!obligation(facts, target, b, incident.turn, true, event.source.id);
  if (target === b) return !!obligation(facts, origin, a, incident.turn, false, event.source.id);
  if (target === a) return !!obligation(facts, origin, b, incident.turn, true, event.source.id);
  return (
    incident.participants.some((entry) => entry.id === origin) &&
    incident.participants.some(
      (entry) =>
        entry.id === target &&
        entry.side !== incident.participants.find((other) => other.id === origin)?.side
    )
  );
}
/** Reconstruct one native call's likely participants while retaining ambiguous recursive markers. */
function absorb(
  incident: DiplomaticIncident,
  event: NewspaperEvent,
  origin: number,
  target: number,
  facts: DiplomacyFacts
): void {
  incident.events.push(event);
  incident.sources.push(event.source);
  if (!incident.root) return;
  const [a, b] = incident.root;
  for (const player of [origin, target]) {
    const opponent = player === origin ? target : origin;
    if (
      !incident.participants.some((entry) => entry.id === player) &&
      facts.priorState(player, opponent, incident.turn) === incident.kind
    )
      continue;
    const joined = sideOf(incident, player, facts, event.source.id, opponent);
    if (joined) participate(incident, player, joined.side, joined.cause, joined.anchor);
  }
  // Repeated original payloads often belong to the origin's vassals; self targets often belong to defenders.
  if (origin === a && (target === a || (target === b && incident.events.length > 1))) {
    const side = target === a ? b : a;
    const candidates = [...new Set(facts.snapshots.map((row) => row.subjectID))]
      .filter((player) => player !== a && player !== b)
      .map((player) => ({ player, joined: sideOf(incident, player, facts, event.source.id) }))
      .filter(
        (entry): entry is { player: number; joined: IncidentParticipant } =>
          !!entry.joined && entry.joined.side === side
      );
    for (const { player, joined } of candidates) {
      const opponent = side === a ? b : a;
      if (facts.priorState(player, opponent, incident.turn) === incident.kind) continue;
      if (
        observedState(facts, player, opponent, incident.turn, incident.kind) ||
        candidates.length === 1
      ) {
        participate(incident, player, side, joined.cause, joined.anchor);
        if (observedState(facts, player, opponent, incident.turn, incident.kind))
          incident.pairs.push({ players: [player, opponent], confidence: 'corroborated' });
      }
    }
  }
  if (
    origin !== target &&
    (origin !== a || target !== b) &&
    observedState(facts, origin, target, incident.turn, incident.kind)
  )
    incident.pairs.push({ players: [origin, target], confidence: 'corroborated' });
}

/** Match only a peace-bearing deal emitted after the relevant native peace calls. */
function peaceDeal(
  incident: DiplomaticIncident,
  events: NewspaperEvent[],
  facts: DiplomacyFacts
): NewspaperEvent | undefined {
  if (!incident.root) return undefined;
  const [a, b] = incident.root;
  return events
    .filter(
      (event) =>
        event.type === 'DealMade' &&
        nativeDiplomacySource(event.source) &&
        event.source.turn === incident.turn &&
        event.source.id > Math.max(...incident.events.map((row) => row.source.id))
    )
    .find(
      (event) =>
        Array.isArray(event.values.TradedItems) &&
        event.values.TradedItems.some((item) => {
          if (!item || typeof item !== 'object' || !('ItemType' in item)) return false;
          const direct =
            (event.values.FromPlayerID === a && event.values.ToPlayerID === b) ||
            (event.values.FromPlayerID === b && event.values.ToPlayerID === a);
          if (direct && ['PeaceTreaty', 'Vassalage'].includes(String(item.ItemType))) return true;
          if (
            item.ItemType !== 'ThirdPartyPeace' ||
            !('FromPlayerID' in item) ||
            !('Data1' in item)
          )
            return false;
          return (
            (item.FromPlayerID === a && item.Data1 === facts.team(b)) ||
            (item.FromPlayerID === b && item.Data1 === facts.team(a))
          );
        })
    );
}
/** Read visible settlement terms without assigning a proposer, victor, or unknown concessions. */
function settlement(
  incident: DiplomaticIncident,
  evidence: NewspaperEvidence,
  facts: DiplomacyFacts
): void {
  if (!incident.root) return;
  const [a, b] = incident.root;
  const deal = peaceDeal(incident, evidence.history?.events ?? evidence.events, facts);
  const items =
    deal && Array.isArray(deal.values.TradedItems)
      ? (deal.values.TradedItems.filter((item) => item && typeof item === 'object') as Record<
          string,
          unknown
        >[])
      : [];
  if (deal) incident.sources.push(deal.source);
  const direct =
    deal &&
    ((deal.values.FromPlayerID === a && deal.values.ToPlayerID === b) ||
      (deal.values.FromPlayerID === b && deal.values.ToPlayerID === a));
  const concessions = direct
    ? items.filter((item) =>
        ['Gold', 'GoldPerTurn', 'Cities', 'City', 'Resources', 'Resource'].includes(
          String(item.ItemType)
        )
      )
    : [];
  const concessionLabels: Record<string, string> = {
    Gold: 'gold',
    GoldPerTurn: 'payments',
    Cities: 'cities',
    City: 'cities',
    Resources: 'resources',
    Resource: 'resources',
  };
  incident.concessionTypes = [
    ...new Set(concessions.map((item) => concessionLabels[String(item.ItemType)])),
  ].join(', ');
  const prior = [a, b].flatMap((player, index) => {
    const row = facts.snapshots.filter(entry => entry.subjectID === player && entry.source.turn < incident.turn).at(-1);
    const relationship = row?.relationships.find(entry => entry.targetPlayerID === [b, a][index]);
    return row && relationship && relationship.state !== 'unknown' ? [{ row, relationship }] : [];
  });
  const canEstablishChange = prior.length > 0 && !prior.some(({ relationship }) =>
    relationship.master === 'capitulated' || relationship.vassal === 'capitulated');
  const capitulation = canEstablishChange ? facts.snapshots.find(
    (row) =>
      row.source.turn >= incident.turn &&
      facts.standard(row.source.turn - incident.turn) <= facts.causalFreshness &&
      (row.subjectID === a || row.subjectID === b) &&
      row.relationships.some(
        (entry) =>
          entry.targetPlayerID === (row.subjectID === a ? b : a) &&
          (entry.master === 'capitulated' || entry.vassal === 'capitulated')
      )
  ) : undefined;
  incident.capitulation = !!capitulation;
  if (capitulation) incident.stage = 'capitulation';
  else if (concessions.length) incident.stage = 'concessions';
  else if (incident.participants.some((entry) => entry.cause === 'followingMaster'))
    incident.stage = 'vassalsIncluded';
  else if (facts.major(a) === false || facts.major(b) === false)
    incident.stage = 'cityStateAgreement';
  else if (incident.participants.some((entry) => facts.major(entry.id) === false))
    incident.stage = 'cityStatesIncluded';
  else incident.stage = 'agreement';
  if (capitulation) incident.sources.push(capitulation.source, ...prior.map(({ row }) => row.source));
}

/** Reconstruct local war and peace accounts using native IDs, leaving dynamic event offsets out of call order. */
export function reconstructDiplomaticIncidents(
  evidence: NewspaperEvidence,
  facts: DiplomacyFacts
): DiplomaticIncident[] {
  const incidents: DiplomaticIncident[] = [];
  const native = (evidence.history?.events ?? evidence.events)
    .filter(
      (event) =>
        nativeDiplomacySource(event.source) &&
        ['DeclareWar', 'MakePeace'].includes(event.type) &&
        event.source.turn <= evidence.request.cutoffTurn
    )
    .sort((a, b) => a.source.turn - b.source.turn || a.source.id - b.source.id);
  for (const event of native) {
    const origin = id(event.values.OriginatingPlayerID);
    const targetTeam = id(event.values.TargetTeamID);
    const target = targetTeam === undefined ? undefined : facts.member(targetTeam, event.source.turn);
    const kind = event.type === 'DeclareWar' ? 'war' : 'peace';
    const preceding = [...incidents]
      .reverse()
      .find(
        (incident) =>
          incident.kind === kind &&
          incident.turn === event.source.turn &&
          origin !== undefined &&
          target !== undefined &&
          attaches(incident, event, origin, target, facts) &&
          !native.some(
            (boundary) =>
              boundary.source.turn === event.source.turn &&
              boundary.source.id > incident.events.at(-1)!.source.id &&
              boundary.source.id < event.source.id &&
              boundary.type !== event.type
          )
      );
    if (preceding && origin !== undefined && target !== undefined) {
      absorb(preceding, event, origin, target, facts);
      continue;
    }
    const validPair = origin !== undefined && target !== undefined && origin !== target;
    const root = validPair ? ([origin, target] as [number, number]) : undefined;
    // An unmatched major call supplies a plausible root, while a self marker cannot identify an acting pair.
    const incidentId = `${kind}/${event.source.turn}/${event.source.id}`;
    const incident: DiplomaticIncident = {
      id: incidentId,
      kind,
      turn: event.source.turn,
      root,
      deliberate: event.values.IsAggressor === true,
      events: [],
      sources: [],
      participants: [],
      pairs: root ? [{ players: root, confidence: 'likely' }] : [],
      stage: kind === 'war' ? 'declaration' : 'agreement',
      concessionTypes: '',
      audit: {
        incidentId,
        kind,
        rootInitiator: root?.[0],
        participants: root ?? [],
        participationCause: 'participation',
        confidence: root ? 'likely' : 'ambiguous',
        alternatives: [],
        sources: [],
      },
    };
    if (root) {
      participate(incident, root[0], root[0], 'root');
      participate(incident, root[1], root[1], 'target');
    }
    absorb(incident, event, origin ?? -1, target ?? -1, facts);
    incidents.push(incident);
  }
  for (const incident of incidents) {
    // Pair state follows actual cross-side snapshot observations, separately from recursive event markers.
    for (const participant of incident.participants)
      for (const opponent of incident.participants) {
        if (
          participant.id >= opponent.id ||
          participant.side === opponent.side ||
          !observedState(facts, participant.id, opponent.id, incident.turn, incident.kind)
        )
          continue;
        incident.pairs.push({ players: [participant.id, opponent.id], confidence: 'corroborated' });
        incident.sources.push(
          ...facts.snapshots
            .filter(
              (row) =>
                row.source.turn === incident.turn &&
                ((row.subjectID === participant.id &&
                  row.relationships.some(
                    (entry) => entry.targetPlayerID === opponent.id && entry.state === incident.kind
                  )) ||
                  (row.subjectID === opponent.id &&
                    row.relationships.some(
                      (entry) =>
                        entry.targetPlayerID === participant.id && entry.state === incident.kind
                    )))
            )
            .map((row) => row.source)
        );
      }
    if (incident.kind === 'peace') settlement(incident, evidence, facts);
    incident.sources = uniqueSources(incident.sources);
    incident.audit.participants = incident.participants.map((entry) => entry.id);
    incident.audit.sources = incident.sources;
    if (
      incident.participants.some(
        (entry) =>
          entry.cause === 'cityStateJoining' &&
          incident.events.some(
            (event) =>
              facts.ally(
                entry.id,
                incident.turn,
                event.source.id,
                id(event.values.OriginatingPlayerID) === entry.id
                  ? facts.member(Number(event.values.TargetTeamID), event.source.turn)
                  : id(event.values.OriginatingPlayerID)
              )?.inferred
          )
      )
    )
      incident.audit.alternatives.push(
        'A changed same-turn city-state ally and its observed opponents support participation; the exact alliance-change sequence is unavailable.'
      );
    if (!incident.deliberate && incident.kind === 'war')
      incident.audit.alternatives.push(
        'The native aggressor flag does not establish a deliberate initiating decision.'
      );
    if (!incident.root)
      incident.audit.alternatives.push(
        'The visible call does not identify the actual acting pair.'
      );
  }
  return incidents;
}

/** Expose obligation lookup for later alliance and voluntary-vassal developments. */
export { obligation };
