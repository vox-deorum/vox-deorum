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
  DiplomacyPair,
  DiplomacyInference,
} from '../../contracts/diplomacy.js';
import type { EditorialContext } from '../shared/context.js';
import { uniqueSources } from '../shared/sources.js';
import {
  createDiplomacyPair,
  diplomacyFacts,
  diplomacyPairKey,
  type DiplomacyFacts,
} from './diplomacy-facts.js';
import { reconstructDiplomaticIncidents } from './diplomacy-incidents.js';
/** Standard-turn history retained for directional war scores. */
export const diplomacyHistoryStandardTurns = 30;
const causalFreshness = 5;
const peaceMaxGap = 10;

export interface DiplomacyCheck {
  memory: DiplomacyMemory;
  audit: DiplomacyInference[];
}

/** Reset a pair's score history and continuity whenever peace or renewed war changes its state. */
function transition(pair: DiplomacyPair, state: 'war' | 'peace', turn: number): void {
  if (pair.state === state) return;
  pair.peaceAnchored = state === 'peace' && pair.state === 'war';
  pair.state = state;
  pair.since = turn;
  pair.lastObserved = turn;
  pair.samples = [];
}
/** Identify a new voluntary-vassal connection that can plausibly carry an existing master's war. */
function inheritedWar(
  facts: DiplomacyFacts,
  player: number,
  enemy: number,
  turn: number
): number | undefined {
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
      )
        return relation.targetPlayerID;
    }
  return undefined;
}

