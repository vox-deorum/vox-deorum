/** Controlled projected observations shared by diplomacy inference and rule tests. */
import type { NewspaperDiplomacySnapshot, NewspaperEvent, NewspaperEvidence } from '../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialContext } from '../../src/newspaper/editorial/shared/context.js';

type Relationship = NewspaperDiplomacySnapshot['relationships'][number];
const names = { '0': 'France', '1': 'Brazil', '2': 'India', '3': 'Iroquois', '4': 'Byzantium', '5': 'Zulu', '10': 'Geneva', '11': 'Sidon', '12': 'Riga', '13': 'Kabul', '14': 'Unmet' };
export const context: EditorialContext = { playerNames: names, playerTeamIds: Object.fromEntries(Object.keys(names).map(id => [id, Number(id) + 100])), receiverTeamId: 100,
  majorPlayerIds: [0, 1, 2, 3, 4, 5], standardTurnsPerGameTurn: 1 };

/** Supply a resolved public relationship with optional directional war score and agreements. */
export function relationship(target: number, state: Relationship['state'] = 'peace', extra: Partial<Relationship> = {}): Relationship {
  return { targetPlayerID: target, targetTeamID: target + 100, state, ...extra };
}
/** Build a dated public diplomacy observation with stable source identity. */
export function snapshot(player: number, turn: number, relationships: Relationship[], extra: Partial<NewspaperDiplomacySnapshot> = {}): NewspaperDiplomacySnapshot {
  return { subjectID: player, teamID: player + 100, isMajor: player < 10, relationships,
    source: { table: 'PlayerSummaries', id: turn * 100 + player, turn, createdAt: turn * 1000 }, ...extra };
}
/** Preserve separate native calls even when their event payloads match. */
export function event(type: string, id: number, turn: number, origin: number, target: number, extra: Record<string, unknown> = {}): NewspaperEvent {
  return { type, values: { OriginatingPlayerID: origin, TargetTeamID: target + 100, ...extra },
    source: { table: 'GameEvents', id, turn, createdAt: turn * 1000 } };
}
/** Build the smallest complete evidence envelope with only explicitly visible players. */
export function evidence(events: NewspaperEvent[] = [], history: NewspaperDiplomacySnapshot[] = [], cutoff = 10, previous = 5, receiver = 0): NewspaperEvidence {
  const visible = [...new Set([receiver, ...history.flatMap(row => [row.subjectID, ...row.relationships.map(relation => relation.targetPlayerID)])])];
  return { request: { receiverPlayerID: receiver, cutoffTurn: cutoff, previousCheckTurn: previous, comparisonRange: { fromTurn: Math.max(0, cutoff - 30), toTurn: cutoff } },
    players: visible.map(subjectID => ({ subjectID, values: {}, source: { table: 'PlayerSummaries', id: cutoff * 10000 + subjectID, turn: cutoff, createdAt: cutoff * 1000 } })),
    cities: [], comparisons: { players: [], cities: [] }, events,
    diplomacy: { fromTurn: Math.max(0, cutoff - 30), baseline: [], history, gaps: [] } };
}
/** Provide a continuous fixed-perspective major-war score history. */
export function scores(values: [number, number][], previous = 0): NewspaperEvidence {
  return evidence([], values.map(([turn, warScore]) => snapshot(0, turn, [relationship(1, 'war', { warScore })])), values.at(-1)![0], previous);
}
