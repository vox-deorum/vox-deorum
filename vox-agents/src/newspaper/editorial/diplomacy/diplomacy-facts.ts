/** Shared dated diplomacy lookup and stable identity for reconstructed newspaper incidents. */
import type {
  NewspaperEvidence,
  NewspaperSourceReference,
  NewspaperDiplomacySnapshot,
} from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialContext } from '../shared/context.js';
import type { DiplomacyPair } from '../../contracts/diplomacy.js';
type NewspaperDiplomacyRelationship = NewspaperDiplomacySnapshot['relationships'][number];

/** Canonical pair identity is independent of the reporting perspective. */
export function diplomacyPairKey(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join('/');
}
/** Begin continuity only from observations or a supported native transition. */
export function createDiplomacyPair(a: number, b: number, receiver: number): DiplomacyPair {
  const players = [a, b].sort((x, y) => x - y) as [number, number];
  return {
    players,
    perspective: players.includes(receiver) ? receiver : players[0],
    state: 'unknown',
    since: null,
    lastObserved: null,
    samples: [],
    lastPublication: null,
    advantageArmed: true,
    commandingArmed: true,
    lastKinds: {},
    enduringPublished: false,
    peaceAnchored: false,
    stagnationScore: null,
    stagnationEpisodeTurn: null,
  };
}
/** Distinguish native call IDs from service-created events in the reserved per-turn offset range. */
export function nativeDiplomacySource(source: NewspaperSourceReference): boolean {
  return source.table === 'GameEvents' && source.id % 1_000_000 < 900_000;
}

