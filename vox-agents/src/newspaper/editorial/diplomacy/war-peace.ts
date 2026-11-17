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
import type { EditorialConfig } from '../config/schema.js';
import type { DetectedTrigger } from '../triggers.js';
import { evaluateCondition } from '../shared/conditions.js';
import { evidenceConditionContext, type EditorialContext } from '../shared/context.js';
import { uniqueSources } from '../shared/sources.js';
import {
  createDiplomacyPair,
  diplomacyFacts,
  diplomacyPairKey,
  type DiplomacyFacts,
} from './diplomacy-facts.js';
import { reconstructDiplomaticIncidents } from './diplomacy-incidents.js';
import {
  detectWarProgress,
  rearmWarProgress,
  warHistorySettings,
  type WarProgress,
} from './war-progress.js';

export const diplomacyDetectors = [
  'warTransition',
  'peaceTransition',
  'warProgress',
  'enduringPeace',
];
export interface DiplomacyCheck {
  memory: DiplomacyMemory;
  triggers: DetectedTrigger[];
  audit: DiplomacyInference[];
}

/** Reset a pair's score and editorial continuity whenever peace or renewed war changes its state. */
function transition(pair: DiplomacyPair, state: 'war' | 'peace', turn: number): void {
  if (pair.state === state) return;
  pair.peaceAnchored = state === 'peace' && pair.state === 'war';
  pair.state = state;
  pair.since = turn;
  pair.lastObserved = turn;
  pair.samples = [];
  pair.lastPublication = null;
  pair.lastKinds = {};
  pair.advantageArmed = true;
  pair.commandingArmed = true;
  pair.enduringPublished = false;
  pair.stagnationScore = null;
  pair.stagnationEpisodeTurn = turn;
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

/** Build new configured diplomacy triggers and the checkpoint retained even when the issue is skipped. */
export function detectWarAndPeace(
  evidence: NewspaperEvidence,
  config: EditorialConfig,
  context: EditorialContext,
  previous: DiplomacyMemory = { pairs: {} }
): DiplomacyCheck {
  const memory = structuredClone(previous);
  const triggers: DetectedTrigger[] = [];
  const audit: DiplomacyInference[] = [];
  if (
    !config.triggers.some(
      (entry) => diplomacyDetectors.includes(entry.detector) && entry.enabled !== false
    )
  )
    return { memory, triggers, audit };
  const causalFreshness =
    config.triggers.find(
      (entry) => entry.detector === 'warTransition' && entry.stage === 'declaration'
    )?.tuning?.freshness ?? 5;
  const facts = diplomacyFacts(evidence, context, causalFreshness);
  const historyWindow = warHistorySettings(config).window;
  const peaceMaxGap =
    config.triggers.find((entry) => entry.detector === 'enduringPeace')?.tuning?.maxGap ?? 10;
  const {
    cutoffTurn: cutoff,
    receiverPlayerID: receiver,
    previousCheckTurn: lastCheck,
  } = evidence.request;
  const conditionContext = evidenceConditionContext(evidence, context);
  /** Get one stable pair whose perspective does not depend on whichever ally supplied a snapshot. */
  function pairFor(a: number, b: number): DiplomacyPair {
    const key = diplomacyPairKey(a, b);
    return (memory.pairs[key] ??= createDiplomacyPair(a, b, receiver));
  }
  /** Resolve the same factual placeholders for eligibility checks and authored stories. */
  function storyValues(
    players: number[],
    values: Record<string, string | number>,
    participantCount = players.length
  ): Record<string, string | number> {
    return {
      firstParty: players[0] === undefined ? 'another civilization' : facts.name(players[0]),
      secondParty: players[1] === undefined ? 'another civilization' : facts.name(players[1]),
      direction: 'unknown',
      participantCount,
      cityStateNames: '',
      cityStates: '',
      participantDetails: '',
      concessionTypes: '',
      cityState: '',
      newAlly: '',
      ...values,
      scope:
        values.scope === 'domestic' || players.includes(receiver) ? 'domestic' : 'international',
    };
  }
  /** Resolve publication eligibility before a progress stage takes precedence over another stage. */
  function eligibleDefinitions(
    detector: string,
    stage: string,
    players: number[],
    values: Record<string, string | number>
  ) {
    const resolved = storyValues(players, values);
    const domestic = resolved.scope === 'domestic';
    return config.triggers.filter(
      (definition) =>
        definition.detector === detector &&
        definition.stage === stage &&
        definition.enabled !== false &&
        (domestic || definition.tuning?.foreign !== false) &&
        evaluateCondition(definition.condition, {
          ...conditionContext,
          values: { ...conditionContext.values, ...resolved, stage },
        }) === true
    );
  }
  /** Supply the actual directional score values used by both stage eligibility and the authored account. */
  function progressValues(
    pair: DiplomacyPair,
    progress: WarProgress
  ): Record<string, string | number> {
    const opponent = pair.players.find((player) => player !== pair.perspective)!;
    return {
      partner: facts.name(opponent),
      perspective: facts.name(pair.perspective),
      score: progress.score,
      previousScore: progress.previousScore,
      scoreChange: progress.score - progress.previousScore,
      advantageSide: facts.name(progress.score >= 0 ? pair.perspective : opponent),
      eventTurn: cutoff,
    };
  }
  /** Materialize one supported stage with a separate incident conflict identity. */
  function add(
    detector: string,
    stage: string,
    key: string,
    players: number[],
    values: Record<string, string | number>,
    sources: NewspaperSourceReference[],
    inference: DiplomacyInference,
    urgent = false
  ): void {
    sources = uniqueSources(sources).filter((source) => source.turn <= cutoff);
    const resolved = storyValues(players, values, inference.participants.length);
    for (const definition of eligibleDefinitions(detector, stage, players, resolved)) {
      if (!sources.length) continue;
      const domestic = values.scope === 'domestic' || players.includes(receiver);
      if (!domestic && definition.tuning?.foreign === false) continue;
      const triggerId = `${definition.id}/${key}`;
      const realPair = players.length === 2 ? diplomacyPairKey(players[0], players[1]) : undefined;
      triggers.push({
        id: triggerId,
        definitionId: definition.id,
        subject: key,
        seriesKeys: realPair
          ? [`diplomacy/${realPair}/war`]
          : [
              `diplomacy/${players
                .slice()
                .sort((a, b) => a - b)
                .join('/')}/war`,
            ],
        conflictKeys: [`diplomacy-incident/${key}`],
        period: {
          from: Math.min(...sources.map((source) => source.turn)),
          to: Math.max(...sources.map((source) => source.turn)),
        },
        importance: Math.min(
          config.defaults.importanceMax,
          config.defaults.importanceMax / definition.scale
        ),
        urgent,
        tags: [...new Set([...definition.tags, domestic ? 'domestic' : 'international'])],
        values: { ...resolved, stage },
        sources,
        summary: `${detector}/${stage}: ${inference.participationCause}; ${players.map(facts.name).join(', ')}.`,
        fingerprint: triggerId,
      });
    }
    if (!audit.some((entry) => entry.incidentId === inference.incidentId)) audit.push(inference);
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
    rearmWarProgress(pair, relation.warScore, row.source.turn, config);
    pair.samples.push({ turn: row.source.turn, score: relation.warScore, source: row.source });
    pair.samples = pair.samples
      .filter((sample) => facts.standard(cutoff - sample.turn) <= historyWindow)
      .sort((a, b) => a.turn - b.turn);
  }

  for (const incident of incidents) {
    const participants = incident.participants.map((entry) => entry.id);
    if (!incident.root) {
      // Missing roots still permit a broad account, without promoting a recursive marker to a declaration.
      const origin = incident.events[0].values.OriginatingPlayerID;
      if (typeof origin === 'number' && origin === receiver)
        add(
          incident.kind === 'war' ? 'warTransition' : 'peaceTransition',
          incident.kind === 'war' ? 'observed' : 'agreement',
          incident.id,
          [receiver],
          {
            participants: facts.name(receiver),
            eventTurn: incident.turn,
            rootInitiator: facts.name(receiver),
            rootTarget: 'another civilization',
            partner: 'another civilization',
            rootIntent: 'unknown',
          },
          incident.sources,
          incident.audit
        );
      else audit.push(incident.audit);
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
    const domestic = participants.includes(receiver);
    const minorExamples = incident.participants
      .filter((entry) => facts.major(entry.id) === false)
      .slice(0, 3)
      .map((entry) => facts.name(entry.id));
    const majors = incident.participants
      .filter((entry) => facts.major(entry.id) !== false)
      .map((entry) => facts.name(entry.id));
    if (incident.kind === 'war') {
      const inherited =
        inheritedWar(facts, a, b, incident.turn) ?? inheritedWar(facts, b, a, incident.turn);
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
      const knownRemaining = Object.values(memory.pairs).filter(
        (pair) =>
          pair.state === 'war' &&
          pair.players.some((player) => player === a || player === b) &&
          pair.lastObserved !== null &&
          facts.standard(cutoff - pair.lastObserved) <= causalFreshness
      );
      if (knownRemaining.length && ['agreement', 'quietFronts'].includes(stage)) stage = 'partial';
      else if (!knownRemaining.length && stage === 'agreement' && domestic) stage = 'quietFronts';
    }
    const ownPair =
      incident.pairs.find((pair) => pair.players.includes(receiver))?.players ?? incident.root;
    incident.audit.participationCause =
      inheritedWar(facts, a, b, incident.turn) !== undefined ? 'inheritedWars' : cause;
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
            ? [facts.ally(entry.id, incident.turn, incident.events.at(-1)!.source.id)?.source]
            : []),
        ].filter((source): source is NewspaperSourceReference => !!source)
      );
    incident.sources = uniqueSources([...incident.sources, ...relationshipSources]);
    incident.audit.sources = incident.sources;
    const participantDetails = incident.participants
      .filter(
        (entry) => !['root', 'target'].includes(entry.cause) && facts.major(entry.id) !== false
      )
      .map((entry) =>
        incident.kind === 'peace'
          ? `${facts.name(entry.id)} is included alongside ${facts.name(entry.anchor ?? entry.side)}.`
          : entry.cause === 'followingMaster'
            ? `${facts.name(entry.id)} follows its master, ${facts.name(entry.anchor ?? entry.side)}, into the conflict.`
            : entry.cause === 'vassalsJoining'
              ? `${facts.name(entry.id)} takes up the war of its vassal, ${facts.name(entry.anchor ?? entry.side)}.`
              : entry.cause === 'defensivePact'
                ? `${facts.name(entry.id)} joins through a defensive pact with ${facts.name(entry.anchor ?? entry.side)}.`
                : `${facts.name(entry.id)} joins the conflict.`
      )
      .join(' ');
    add(
      incident.kind === 'war' ? 'warTransition' : 'peaceTransition',
      stage,
      incident.id,
      ownPair,
      {
        participants: majors.join(', '),
        eventTurn: incident.turn,
        scope: domestic ? 'domestic' : 'international',
        firstParty: facts.name(a),
        secondParty: facts.name(b),
        direction: incident.deliberate
          ? a === receiver
            ? 'initiated'
            : b === receiver
              ? 'imposed'
              : 'foreign'
          : 'unknown',
        participantDetails,
        participantCount: participants.length,
        cityStateNames: minorExamples.join(', '),
        concessionTypes: incident.concessionTypes,
        rootInitiator: facts.name(a),
        rootTarget: facts.name(b),
        rootIntent: incident.deliberate ? 'likely' : 'unknown',
        partner: facts.name(a === receiver ? b : a),
        cityStates: minorExamples.length
          ? `City-state participants include ${minorExamples.join(', ')}.`
          : '',
      },
      incident.sources,
      incident.audit,
      incident.kind === 'war' && ownParticipation?.side === b
    );
  }

  const allianceChanges = facts.snapshots.flatMap((row) => {
    if (row.isMajor || row.source.turn <= lastCheck) return [];
    const prior = facts.snapshots
      .filter(
        (before) => before.subjectID === row.subjectID && before.source.turn < row.source.turn
      )
      .at(-1);
    if (
      !prior ||
      facts.standard(row.source.turn - prior.source.turn) > causalFreshness ||
      row.majorAllyPlayerID === undefined ||
      row.majorAllyPlayerID === prior.majorAllyPlayerID ||
      row.majorAllyPlayerID === null
    )
      return [];
    const opponents = row.relationships.filter(
      (relation) =>
        isAtWar(relation) &&
        prior.relationships.some(
          (before) => before.targetPlayerID === relation.targetPlayerID && before.state === 'peace'
        ) &&
        isAtWar(
          facts.relationship(row.majorAllyPlayerID!, relation.targetPlayerID, row.source.turn)
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
    return [{ row, prior, opponents, event }];
  });
  /** Share alliance facts between transition coverage and the actual alliance story. */
  function allianceValues(
    change: (typeof allianceChanges)[number]
  ): Record<string, string | number> {
    const { row, opponents } = change;
    const players = [row.majorAllyPlayerID!, opponents[0].targetPlayerID];
    return {
      cityState: facts.name(row.subjectID),
      newAlly: facts.name(row.majorAllyPlayerID!),
      participants: players.map(facts.name).join(', '),
      participantCount: players.length + 1,
      partner: facts.name(row.majorAllyPlayerID!),
      eventTurn: row.source.turn,
      rootInitiator: 'unknown',
      rootTarget: 'unknown',
      rootIntent: 'unknown',
    };
  }
  const eligibleAllianceChanges = allianceChanges.filter(
    (change) =>
      eligibleDefinitions(
        'warTransition',
        'allianceChange',
        [change.row.majorAllyPlayerID!, change.opponents[0].targetPlayerID],
        allianceValues(change)
      ).length > 0
  );
  const alliancePairKeys = new Set(
    eligibleAllianceChanges.flatMap((change) =>
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
    const inference: DiplomacyInference = {
      incidentId: key,
      kind: 'continuity',
      participants: [a, b],
      participationCause: stage,
      confidence: 'corroborated',
      alternatives: ['The declaration sequence is unavailable.'],
      sources: [source],
    };
    add(
      'warTransition',
      stage,
      key,
      [a, b],
      {
        participants: `${facts.name(a)}, ${facts.name(b)}`,
        partner: facts.name(a === receiver ? b : a),
        rootInitiator: 'unknown',
        rootTarget: 'unknown',
        rootIntent: 'unknown',
        eventTurn: source.turn,
      },
      [source],
      inference
    );
  }

  // A later city-state alliance can move an existing war without a new major declaration.
  for (const change of eligibleAllianceChanges) {
    const { row, prior, event, opponents } = change;
    const key = `alliance/${row.subjectID}/${row.source.turn}`;
    const sources = uniqueSources([prior.source, row.source, ...(event ? [event.source] : [])]);
    const players = [row.majorAllyPlayerID!, opponents[0].targetPlayerID];
    add('warTransition', 'allianceChange', key, players, allianceValues(change), sources, {
      incidentId: key,
      kind: 'war',
      participants: [row.subjectID, ...players],
      participationCause: 'allianceChange',
      confidence: 'corroborated',
      alternatives: [],
      sources,
    });
  }

  for (const [key, pair] of Object.entries(memory.pairs)) {
    pair.samples = pair.samples.filter(
      (sample) => facts.standard(cutoff - sample.turn) <= historyWindow
    );
    if (
      pair.state === 'war' &&
      facts.major(pair.players[0]) === true &&
      facts.major(pair.players[1]) === true
    ) {
      const progress = detectWarProgress(
        pair,
        facts,
        cutoff,
        config,
        (development) =>
          eligibleDefinitions(
            'warProgress',
            development.stage,
            pair.players,
            progressValues(pair, development)
          ).length > 0
      );
      if (!progress) continue;
      const inference: DiplomacyInference = {
        incidentId: `progress/${key}/${progress.stage}/${progress.signature}`,
        kind: 'progress',
        participants: pair.players,
        participationCause: progress.stage,
        confidence: 'corroborated',
        alternatives: [],
        sources: progress.sources,
      };
      add(
        'warProgress',
        progress.stage,
        inference.incidentId,
        pair.players,
        progressValues(pair, progress),
        progress.sources,
        inference
      );
    } else if (
      pair.state === 'peace' &&
      pair.peaceAnchored &&
      pair.since !== null &&
      !pair.enduringPublished &&
      pair.lastObserved !== null
    ) {
      const definition = config.triggers.find(
        (entry) => entry.detector === 'enduringPeace' && entry.enabled !== false
      );
      if (
        !definition ||
        (!pair.players.includes(receiver) && definition.tuning?.foreign !== true) ||
        facts.standard(cutoff - pair.since) < (definition.tuning?.persistence ?? 25) ||
        facts.standard(cutoff - pair.lastObserved) > (definition.tuning?.freshness ?? 5)
      )
        continue;
      const sources = facts.snapshots
        .filter(
          (row) =>
            pair.players.includes(row.subjectID) &&
            row.source.turn >= pair.since! &&
            row.relationships.some(
              (relation) =>
                relation.targetPlayerID ===
                  pair.players.find((player) => player !== row.subjectID) &&
                relation.state === 'peace'
            )
        )
        .map((row) => row.source);
      const inference: DiplomacyInference = {
        incidentId: `enduring/${key}/${pair.since}`,
        kind: 'continuity',
        participants: pair.players,
        participationCause: 'enduring',
        confidence: 'corroborated',
        alternatives: [],
        sources,
      };
      add(
        'enduringPeace',
        'enduring',
        inference.incidentId,
        pair.players,
        {
          partner: facts.name(pair.players.find((player) => player !== pair.perspective)!),
          perspective: facts.name(pair.perspective),
          peaceTurns: Math.floor(facts.standard(cutoff - pair.since)),
          eventTurn: cutoff,
        },
        sources,
        inference
      );
    }
  }
  return { memory, triggers, audit };
}

/** Record only displayed progress stories; candidate generation and skipped checks never consume publication arms. */
export function recordDiplomacyPublications(
  memory: DiplomacyMemory,
  publishedTriggerIds: string[],
  triggers: DetectedTrigger[],
  cutoff: number
): void {
  for (const trigger of triggers.filter((entry) => publishedTriggerIds.includes(entry.id))) {
    const series = trigger.seriesKeys.find((key) => key.startsWith('diplomacy/'));
    const key = series?.slice('diplomacy/'.length, -'/war'.length);
    const pair = key === undefined ? undefined : memory.pairs[key];
    if (!pair) continue;
    const stage = String(trigger.values.stage);
    if (trigger.subject.startsWith('progress/')) {
      pair.lastPublication = cutoff;
      // The subject carries the development signature after the pair and stage.
      const marker = `progress/${key}/${stage}/`;
      pair.lastKinds[stage] = trigger.subject.slice(marker.length);
      if (stage === 'advantage' || stage === 'commanding' || stage === 'reversal')
        pair.advantageArmed = false;
      if (stage === 'commanding') pair.commandingArmed = false;
      if (stage === 'stagnation') pair.stagnationScore = Number(trigger.values.score);
    }
    if (stage === 'enduring') pair.enduringPublished = true;
  }
}
