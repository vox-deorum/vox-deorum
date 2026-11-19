/** Stateful war and peace editorial inference, separate from military actions and national score. */
import type {
  NewspaperEvidence,
  NewspaperSourceReference,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import {
  isAtWar,
  isVassalOf,
  isMasterOf,
} from '../../../../../mcp-server/dist/diplomacy/relationships.js';
import type {
  DiplomacyMemory,
  DiplomacyIncidentFact,
  DiplomacyReason,
  DiplomacyInference,
} from '../../contracts/diplomacy.js';
import type { EditorialContext } from '../shared/context.js';
import { uniqueSources } from '../shared/sources.js';
import {
  diplomacyFacts,
  diplomacyPairKey,
  type DiplomacyFacts,
} from './diplomacy-facts.js';
import { reconstructDiplomaticIncidents } from './diplomacy-incidents.js';
import { advancePairHistory } from './pair-history.js';
/** Default history in Standard turns when no catalogue window is supplied. */
const defaultHistoryStandardTurns = 40;
const causalFreshness = 5;

export interface DiplomacyCheck {
  memory: DiplomacyMemory;
  audit: DiplomacyInference[];
  incidents: DiplomacyIncidentFact[];
}
/** Identify a new voluntary-vassal connection that can plausibly carry an existing master's war. */
function inheritedWar(
  facts: DiplomacyFacts,
  player: number,
  enemy: number,
  turn: number
): { player: number; sources: NewspaperSourceReference[] } | undefined {
  const rows = facts.snapshots.filter(
    (row) =>
      row.subjectID === player &&
      row.source.turn <= turn &&
      facts.standard(turn - row.source.turn) <= facts.causalFreshness
  );
  for (const row of rows)
    for (const relation of row.relationships) {
      const voluntary =
        (isVassalOf(relation) && relation.master === 'voluntary') ||
        (isMasterOf(relation) && relation.vassal === 'voluntary');
      if (!voluntary || !isAtWar(facts.relationship(relation.targetPlayerID, enemy, turn)))
        continue;
      const prior = facts.snapshots
        .filter((before) => before.subjectID === player && before.source.turn < row.source.turn)
        .at(-1);
      if (
        prior &&
        !prior.relationships.some(
          (old) =>
            old.targetPlayerID === relation.targetPlayerID && (isVassalOf(old) || isMasterOf(old))
        )
      ) {
        const supportingWar = facts.source(relation.targetPlayerID, turn, enemy);
        return { player, sources: uniqueSources([prior.source, row.source, ...(supportingWar ? [supportingWar] : [])]) };
      }
    }
  return undefined;
}

/** Convert inference labels to the participant vocabulary exposed in rules. */
function reasonFor(cause: string): DiplomacyReason {
  switch (cause) {
    case 'defensivePact': return 'pact';
    case 'followingMaster': return 'vassal';
    case 'vassalsJoining': return 'master';
    case 'cityStateJoining': return 'cityStateAlly';
    case 'inheritedWars': return 'inherited';
    default: return 'root';
  }
}

/** Reconstruct permitted war and peace incidents and preserve pair continuity. */
export function inferWarAndPeace(
  evidence: NewspaperEvidence,
  context: EditorialContext,
  previous: DiplomacyMemory = { pairs: {} },
  historyTurns?: number,
): DiplomacyCheck {
  const memory = structuredClone(previous);
  const audit: DiplomacyInference[] = [];
  const incidentFacts: DiplomacyIncidentFact[] = [];
  const facts = diplomacyFacts(evidence, context, causalFreshness);
  const {
    cutoffTurn: cutoff,
    receiverPlayerID: receiver,
    previousCheckTurn: lastCheck,
  } = evidence.request;
  const incidents = reconstructDiplomaticIncidents(evidence, facts);
  const retention = Math.max(cutoff - lastCheck, historyTurns ?? Math.ceil(defaultHistoryStandardTurns / facts.standard(1)));
  const { openings, byIncident } = advancePairHistory(
    evidence, facts, memory, incidents, retention,
  );

  for (const incident of incidents) {
    if (incident.turn <= lastCheck) continue;
    if (!incident.root) {
      audit.push(incident.audit);
      continue;
    }
    const [a, b] = incident.root;
    if (facts.major(a) === false && facts.major(b) === false) {
      audit.push(incident.audit);
      continue;
    }
    const pairContext = byIncident.get(incident.id);
    let stage = pairContext?.resumed && incident.kind === 'war' ? 'resumed' : incident.stage;
    const ownParticipation = incident.participants.find((entry) => entry.id === receiver);
    const cause =
      ownParticipation?.cause ??
      incident.participants.find((entry) => !['root', 'target'].includes(entry.cause))?.cause ??
      'participation';
    const domestic = ownParticipation !== undefined;
    const inherited = incident.kind === 'war'
      ? inheritedWar(facts, a, b, incident.turn) ?? inheritedWar(facts, b, a, incident.turn)
      : undefined;
    if (incident.kind === 'war') {
      if (inherited !== undefined) stage = 'inheritedWars';
      else if (ownParticipation && !['root', 'target'].includes(ownParticipation.cause))
        stage = ownParticipation.cause;
      else if (
        a === receiver &&
        incident.participants.some((entry) => entry.cause === 'followingMaster')
      )
        stage = 'vassalsJoining';
      else if (
        !domestic &&
        incident.participants.some(
          (entry) => entry.cause === 'followingMaster' || entry.cause === 'vassalsJoining'
        )
      )
        stage = 'vassalsJoining';
      else if (!domestic && incident.participants.some((entry) => entry.cause === 'defensivePact'))
        stage = 'defensivePact';
      else if (facts.major(a) === false || facts.major(b) === false) {
        const minor = facts.major(a) === false ? a : b;
        const major = minor === a ? b : a;
        const ally = facts.ally(minor, incident.turn, incident.events[0].source.id)?.playerID;
        const joined =
          ally !== undefined &&
          ally !== null &&
          ally !== major &&
          isAtWar(facts.relationship(ally, major, incident.turn));
        stage = joined && !incident.deliberate ? 'cityStateJoining' : 'cityStateAttack';
      }
    } else {
      if (ownParticipation?.cause === 'followingMaster') stage = 'masterLed';
      const knownRemaining = !!pairContext?.partialSources.length;
      if (knownRemaining && ['agreement', 'quietFronts'].includes(stage)) stage = 'partial';
      else if (!knownRemaining && stage === 'agreement' && domestic) stage = 'quietFronts';
    }
    incident.audit.participationCause = inherited !== undefined ? 'inheritedWars' : cause;
    incident.audit.confidence = incident.pairs.some((pair) => pair.confidence === 'corroborated')
      ? 'corroborated'
      : 'likely';
    const relationshipSources = incident.participants
      .filter((entry) => !['root', 'target'].includes(entry.cause))
      .flatMap((entry) =>
        [
          facts.source(entry.id, incident.turn, entry.anchor ?? entry.side),
          facts.source(entry.anchor ?? entry.side, incident.turn, entry.id),
          ...(entry.cause === 'cityStateJoining'
            ? [facts.ally(entry.id, incident.turn, incident.events.at(-1)?.source.id)?.source]
            : []),
        ].filter((source): source is NewspaperSourceReference => !!source)
      );
    incident.sources = uniqueSources([
      ...incident.sources, ...relationshipSources, ...(inherited?.sources ?? []),
      ...(pairContext?.partialSources ?? []), ...(pairContext?.resumedSources ?? []),
    ]);
    incident.audit.sources = incident.sources;
    /** Attribute an inherited war to the new vassal or master supported by the summaries. */
    const participantReason = (entry: (typeof incident.participants)[number]): DiplomacyReason => {
      return reasonFor(inherited && entry.id === inherited.player ? 'inheritedWars' : entry.cause);
    };
    incidentFacts.push({
      id: incident.id, kind: incident.kind, turn: incident.turn, root: incident.root,
      participants: incident.participants.filter(entry => facts.major(entry.id) === true).map(entry => ({
        id: entry.id, side: entry.side === a ? 'initiator' : 'target', reason: participantReason(entry),
      })),
      cityStates: incident.participants.filter(entry => facts.major(entry.id) === false).map(entry => entry.id),
      role: receiver === a ? 'initiator' : receiver === b ? 'target' : domestic ? 'joined' : 'none',
      reason: ownParticipation ? participantReason(ownParticipation) : undefined,
      resumed: !!pairContext?.resumed, observed: false, partial: !!pairContext?.partialSources.length,
      capitulation: !!incident.capitulation, concessions: incident.concessionTypes ? incident.concessionTypes.split(', ') : [],
      sources: incident.sources, pair: pairContext?.observation,
    });
    audit.push({
      ...incident.audit,
      stage,
      ...(incident.concessionTypes ? { concessionTypes: incident.concessionTypes } : {}),
    });
  }

  const allianceChanges = facts.snapshots.flatMap((row) => {
    if (row.isMajor || row.source.turn <= lastCheck) return [];
    const ally = row.majorAllyPlayerID;
    const prior = facts.snapshots
      .filter(
        (before) => before.subjectID === row.subjectID && before.source.turn < row.source.turn
      )
      .at(-1);
    if (
      !prior ||
      facts.standard(row.source.turn - prior.source.turn) > causalFreshness ||
      ally == null ||
      ally === prior.majorAllyPlayerID
    )
      return [];
    const opponents = row.relationships.filter(
      (relation) =>
        isAtWar(relation) &&
        prior.relationships.some(
          (before) => before.targetPlayerID === relation.targetPlayerID && before.state === 'peace'
        ) &&
        isAtWar(
          facts.relationship(ally, relation.targetPlayerID, row.source.turn)
        )
    );
    if (
      !opponents.length ||
      incidents.some(
        (incident) =>
          incident.turn === row.source.turn &&
          incident.participants.some((entry) => entry.id === row.subjectID)
      )
    )
      return [];
    const event = evidence.events.find(
      (entry) =>
        ['SetAlly', 'MinorAlliesChanged'].includes(entry.type) &&
        entry.source.turn === row.source.turn &&
        entry.values.MinorPlayerID === row.subjectID
    );
    return [{ row, prior, opponents, event, ally }];
  });
  const alliancePairKeys = new Set(
    allianceChanges.flatMap((change) =>
      change.opponents.map(
        (opponent) =>
          `${diplomacyPairKey(change.row.subjectID, opponent.targetPlayerID)}/${change.row.source.turn}`
      )
    )
  );
  for (const { pair, observation, resumed, sources } of openings) {
    const [a, b] = pair.players;
    const turn = observation.turn;
    const pairId = diplomacyPairKey(a, b);
    if (
      (facts.major(a) === false && facts.major(b) === false) ||
      turn <= lastCheck ||
      alliancePairKeys.has(`${pairId}/${turn}`)
    )
      continue;
    const inherited =
      inheritedWar(facts, a, b, turn) ?? inheritedWar(facts, b, a, turn);
    const stage = inherited ? 'inheritedWars' : resumed ? 'resumed' : 'observed';
    const key = `observed/${pairId}/${turn}`;
    const openingSources = uniqueSources([...sources, ...(inherited?.sources ?? [])]);
    incidentFacts.push({
      id: key, kind: 'war', turn, root: [a, b], rootRolesUnknown: true,
      participants: [], cityStates: [a, b].filter(player => facts.major(player) === false),
      role: pair.players.includes(receiver) ? undefined : 'none', resumed, observed: true, partial: false, capitulation: false, concessions: [],
      sources: openingSources, pair: observation,
    });
    audit.push({
      incidentId: key,
      kind: 'continuity',
      stage,
      participants: [a, b],
      participationCause: stage,
      confidence: 'corroborated',
      alternatives: ['The declaration sequence is unavailable.'],
      sources: openingSources,
    });
  }

  // A later city-state alliance can move an existing war without a new major declaration.
  const reportedAlliances = new Set<string>();
  for (const change of allianceChanges) {
    const { row, prior, event, opponents, ally } = change;
    const key = `alliance/${row.subjectID}/${row.source.turn}`;
    if (reportedAlliances.has(key)) continue;
    reportedAlliances.add(key);
    const opponent = opponents[0].targetPlayerID;
    const alliedWar = facts.source(ally, row.source.turn, opponent);
    const sources = uniqueSources([prior.source, row.source, ...(event ? [event.source] : []), ...(alliedWar ? [alliedWar] : [])]);
    const players = [ally, opponents[0].targetPlayerID];
    const pair = [row.subjectID, opponent] as [number, number];
    incidentFacts.push({
      id: key, kind: 'war', turn: row.source.turn, root: pair, rootRolesUnknown: true,
      participants: [], cityStates: [row.subjectID],
      role: receiver === row.subjectID ? 'joined' : receiver === ally || receiver === opponent ? undefined : 'none',
      reason: receiver === row.subjectID ? 'cityStateAlly' : undefined,
      resumed: openings.some(opening => opening.observation.turn === row.source.turn && opening.resumed &&
        diplomacyPairKey(...opening.pair.players) === diplomacyPairKey(...pair)),
      observed: true, partial: false, capitulation: false, concessions: [], sources,
      pair: memory.pairs[diplomacyPairKey(...pair)]?.observations.find(observation => observation.turn === row.source.turn),
    });
    audit.push({
      stage: 'allianceChange',
      incidentId: key,
      kind: 'war',
      participants: [row.subjectID, ...players],
      participationCause: 'allianceChange',
      confidence: 'corroborated',
      alternatives: [],
      sources,
    });
  }

  incidentFacts.sort((a, b) => a.turn - b.turn);
  return { memory, audit, incidents: incidentFacts };
}