export interface DiplomacyFacts {
  snapshots: NewspaperDiplomacySnapshot[];
  causalFreshness: number;
  team: (player: number) => number | undefined;
  member: (team: number) => number | undefined;
  major: (player: number) => boolean | undefined;
  name: (player: number) => string;
  observation: (
    player: number,
    turn: number,
    fresh?: boolean
  ) => NewspaperDiplomacySnapshot | undefined;
  relationship: (
    a: number,
    b: number,
    turn: number,
    fresh?: boolean
  ) => NewspaperDiplomacyRelationship | undefined;
  source: (a: number, turn: number, target?: number) => NewspaperSourceReference | undefined;
  ally: (
    minor: number,
    turn: number,
    beforeId?: number,
    opponent?: number
  ) =>
    { playerID: number | null; source: NewspaperSourceReference; inferred?: boolean } | undefined;
  standard: (turns: number) => number;
  priorState: (a: number, b: number, turn: number) => 'war' | 'peace' | undefined;
}
/** Resolve unique team members and prefer fresh earlier relationships for causal explanations. */
export function diplomacyFacts(
  evidence: NewspaperEvidence,
  context: EditorialContext,
  causalFreshness = 5
): DiplomacyFacts {
  const snapshots = [
    ...(evidence.diplomacy?.baseline ?? []),
    ...(evidence.diplomacy?.history ?? []),
  ]
    .filter((row) => row.source.turn <= evidence.request.cutoffTurn)
    .sort((a, b) => a.source.turn - b.source.turn || a.source.id - b.source.id);
  const visible = new Set(
    [...evidence.players, ...evidence.comparisons.players, ...snapshots].map((row) => row.subjectID)
  );
  visible.add(evidence.request.receiverPlayerID);
  for (const row of snapshots)
    for (const entry of row.relationships) visible.add(entry.targetPlayerID);
  const teams = new Map<number, number>(
    Object.entries(context.playerTeamIds ?? {})
      .filter(([id]) => visible.has(Number(id)))
      .map(([id, team]) => [Number(id), team])
  );
  const majors = new Map<number, boolean>(context.majorPlayerIds?.map((id) => [id, true]) ?? []);
  for (const row of snapshots) {
    teams.set(row.subjectID, row.teamID);
    majors.set(row.subjectID, row.isMajor);
  }
  if (context.receiverTeamId !== undefined)
    teams.set(evidence.request.receiverPlayerID, context.receiverTeamId);
  const rate =
    context.standardTurnsPerGameTurn && context.standardTurnsPerGameTurn > 0
      ? context.standardTurnsPerGameTurn
      : 1;
  /** Prefer a prior row; same-turn rows can corroborate an obligation when no fresh prior survives. */
  function observation(
    player: number,
    turn: number,
    fresh = true
  ): NewspaperDiplomacySnapshot | undefined {
    const rows = snapshots.filter(
      (row) =>
        row.subjectID === player &&
        row.source.turn <= turn &&
        (!fresh || (turn - row.source.turn) * rate <= causalFreshness)
    );
    return rows.filter((row) => row.source.turn < turn).at(-1) ?? rows.at(-1);
  }
  /** Return one already parsed and permitted directed relationship. */
  function relationship(
    a: number,
    b: number,
    turn: number,
    fresh = true
  ): NewspaperDiplomacyRelationship | undefined {
    return (
      observation(a, turn, fresh)?.relationships.find((entry) => entry.targetPlayerID === b) ??
      snapshots
        .filter((row) => row.subjectID === a && row.source.turn === turn)
        .at(-1)
        ?.relationships.find((entry) => entry.targetPlayerID === b)
    );
  }
  /** Fold preceding native alliance changes over a prior snapshot without using later same-turn changes. */
  function ally(
    minor: number,
    turn: number,
    beforeId = Infinity,
    opponent?: number
  ): { playerID: number | null; source: NewspaperSourceReference; inferred?: boolean } | undefined {
    const row = observation(minor, turn);
    let result:
      | { playerID: number | null; source: NewspaperSourceReference; inferred?: boolean }
      | undefined =
      row?.majorAllyPlayerID === undefined
        ? undefined
        : { playerID: row.majorAllyPlayerID, source: row.source };
    const changes = evidence.events
      .filter(
        (event) =>
          ['SetAlly', 'MinorAlliesChanged'].includes(event.type) &&
          nativeDiplomacySource(event.source) &&
          event.values.MinorPlayerID === minor &&
          event.source.turn <= turn &&
          (event.source.turn < turn || event.source.id < beforeId) &&
          (turn - event.source.turn) * rate <= causalFreshness &&
          (!row || event.source.turn >= row.source.turn)
      )
      .sort((a, b) => a.source.turn - b.source.turn || a.source.id - b.source.id);
    for (const event of changes) {
      const value =
        event.type === 'SetAlly' ? event.values.NewAllyPlayerID : event.values.MajorPlayerID;
      if (typeof value !== 'number' || !Number.isInteger(value)) continue;
      if (
        event.type === 'SetAlly' ||
        event.values.IsNowAlly === true ||
        event.values.IsNowAlly === 1
      )
        result = { playerID: value < 0 ? null : value, source: event.source };
      else if (
        (event.values.IsNowAlly === false || event.values.IsNowAlly === 0) &&
        result?.playerID === value
      )
        result = { playerID: null, source: event.source };
    }
    const explicitThisTurn = evidence.events.some(
      (event) =>
        ['SetAlly', 'MinorAlliesChanged'].includes(event.type) &&
        nativeDiplomacySource(event.source) &&
        event.values.MinorPlayerID === minor &&
        event.source.turn === turn
    );
    const current = snapshots
      .filter((candidate) => candidate.subjectID === minor && candidate.source.turn === turn)
      .at(-1);
    const corroborated = current?.relationships.some(
      (entry) =>
        entry.state === 'war' && entry.targetPlayerID === (opponent ?? row?.majorAllyPlayerID)
    );
    if (
      !explicitThisTurn &&
      current?.majorAllyPlayerID !== undefined &&
      current.majorAllyPlayerID !== result?.playerID &&
      corroborated
    )
      result = { playerID: current.majorAllyPlayerID, source: current.source, inferred: true };
    return result;
  }
  /** Resolve a prior explicit pair state; contradictory equally dated observations remain unknown. */
  function priorState(a: number, b: number, turn: number): 'war' | 'peace' | undefined {
    const rows = snapshots
      .filter(
        (row) =>
          row.source.turn < turn &&
          (turn - row.source.turn) * rate <= causalFreshness &&
          (row.subjectID === a || row.subjectID === b)
      )
      .flatMap((row) =>
        row.relationships
          .filter(
            (entry) =>
              entry.targetPlayerID === (row.subjectID === a ? b : a) && entry.state !== 'unknown'
          )
          .map((entry) => ({ turn: row.source.turn, state: entry.state }))
      );
    const latestTurn = Math.max(...rows.map((row) => row.turn));
    const states = new Set(rows.filter((row) => row.turn === latestTurn).map((row) => row.state));
    return states.size === 1 ? ([...states][0] as 'war' | 'peace') : undefined;
  }
  /** Resolve a known player's recorded team without assuming player and team IDs match. */
  function team(player: number): number | undefined {
    return teams.get(player);
  }
  /** Resolve a team only when its permitted metadata identifies one player. */
  function member(teamID: number): number | undefined {
    const members = [...teams].filter(([, id]) => id === teamID);
    return members.length === 1 ? members[0][0] : undefined;
  }
  /** Preserve missing major/minor metadata as unknown. */
  function major(player: number): boolean | undefined {
    return majors.get(player);
  }
  /** Label only identities supported by visible evidence. */
  function name(player: number): string {
    return visible.has(player)
      ? (context.playerNames?.[String(player)] ?? `Civilization ${player}`)
      : 'another civilization';
  }
  /** Cite the row that actually supplies the selected relationship or observation. */
  function source(
    player: number,
    turn: number,
    target?: number
  ): NewspaperSourceReference | undefined {
    const row = observation(player, turn);
    return target === undefined ||
      row?.relationships.some((entry) => entry.targetPlayerID === target)
      ? row?.source
      : snapshots
          .filter(
            (current) =>
              current.subjectID === player &&
              current.source.turn === turn &&
              current.relationships.some((entry) => entry.targetPlayerID === target)
          )
          .at(-1)?.source;
  }
  /** Convert recorded game turns into Standard-speed turns. */
  function standard(turns: number): number {
    return turns * rate;
  }
  return {
    snapshots,
    causalFreshness,
    team,
    member,
    major,
    name,
    observation,
    relationship,
    ally,
    source,
    standard,
    priorState,
  };
}