/** Reconstruct permitted war and peace incidents and preserve pair continuity. */
export function inferWarAndPeace(
  evidence: NewspaperEvidence,
  context: EditorialContext,
  previous: DiplomacyMemory = { pairs: {} }
): DiplomacyCheck {
  const memory = structuredClone(previous);
  const audit: DiplomacyInference[] = [];
  const facts = diplomacyFacts(evidence, context, causalFreshness);
  const {
    cutoffTurn: cutoff,
    receiverPlayerID: receiver,
    previousCheckTurn: lastCheck,
  } = evidence.request;
  /** Get one stable pair whose perspective does not depend on whichever ally supplied a snapshot. */
  function pairFor(a: number, b: number): DiplomacyPair {
    const key = diplomacyPairKey(a, b);
    return (memory.pairs[key] ??= createDiplomacyPair(a, b, receiver));
  }
  const incidents = reconstructDiplomaticIncidents(evidence, facts);
  const nativePairs = new Map<string, number>();
  for (const incident of incidents) {
    for (const actual of incident.pairs) {
      const [a, b] = actual.players;
      if (a === b) continue;
      const pair = pairFor(a, b);
      const resumed = incident.kind === 'war' && pair.state === 'peace';
      transition(pair, incident.kind === 'war' ? 'war' : 'peace', incident.turn);
      if (incident.kind === 'peace') pair.peaceAnchored = true;
      nativePairs.set(diplomacyPairKey(a, b), incident.turn);
      if (resumed && incident.stage === 'declaration') incident.stage = 'resumed';
    }
  }

  // Process final-per-turn observations once per directed pair. Native transitions anchor same-turn continuity.
  const observations = new Map<
    string,
    {
      row: DiplomacyFacts['snapshots'][number];
      relation: DiplomacyFacts['snapshots'][number]['relationships'][number];
    }
  >();
  for (const row of facts.snapshots)
    for (const relation of row.relationships) {
      if (row.subjectID === relation.targetPlayerID) continue;
      const pair = pairFor(row.subjectID, relation.targetPlayerID);
      if (row.subjectID !== pair.perspective && row.isMajor) continue;
      const key = `${diplomacyPairKey(row.subjectID, relation.targetPlayerID)}/${row.source.turn}`;
      const before = observations.get(key);
      if (
        !before ||
        (row.subjectID === pair.perspective && before.row.subjectID !== pair.perspective) ||
        ((row.subjectID === pair.perspective) === (before.row.subjectID === pair.perspective) &&
          row.source.id > before.row.source.id)
      )
        observations.set(key, { row, relation });
    }
  const observedTransitions = new Map<
    string,
    { pair: DiplomacyPair; previousState: DiplomacyPair['state']; source: NewspaperSourceReference }
  >();
  for (const { row, relation } of [...observations.values()].sort(
    (a, b) => a.row.source.turn - b.row.source.turn || a.row.source.id - b.row.source.id
  )) {
    const pair = pairFor(row.subjectID, relation.targetPlayerID);
    if ((pair.since !== null && row.source.turn < pair.since) || relation.state === 'unknown')
      continue;
    const nativeTurn = nativePairs.get(diplomacyPairKey(...pair.players));
    if (nativeTurn === row.source.turn && pair.state !== relation.state) continue;
    const previousState = pair.state;
    const isNew = pair.lastObserved === null || row.source.turn > pair.lastObserved;
    const nativeAnchor = nativeTurn === row.source.turn && pair.samples.length === 0;
    if (!isNew && !nativeAnchor) continue;
    if (pair.state !== relation.state) {
      transition(pair, relation.state, row.source.turn);
      if (row.source.turn > lastCheck && nativeTurn !== row.source.turn)
        observedTransitions.set(diplomacyPairKey(...pair.players), {
          pair,
          previousState,
          source: row.source,
        });
    } else if (
      pair.state === 'peace' &&
      pair.lastObserved !== null &&
      facts.standard(row.source.turn - pair.lastObserved) > peaceMaxGap
    ) {
      pair.since = row.source.turn;
    }
    if (isNew || nativeTurn === row.source.turn) pair.lastObserved = row.source.turn;
    if (
      relation.state !== 'war' ||
      facts.major(pair.players[0]) !== true ||
      facts.major(pair.players[1]) !== true ||
      relation.warScore === undefined ||
      !Number.isFinite(relation.warScore) ||
      Math.abs(relation.warScore) > 100
    )
      continue;
    const sourceKey = `${row.source.table}/${row.source.id}`;
    if (
      pair.samples.some(
        (sample) =>
          `${sample.source.table}/${sample.source.id}` === sourceKey ||
          sample.turn === row.source.turn
      )
    )
      continue;
    pair.samples.push({ turn: row.source.turn, score: relation.warScore, source: row.source });
    pair.samples = pair.samples
      .filter((sample) => facts.standard(cutoff - sample.turn) <= diplomacyHistoryStandardTurns)
      .sort((a, b) => a.turn - b.turn);
  }

  for (const incident of incidents) {
    if (!incident.root) {
      audit.push(incident.audit);
      continue;
    }
    const [a, b] = incident.root;
    if (facts.major(a) === false && facts.major(b) === false) {
      audit.push(incident.audit);
      continue;
    }
    let stage = incident.stage;
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
      const knownRemaining = Object.values(memory.pairs).some(
        (pair) =>
          pair.state === 'war' &&
          pair.players.some((player) => player === a || player === b) &&
          pair.lastObserved !== null &&
          facts.standard(cutoff - pair.lastObserved) <= causalFreshness
      );
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
    incident.sources = uniqueSources([...incident.sources, ...relationshipSources]);
    incident.audit.sources = incident.sources;
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
  for (const change of observedTransitions.values()) {
    const { pair, source, previousState } = change;
    const [a, b] = pair.players;
    if (
      (facts.major(a) === false && facts.major(b) === false) ||
      pair.state !== 'war' ||
      alliancePairKeys.has(`${diplomacyPairKey(a, b)}/${source.turn}`)
    )
      continue;
    const inherited =
      inheritedWar(facts, a, b, source.turn) ?? inheritedWar(facts, b, a, source.turn);
    const stage =
      inherited !== undefined
        ? 'inheritedWars'
        : previousState === 'peace'
          ? 'resumed'
          : 'observed';
    const key = `observed/${diplomacyPairKey(a, b)}/${source.turn}`;
    audit.push({
      incidentId: key,
      kind: 'continuity',
      stage,
      participants: [a, b],
      participationCause: stage,
      confidence: 'corroborated',
      alternatives: ['The declaration sequence is unavailable.'],
      sources: [source],
    });
  }

  // A later city-state alliance can move an existing war without a new major declaration.
  const reportedAlliances = new Set<string>();
  for (const change of allianceChanges) {
    const { row, prior, event, opponents, ally } = change;
    const key = `alliance/${row.subjectID}/${row.source.turn}`;
    if (reportedAlliances.has(key)) continue;
    reportedAlliances.add(key);
    const sources = uniqueSources([prior.source, row.source, ...(event ? [event.source] : [])]);
    const players = [ally, opponents[0].targetPlayerID];
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

  for (const pair of Object.values(memory.pairs))
    pair.samples = pair.samples.filter(
      (sample) => facts.standard(cutoff - sample.turn) <= diplomacyHistoryStandardTurns
    );
  return { memory, audit };
}
