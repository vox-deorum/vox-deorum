/** Exercise likely diplomacy accounts, continuity, score developments, and persistent editorial decisions. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperDiplomacySnapshot, NewspaperEvent, NewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, publicationStateSchema } from '../../../../src/newspaper/contracts/publication.js';
import type { DiplomacyMemory } from '../../../../src/newspaper/contracts/diplomacy.js';
import { loadEditorialConfig, type EditorialConfig } from '../../../../src/newspaper/editorial/config.js';
import { detectWarAndPeace, recordDiplomacyPublications } from '../../../../src/newspaper/editorial/war-peace.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { matchTemplates } from '../../../../src/newspaper/editorial/templates.js';
import type { EditorialContext } from '../../../../src/newspaper/editorial/triggers.js';

type Relationship = NewspaperDiplomacySnapshot['relationships'][number];
let config: EditorialConfig;
const names = { '0': 'France', '1': 'Brazil', '2': 'India', '3': 'Iroquois', '4': 'Byzantium', '5': 'Zulu', '10': 'Geneva', '11': 'Sidon', '12': 'Riga', '13': 'Kabul', '14': 'Unmet' };
const context: EditorialContext = { playerNames: names, playerTeamIds: Object.fromEntries(Object.keys(names).map(id => [id, Number(id) + 100])), receiverTeamId: 100,
  majorPlayerIds: [0, 1, 2, 3, 4, 5], standardTurnsPerGameTurn: 1 };

/** Supply a resolved public relationship with optional directional war score and agreements. */
function relationship(target: number, state: Relationship['state'] = 'peace', extra: Partial<Relationship> = {}): Relationship {
  return { targetPlayerID: target, targetTeamID: target + 100, state, ...extra };
}
/** Build a dated public diplomacy observation with stable source identity. */
function snapshot(player: number, turn: number, relationships: Relationship[], extra: Partial<NewspaperDiplomacySnapshot> = {}): NewspaperDiplomacySnapshot {
  return { subjectID: player, teamID: player + 100, isMajor: player < 10, relationships,
    source: { table: 'PlayerSummaries', id: turn * 100 + player, turn, createdAt: turn * 1000 }, ...extra };
}
/** Preserve separate native calls even when their event payloads match. */
function event(type: string, id: number, turn: number, origin: number, target: number, extra: Record<string, unknown> = {}): NewspaperEvent {
  return { type, values: { OriginatingPlayerID: origin, TargetTeamID: target + 100, ...extra },
    source: { table: 'GameEvents', id, turn, createdAt: turn * 1000 } };
}
/** Build the smallest complete evidence envelope with only explicitly visible players. */
function evidence(events: NewspaperEvent[] = [], history: NewspaperDiplomacySnapshot[] = [], cutoff = 10, previous = 5, receiver = 0): NewspaperEvidence {
  const visible = [...new Set([receiver, ...history.flatMap(row => [row.subjectID, ...row.relationships.map(relation => relation.targetPlayerID)])])];
  return { request: { receiverPlayerID: receiver, cutoffTurn: cutoff, previousCheckTurn: previous, comparisonRange: { fromTurn: Math.max(0, cutoff - 30), toTurn: cutoff } },
    players: visible.map(subjectID => ({ subjectID, values: {}, source: { table: 'PlayerSummaries', id: cutoff * 10000 + subjectID, turn: cutoff, createdAt: cutoff * 1000 } })),
    cities: [], comparisons: { players: [], cities: [] }, events,
    diplomacy: { fromTurn: Math.max(0, cutoff - 30), baseline: [], history, gaps: [] } };
}
/** Run the standalone detector with receiver-aware metadata and optional prior pair memory. */
function detect(input: NewspaperEvidence, memory?: DiplomacyMemory, catalogue = config) {
  return detectWarAndPeace(input, catalogue, { ...context, receiverTeamId: input.request.receiverPlayerID + 100 }, memory);
}
/** Provide a continuous fixed-perspective major-war score history. */
function scores(values: [number, number][], previous = 0): NewspaperEvidence {
  return evidence([], values.map(([turn, warScore]) => snapshot(0, turn, [relationship(1, 'war', { warScore })])), values.at(-1)![0], previous);
}
/** Extract a pair-progress stage while ignoring the broad initial observed-war account. */
function progress(result: ReturnType<typeof detect>): string | undefined { return result.triggers.find(trigger => trigger.subject.startsWith('progress/'))?.values.stage as string | undefined; }

describe('war and peace editorial inference', () => {
  beforeAll(async () => { config = await loadEditorialConfig(); });

  describe('local incident reconstruction', () => {
    it('should distinguish our declarations, imposed declarations and foreign openings without treating false as intent', () => {
      const observations = [snapshot(0, 9, [relationship(1)]), snapshot(1, 9, [relationship(2)])];
      for (const [origin, target, receiver, scope] of [[0, 1, 0, 'domestic'], [1, 0, 0, 'domestic'], [1, 2, 0, 'international']] as const) {
        const result = detect(evidence([event('DeclareWar', 1, 10, origin, target, { IsAggressor: true })], observations, 10, 5, receiver));
        expect(result.triggers).toHaveLength(1);
        expect(result.triggers[0]).toMatchObject({ definitionId: 'war-declaration', values: { scope, rootIntent: 'likely' } });
        expect(result.triggers[0].urgent).toBe(target === receiver);
        expect(result.audit[0].rootInitiator).toBe(origin);
      }
      const ambiguous = detect(evidence([event('DeclareWar', 1, 10, 1, 0, { IsAggressor: false })], observations));
      expect(ambiguous.triggers[0].values.rootIntent).toBe('unknown');
      expect(ambiguous.audit[0].alternatives.length).toBeGreaterThan(0);
    });

    it('should explain a defensive pact and vassals on both sides in one account without inventing recursive acting pairs', () => {
      const observations = [snapshot(0, 9, [relationship(1), relationship(3, 'peace', { vassal: 'voluntary' })]),
        snapshot(1, 9, [relationship(2, 'peace', { defensivePact: true }), relationship(4, 'peace', { vassal: 'capitulated' })]),
        snapshot(2, 9, [relationship(1, 'peace', { defensivePact: true })]), snapshot(3, 9, [relationship(0, 'peace', { master: 'voluntary' })]),
        snapshot(4, 9, [relationship(1, 'peace', { master: 'capitulated' })]),
        snapshot(2, 10, [relationship(0, 'war', { warScore: 0 })]), snapshot(3, 10, [relationship(1, 'war', { warScore: 0 })])];
      const calls = [event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }), event('DeclareWar', 2, 10, 0, 0, { IsAggressor: true }),
        event('DeclareWar', 3, 10, 0, 1, { IsAggressor: true }), event('DeclareWar', 4, 10, 0, 4, { IsAggressor: false })];
      const result = detect(evidence(calls, observations));
      expect(result.triggers).toHaveLength(1);
      expect(result.audit[0].participants.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
      expect(result.triggers[0].values.participantDetails).toContain(names['2']);
      expect(result.triggers[0].values.participantDetails).toContain(names['3']);
      expect(result.memory.pairs['0/0']).toBeUndefined();
      expect(result.audit[0].sources.filter(source => source.table === 'GameEvents')).toHaveLength(4);
      const vassalReader = detect(evidence(calls, observations, 10, 5, 3));
      expect(vassalReader.triggers[0].definitionId).toBe('war-following-master');
      expect(vassalReader.triggers[0].urgent).toBe(false);
      const pactReader = detect(evidence(calls, observations, 10, 5, 2));
      expect(pactReader.triggers[0].definitionId).toBe('war-defensive-pact');
      expect(pactReader.triggers[0].urgent).toBe(true);
      const foreign = detect(evidence(calls, observations, 10, 5, 5));
      expect(foreign.triggers[0].definitionId).toBe('war-vassals-joining');
    });

    it('should keep independent wars on the same turn separate and ignore dynamic event ordering', () => {
      const observations = [snapshot(0, 9, [relationship(1), relationship(2)]), snapshot(3, 9, [relationship(4)])];
      const calls = [event('DeclareWar', 3, 10, 3, 4, { IsAggressor: true }), event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }),
        event('DeclareWar', 2, 10, 0, 2, { IsAggressor: true }), event('DeclareWar', 10_900_001, 10, 1, 0)];
      const result = detect(evidence(calls, observations));
      expect(result.triggers).toHaveLength(3);
      expect(new Set(result.triggers.map(trigger => trigger.conflictKeys![0])).size).toBe(3);
    });

    it('should attach deep city-state and allied-vassal recursion through joined members of both sides', () => {
      const observations = [snapshot(0, 9, [relationship(1), relationship(3, 'peace', { vassal: 'voluntary' })]),
        snapshot(1, 9, [relationship(2, 'peace', { defensivePact: true })]),
        snapshot(2, 9, [relationship(1, 'peace', { defensivePact: true })]), snapshot(3, 9, [relationship(0, 'peace', { master: 'voluntary' })]),
        snapshot(10, 9, [relationship(0)], { majorAllyPlayerID: 2 }), snapshot(11, 9, [relationship(0)], { majorAllyPlayerID: 3 }),
        snapshot(2, 10, [relationship(0, 'war'), relationship(3, 'war')]), snapshot(3, 10, [relationship(1, 'war'), relationship(2, 'war')])];
      const calls = [event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }), event('DeclareWar', 2, 10, 0, 0, { IsAggressor: true }),
        event('DeclareWar', 3, 10, 0, 1), event('DeclareWar', 4, 10, 10, 3), event('DeclareWar', 5, 10, 11, 2), event('DeclareWar', 6, 10, 10, 11)];
      const result = detect(evidence(calls, observations));
      expect(result.triggers).toHaveLength(1);
      expect(result.audit[0].participants.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 10, 11]);
      expect(result.audit[0].sources.filter(source => source.table === 'GameEvents')).toHaveLength(6);
      expect(result.memory.pairs['2/3'].state).toBe('war');
    });

    it('should apply a preceding native alliance change without using a later or dynamic change to explain earlier calls', () => {
      const observations = [snapshot(0, 9, [relationship(1)]), snapshot(1, 9, [relationship(2, 'peace', { defensivePact: true })]),
        snapshot(2, 9, [relationship(1, 'peace', { defensivePact: true })]), snapshot(2, 10, [relationship(0, 'war')]),
        snapshot(10, 9, [relationship(0)], { majorAllyPlayerID: 1 }), snapshot(10, 10, [relationship(0)], { majorAllyPlayerID: 0 })];
      const changed: NewspaperEvent = { type: 'SetAlly', values: { MinorPlayerID: 10, OldAllyPlayerID: 1, NewAllyPlayerID: 0 },
        source: { table: 'GameEvents', id: 4, turn: 10, createdAt: 10000 } };
      const calls = [changed, event('DeclareWar', 10, 10, 0, 1, { IsAggressor: true }), event('DeclareWar', 11, 10, 0, 0), event('DeclareWar', 12, 10, 10, 2)];
      const result = detect(evidence(calls, observations));
      expect(result.triggers).toHaveLength(1);
      expect(result.audit[0].participants).toContain(10);
      expect(result.audit[0].sources.some(source => source.table === 'GameEvents' && source.id === 4)).toBe(true);
      const later = detect(evidence([{ ...changed, source: { ...changed.source, id: 20 } }, ...calls.slice(1)], observations));
      expect(later.audit.filter(entry => entry.kind === 'war')).toHaveLength(2);
      const dynamic = detect(evidence([{ ...changed, source: { ...changed.source, id: 10_900_001 } }, ...calls.slice(1)], observations));
      expect(dynamic.audit.filter(entry => entry.kind === 'war')).toHaveLength(2);
      const visibleAfter = observations.map(row => row.subjectID === 10 && row.source.turn === 10 ?
        { ...row, relationships: [relationship(1, 'war'), relationship(2, 'war')] } : row);
      const hiddenChange = detect(evidence(calls.slice(1), visibleAfter));
      expect(hiddenChange.triggers).toHaveLength(1);
      expect(hiddenChange.audit[0].alternatives.length).toBeGreaterThan(0);
      const knownLater = detect(evidence([{ ...changed, source: { ...changed.source, id: 20 } }, ...calls.slice(1)], visibleAfter));
      expect(knownLater.audit.filter(entry => entry.kind === 'war')).toHaveLength(2);
    });

    it('should retain a broad missing-root story and avoid naming hidden identities from global context', () => {
      const input = evidence([event('DeclareWar', 1, 10, 0, 14, { IsAggressor: true })]);
      const result = detect(input);
      expect(result.triggers).toHaveLength(1);
      expect(JSON.stringify(result.triggers[0].values)).not.toContain(names['14']);
      expect(result.audit[0].confidence).toBe('ambiguous');
      expect(result.triggers[0].urgent).toBe(false);
      expect(result.memory.pairs).toEqual({});
    });

    it('should distinguish a direct city-state attack from allied participation and cap minor examples', () => {
      const observations = [snapshot(0, 9, [relationship(1), relationship(10)]), snapshot(1, 9, [relationship(0, 'war')]),
        ...[10, 11, 12, 13].map(minor => snapshot(minor, 9, [relationship(0)], { majorAllyPlayerID: 1 }))];
      const direct = detect(evidence([event('DeclareWar', 1, 10, 0, 10, { IsAggressor: true })], observations));
      expect(direct.triggers[0].definitionId).toBe('war-city-state-attack');
      const joining = detect(evidence([event('DeclareWar', 1, 10, 10, 0, { IsAggressor: false })], observations));
      expect(joining.triggers[0].definitionId).toBe('war-city-state-joining');
      const cascade = detect(evidence([event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }),
        ...[10, 11, 12, 13].map((minor, index) => event('DeclareWar', index + 2, 10, minor, 0, { IsAggressor: false }))], observations));
      expect(cascade.triggers).toHaveLength(1);
      expect(cascade.audit[0].participants).toHaveLength(6);
      expect(cascade.triggers[0].values.cityStates).not.toContain(names['13']);
      expect(detect(evidence([event('DeclareWar', 1, 10, 10, 11)], observations)).triggers).toEqual([]);
    });

    it('should report later alliance-driven war participation and avoid a duplicate new opening', () => {
      const input = evidence([{ type: 'MinorAlliesChanged', values: { MinorPlayerID: 10, MajorPlayerID: 0, IsNowAlly: true },
        source: { table: 'GameEvents', id: 1, turn: 10, createdAt: 10000 } }],
      [snapshot(0, 9, [relationship(1, 'war')]), snapshot(10, 9, [relationship(1)], { majorAllyPlayerID: null }),
        snapshot(10, 10, [relationship(1, 'war')], { majorAllyPlayerID: 0 })]);
      const result = detect(input);
      expect(result.triggers.some(trigger => trigger.definitionId === 'war-alliance-change')).toBe(true);
      expect(result.triggers.filter(trigger => trigger.sources.some(source => source.id === 1010))).toHaveLength(1);
      const longstanding = structuredClone(input);
      longstanding.diplomacy!.history[1].relationships[0].state = 'war';
      expect(detect(longstanding).triggers.some(trigger => trigger.definitionId === 'war-alliance-change')).toBe(false);
      const unknown = structuredClone(input);
      unknown.diplomacy!.history[1].relationships = [];
      expect(detect(unknown).triggers.some(trigger => trigger.definitionId === 'war-alliance-change')).toBe(false);
      for (const rejected of [
        { ...config, triggers: config.triggers.map(entry => entry.stage === 'allianceChange' ? { ...entry, enabled: false } : entry) },
        { ...config, triggers: config.triggers.map(entry => entry.stage === 'allianceChange' ?
          { ...entry, condition: { op: 'eq' as const, field: 'newAlly', value: 'another ally' } } : entry) },
      ]) {
        const fallback = detect(input, undefined, rejected);
        expect(fallback.triggers.some(trigger => trigger.definitionId === 'war-alliance-change')).toBe(false);
        expect(fallback.triggers.some(trigger => trigger.definitionId === 'war-resumed' && trigger.sources.some(source => source.id === 1010))).toBe(true);
      }
    });

    it('should not credit an already active pact partner as newly joining a recursive declaration', () => {
      const input = evidence([event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }), event('DeclareWar', 2, 10, 0, 0)],
        [snapshot(0, 9, [relationship(1)]), snapshot(1, 9, [relationship(2, 'peace', { defensivePact: true })]),
          snapshot(2, 9, [relationship(0, 'war'), relationship(1, 'peace', { defensivePact: true })]), snapshot(2, 10, [relationship(0, 'war')])]);
      const result = detect(input);
      expect(result.audit.find(entry => entry.incidentId === 'war/10/1')!.participants).toEqual([0, 1]);
    });

    it.each(['master', 'vassal'] as const)('should infer inherited existing wars when a new voluntary %s relationship appears', kind => {
      const old = relationship(1);
      const relation = kind === 'master' ? relationship(1, 'peace', { master: 'voluntary' }) : relationship(1, 'peace', { vassal: 'voluntary' });
      const input = evidence([event('DeclareWar', 1, 10, 0, 2, { IsAggressor: false })],
        [snapshot(0, 9, [old, relationship(2)]), snapshot(1, 9, [relationship(2, 'war')]), snapshot(0, 10, [relation, relationship(2, 'war')])]);
      expect(detect(input).triggers[0].definitionId).toBe('war-inherited-wars');
    });
  });

  describe('settlements and continuity', () => {
    it('should retain a city-state war observed from the minor side when another front makes peace', () => {
      const result = detect(evidence([event('MakePeace', 1, 10, 0, 1)], [snapshot(0, 9, [relationship(1, 'war')]),
        snapshot(10, 9, [relationship(0, 'war')]), snapshot(10, 10, [relationship(0, 'war')])]));
      expect(result.memory.pairs['0/10']).toMatchObject({ state: 'war', perspective: 0, lastObserved: 10 });
      expect(result.triggers.some(trigger => trigger.definitionId === 'peace-partial')).toBe(true);
      expect(result.triggers.some(trigger => trigger.definitionId === 'peace-quiet-fronts')).toBe(false);
      const resumed = detect(evidence([], [snapshot(10, 11, [relationship(0)]), snapshot(10, 12, [relationship(0, 'war')])], 12, 10), result.memory);
      expect(resumed.triggers.find(trigger => trigger.definitionId === 'war-resumed')?.values.eventTurn).toBe(12);
    });
    it('should match visible concessions only to the following deal between the settling parties', () => {
      const calls = [event('MakePeace', 2, 10, 0, 1),
        { type: 'DealMade', values: { FromPlayerID: 0, ToPlayerID: 1, TradedItems: [{ ItemType: 'PeaceTreaty' }, { ItemType: 'Gold', Data1: 100 }] }, source: { table: 'GameEvents' as const, id: 3, turn: 10, createdAt: 10000 } }];
      const observations = [snapshot(0, 9, [relationship(1, 'war')])];
      expect(detect(evidence(calls, observations)).triggers[0].definitionId).toBe('peace-concessions');
      expect(detect(evidence(calls, observations)).triggers[0].values.concessionTypes).toBe('gold');
      calls[1].source.id = 1;
      expect(detect(evidence(calls, observations)).triggers[0].definitionId).toBe('peace-quiet-fronts');
      delete calls[1].values.TradedItems;
      const hidden = detect(evidence(calls, observations));
      expect(hidden.triggers[0].values.concessionTypes).toBe('');
    });

    it('should include peace cascades, distinguish capitulation, and keep a remaining known front active', () => {
      const observations = [snapshot(0, 9, [relationship(1, 'war'), relationship(2, 'war'), relationship(3, 'peace', { vassal: 'voluntary' })]),
        snapshot(3, 9, [relationship(0, 'peace', { master: 'voluntary' })]), snapshot(3, 10, [relationship(1)]),
        snapshot(0, 10, [relationship(1), relationship(2, 'war'), relationship(3, 'peace', { vassal: 'voluntary' })])];
      const calls = [event('MakePeace', 1, 10, 0, 1), event('MakePeace', 2, 10, 0, 1)];
      const result = detect(evidence(calls, observations));
      expect(result.triggers.filter(trigger => trigger.definitionId.startsWith('peace-'))).toHaveLength(1);
      expect(result.triggers[0].definitionId).toBe('peace-vassals-included');
      expect(result.audit[0].participants).toContain(3);
      const partial = detect(evidence(calls.slice(0, 1), observations));
      expect(partial.triggers[0].definitionId).toBe('peace-partial');
      const capitulation = detect(evidence(calls.slice(0, 1), [...observations, snapshot(1, 10, [relationship(0, 'peace', { master: 'capitulated' })])]));
      expect(capitulation.triggers[0].definitionId).toBe('peace-capitulation');
    });

    it('should reset pair continuity on peace followed by renewed war and never update a self pair', () => {
      const first = detect(scores([[5, 0], [7, 30], [9, 35]], 4));
      const calls = [event('MakePeace', 1, 10, 0, 1), event('DeclareWar', 2, 10, 0, 1, { IsAggressor: true }), event('DeclareWar', 3, 10, 0, 0)];
      const result = detect(evidence(calls, [snapshot(0, 10, [relationship(1, 'war', { warScore: 1 })])], 10, 9), first.memory);
      expect(result.memory.pairs['0/1']).toMatchObject({ state: 'war', since: 10 });
      expect(result.memory.pairs['0/1'].samples).toHaveLength(1);
      expect(result.memory.pairs['0/0']).toBeUndefined();
      expect(result.triggers.some(trigger => trigger.definitionId === 'war-resumed')).toBe(true);
    });

    it('should report the newest observed opening when a snapshot-only interval contains peace and renewed war', () => {
      const result = detect(evidence([], [snapshot(0, 0, [relationship(1)]), snapshot(0, 1, [relationship(1, 'war')]),
        snapshot(0, 2, [relationship(1)]), snapshot(0, 3, [relationship(1, 'war')])], 3, 0));
      expect(result.triggers).toHaveLength(1);
      expect(result.triggers[0]).toMatchObject({ definitionId: 'war-resumed', values: { eventTurn: 3 } });
      expect(result.memory.pairs['0/1'].since).toBe(3);
    });

    it('should publish enduring peace once after observed continuity and disable foreign enduring accounts by default', () => {
      const rows = [snapshot(0, 0, [relationship(1, 'war')]), ...[1, 5, 10, 15, 20, 26].map(turn => snapshot(0, turn, [relationship(1)]))];
      const input = evidence([], rows, 26, 20);
      const result = detect(input);
      const story = result.triggers.find(trigger => trigger.definitionId === 'peace-enduring')!;
      expect(story).toBeDefined();
      recordDiplomacyPublications(result.memory, [story.id], result.triggers, 26);
      expect(detect(evidence([], [...rows, snapshot(0, 30, [relationship(1)])], 30, 26), result.memory).triggers).toEqual([]);
      expect(detect(evidence([], rows, 26, 20, 5)).triggers.some(trigger => trigger.definitionId === 'peace-enduring')).toBe(false);
      expect(detect(evidence([], [rows[0], rows.at(-1)!], 26, 20)).triggers.some(trigger => trigger.definitionId === 'peace-enduring')).toBe(false);
      expect(detect(evidence([], rows.slice(1), 26, 20)).triggers.some(trigger => trigger.definitionId === 'peace-enduring')).toBe(false);
    });

    it('should retain the enduring publication marker across missing observations and honor a configured peace gap', () => {
      const rows = [snapshot(10, 0, [relationship(0, 'war')]), ...[1, 5, 10, 15, 20, 26].map(turn => snapshot(10, turn, [relationship(0)]))];
      const first = detect(evidence([], rows, 26, 20));
      const story = first.triggers.find(trigger => trigger.definitionId === 'peace-enduring')!;
      expect(story).toBeDefined();
      recordDiplomacyPublications(first.memory, [story.id], first.triggers, 26);
      const afterGap = detect(evidence([], [41, 46, 51, 56, 61, 66].map(turn => snapshot(10, turn, [relationship(0)])), 66, 26), first.memory);
      expect(afterGap.memory.pairs['0/10']).toMatchObject({ since: 41, enduringPublished: true });
      expect(afterGap.triggers.some(trigger => trigger.definitionId === 'peace-enduring')).toBe(false);
      const widerGap = { ...config, triggers: config.triggers.map(entry => entry.detector === 'enduringPeace' ? { ...entry, tuning: { ...entry.tuning, maxGap: 20 } } : entry) };
      const sparse = detect(evidence([], [snapshot(0, 0, [relationship(1, 'war')]), ...[5, 20, 35].map(turn => snapshot(0, turn, [relationship(1)]))], 35, 20), undefined, widerGap);
      expect(sparse.triggers.some(trigger => trigger.definitionId === 'peace-enduring')).toBe(true);
    });
  });

  describe('directional score developments', () => {
    it('should treat a first in-band score as a baseline and confirm a later crossing across two standard turns', () => {
      expect(progress(detect(scores([[5, 30], [7, 35]])))).toBeUndefined();
      expect(progress(detect(scores([[5, 0], [6, 26], [7, 29]])))).toBe('swing');
      expect(progress(detect(scores([[5, 0], [6, 26], [8, 29]])))).toBe('advantage');
      expect(progress(detect(scores([[5, 0], [6, 26], [7, 29]]), undefined, { ...config, triggers: config.triggers.map(entry => entry.stage === 'swing' ? { ...entry, enabled: false } : entry) }))).toBeUndefined();
    });

    it('should prioritize a reversal over commanding advantage, and let disabled stages fall through', () => {
      const input = scores([[1, -30], [3, 65], [5, 70]]);
      expect(progress(detect(input))).toBe('reversal');
      const disabled = { ...config, triggers: config.triggers.map(entry => entry.stage === 'reversal' ? { ...entry, enabled: false } : entry) };
      expect(progress(detect(input, undefined, disabled))).toBe('commanding');
    });

    it('should let a lower progress stage run when the higher stage is excluded by foreign scope or conditions', () => {
      const input = scores([[1, 0], [3, 30], [5, 35]]);
      input.request.receiverPlayerID = 5;
      const foreignDisabled = { ...config, triggers: config.triggers.map(entry => entry.stage === 'advantage' ? { ...entry, tuning: { ...entry.tuning, foreign: false } } : entry) };
      expect(progress(detect(input, undefined, foreignDisabled))).toBe('swing');
      const conditioned = { ...config, triggers: config.triggers.map(entry => entry.stage === 'advantage' ?
        { ...entry, condition: { op: 'gte' as const, field: 'score', value: 50 } } : entry) };
      expect(progress(detect(input, undefined, conditioned))).toBe('swing');
    });

    it('should preserve common history settings when the advantage article is disabled', () => {
      const tuned = { ...config, triggers: config.triggers.map(entry => entry.stage === 'advantage' ?
        { ...entry, enabled: false, tuning: { ...entry.tuning, window: 50, maxGap: 12, freshness: 8 } } :
        entry.stage === 'stagnation' ? { ...entry, tuning: { ...entry.tuning, persistence: 35 } } : entry) };
      const input = scores([[0, 4], [12, 5], [24, 3], [35, 6]]); input.request.cutoffTurn = 42;
      const result = detect(input, undefined, tuned);
      expect(progress(result)).toBe('stagnation');
      expect(result.memory.pairs['0/1'].samples).toHaveLength(4);
    });

    it('should retain the configured advantage band for balance even when advantage articles are disabled', () => {
      const input = scores([[1, 30], [3, 5], [5, 4], [8, 3]]);
      for (const enabled of [true, false]) {
        const tuned = { ...config, triggers: config.triggers.map(entry => entry.stage === 'advantage' ?
          { ...entry, enabled, tuning: { ...entry.tuning, absolute: 40 } } : entry.stage === 'swing' ? { ...entry, enabled: false } : entry) };
        expect(detect(input, undefined, tuned).triggers.some(trigger => trigger.values.stage === 'balance')).toBe(false);
      }
    });

    it('should cite the score before an advantage or commanding band crossing', () => {
      const advantage = detect(scores([[1, 0], [3, 30], [5, 35]])).triggers.find(trigger => trigger.values.stage === 'advantage')!;
      expect(advantage.values.previousScore).toBe(0);
      expect(advantage.sources.map(source => source.turn)).toEqual([1, 3, 5]);
      const commanding = detect(scores([[1, 30], [3, 65], [5, 70]])).triggers.find(trigger => trigger.values.stage === 'commanding')!;
      expect(commanding.values.previousScore).toBe(30);
      expect(commanding.sources.map(source => source.turn)).toEqual([1, 3, 5]);
    });

    it('should persist samples through skips and resume, deduplicate repeated source rows, and honor normal cooldown', () => {
      const input = scores([[1, 0], [3, 30], [5, 35]]);
      input.diplomacy!.history.push(structuredClone(input.diplomacy!.history[1]));
      const first = detect(input);
      expect(first.memory.pairs['0/1'].samples).toHaveLength(3);
      const story = first.triggers.find(trigger => trigger.subject.startsWith('progress/'))!;
      recordDiplomacyPublications(first.memory, [story.id], first.triggers, 5);
      const restored = publicationStateSchema.parse({ ...createInitialPublicationState(), diplomacy: first.memory }).diplomacy;
      const next = detect(scores([[7, 5], [9, 32], [11, 35]], 5), restored);
      expect(progress(next)).toBeUndefined();
      const later = detect(scores([[13, 5], [15, 30], [17, 35]], 11), next.memory);
      expect(progress(later)).toBe('advantage');
    });

    it('should bypass the normal cooldown for a newly confirmed commanding advantage and reversal', () => {
      const first = detect(scores([[1, 0], [3, 30], [5, 35]]));
      const story = first.triggers.find(trigger => trigger.subject.startsWith('progress/'))!;
      recordDiplomacyPublications(first.memory, [story.id], first.triggers, 5);
      expect(progress(detect(scores([[7, 65], [9, 70]], 5), first.memory))).toBe('commanding');
      expect(progress(detect(scores([[7, -30], [9, -35]], 5), first.memory))).toBe('reversal');
    });

    it('should consider a new commanding advantage after the same reversal has already been published', () => {
      const first = detect(scores([[1, -30], [3, 30], [5, 35]]));
      const reversal = first.triggers.find(trigger => trigger.values.stage === 'reversal')!;
      expect(reversal).toBeDefined();
      recordDiplomacyPublications(first.memory, [reversal.id], first.triggers, 5);
      expect(progress(detect(scores([[7, 65], [9, 70]], 5), first.memory))).toBe('commanding');
    });

    it('should ignore an expired low-score baseline instead of rearming a published advantage', () => {
      const first = detect(scores([[0, 0], [2, 30], [4, 35]]));
      const advantage = first.triggers.find(trigger => trigger.values.stage === 'advantage')!;
      recordDiplomacyPublications(first.memory, [advantage.id], first.triggers, 4);
      const advanced = detect(scores([[10, 35], [20, 35], [30, 35], [35, 35]], 4), first.memory);
      expect(advanced.memory.pairs['0/1'].samples.every(sample => sample.turn > 4)).toBe(true);
      expect(advanced.memory.pairs['0/1'].samples).toHaveLength(4);
      const movingWindow = scores([[36, 35]], 35);
      movingWindow.diplomacy!.baseline.push(snapshot(0, 0, [relationship(1, 'war', { warScore: 0 })]));
      const repeated = detect(movingWindow, advanced.memory);
      expect(repeated.memory.pairs['0/1'].advantageArmed).toBe(false);
      const later = detect(scores([[37, 20], [38, 30], [40, 35]], 36), repeated.memory);
      expect(later.triggers.some(trigger => trigger.values.stage === 'advantage')).toBe(false);
    });

    it('should retain a published balance marker when an expired high-score baseline reappears', () => {
      const noSwing = { ...config, triggers: config.triggers.map(entry => entry.stage === 'swing' ? { ...entry, enabled: false } : entry) };
      const first = detect(scores([[0, 30], [2, 5], [4, 4], [7, 3]]), undefined, noSwing);
      const balance = first.triggers.find(trigger => trigger.values.stage === 'balance')!;
      recordDiplomacyPublications(first.memory, [balance.id], first.triggers, 7);
      const marker = first.memory.pairs['0/1'].lastKinds.balance;
      const advanced = detect(scores([[12, 4], [20, 4], [28, 4], [35, 4]], 7), first.memory, noSwing);
      const movingWindow = scores([[36, 4]], 35);
      movingWindow.diplomacy!.baseline.push(snapshot(0, 0, [relationship(1, 'war', { warScore: 30 })]));
      const repeated = detect(movingWindow, advanced.memory, noSwing);
      expect(repeated.memory.pairs['0/1'].lastKinds.balance).toBe(marker);
      expect(repeated.triggers.some(trigger => trigger.values.stage === 'balance')).toBe(false);
    });

    it('should reject stale and widely spaced confirmations and use the fixed player perspective', () => {
      expect(progress(detect(scores([[1, 0], [3, 30], [15, 35]])))).toBeUndefined();
      const stale = scores([[1, 0], [3, 30], [5, 35]]); stale.request.cutoffTurn = 11;
      expect(progress(detect(stale))).toBeUndefined();
      const reverse = scores([[1, 0], [3, 30], [5, 35]]);
      reverse.diplomacy!.history.push(snapshot(1, 5, [relationship(0, 'war', { warScore: -99 })]));
      expect(detect(reverse).memory.pairs['0/1'].samples.at(-1)!.score).toBe(35);
    });

    it('should detect balance and prolonged stagnation from enough continuous observations', () => {
      const noSwing = { ...config, triggers: config.triggers.map(entry => entry.stage === 'swing' ? { ...entry, enabled: false } : entry) };
      expect(progress(detect(scores([[1, 30], [3, 5], [5, 4], [8, 3]]), undefined, noSwing))).toBe('balance');
      expect(progress(detect(scores([[1, 4], [8, 5], [15, 3], [21, 6]])))).toBe('stagnation');
      expect(progress(detect(scores([[1, 4], [11, 5], [21, 6]])))).toBeUndefined();
    });

    it('should apply configurable score thresholds and game pace', () => {
      const tuned = { ...config, triggers: config.triggers.map(entry => entry.stage === 'advantage' ? { ...entry, tuning: { ...entry.tuning, absolute: 40 } } : entry) };
      expect(progress(detect(scores([[1, 0], [3, 30], [5, 35]]), undefined, tuned))).toBe('swing');
      const input = scores([[1, 0], [2, 30], [3, 35]]);
      expect(progress(detectWarAndPeace(input, config, { ...context, standardTurnsPerGameTurn: 2 }))).toBe('advantage');
    });
  });

  describe('editorial integration', () => {
    it('should publish a new stagnation episode only after meaningful score movement and renewed stability', () => {
      const onlyStagnation = { ...config, triggers: config.triggers.map(entry => ({ ...entry, enabled: entry.detector === 'warProgress' && entry.stage === 'stagnation' })) };
      /** Preserve the real selection and publication memory between quiet periods. */
      function check(input: NewspaperEvidence, state = createInitialPublicationState()) {
        return runEditorialCheck({ campaignId: 'stagnation', timelineId: 'test', receiver: { playerId: 0, label: 'France' }, evidence: input, state,
          config: onlyStagnation, context });
      }
      const first = check(scores([[0, 4], [7, 4], [14, 4], [20, 4]]));
      expect(first.status).toBe('published');
      const drift = check(scores([[25, 6], [30, 4], [35, 6]], 20), first.state);
      expect(drift.status).toBe('skipped');
      const movement = check(scores([[40, 20]], 35), drift.state);
      expect(movement.status).toBe('skipped');
      const renewed = check(scores([[45, 20], [50, 21], [55, 20], [60, 20]], 40), movement.state);
      expect(renewed.status).toBe('published');
      expect(renewed.state.issues.at(-1)!.items[0].fingerprint).not.toBe(first.state.issues[0].items[0].fingerprint);
    });

    it('should require a fresh stable period when gradual drift finally rearms stagnation', () => {
      const onlyStagnation = { ...config, triggers: config.triggers.map(entry => ({ ...entry, enabled: entry.detector === 'warProgress' && entry.stage === 'stagnation' })) };
      /** Keep actual publication memory while the front slowly drifts away from its earlier quiet score. */
      function check(input: NewspaperEvidence, state = createInitialPublicationState()) {
        return runEditorialCheck({ campaignId: 'drift', timelineId: 'test', receiver: { playerId: 0, label: 'France' }, evidence: input, state,
          config: onlyStagnation, context });
      }
      const first = check(scores([[0, 2], [7, 2], [14, 2], [20, 2]]));
      expect(first.status).toBe('published');
      const drift = check(scores([[25, 4], [30, 6], [35, 8], [40, 10], [45, 11], [50, 12], [55, 13]], 20), first.state);
      expect(drift.status).toBe('skipped');
      expect(drift.state.diplomacy.pairs['0/1'].stagnationEpisodeTurn).toBe(55);
      const renewed = check(scores([[60, 13], [65, 13], [70, 13], [75, 13]], 55), drift.state);
      expect(renewed.status).toBe('published');
    });
    it('should retain pair memory and inference audit on a skipped check and keep audit out of authored prose', () => {
      const input = scores([[1, 0], [3, 30], [5, 35]]);
      const disabledTemplates = { ...config, templates: config.templates.map(template => ({ ...template, weight: { base: 0, adjustments: [] } })) };
      const result = runEditorialCheck({ campaignId: 'war', timelineId: 'test', receiver: { playerId: 0, label: 'France' },
        evidence: input, state: createInitialPublicationState(), config: disabledTemplates, context });
      expect(result.status).toBe('skipped');
      expect(result.state.diplomacy.pairs['0/1'].samples).toHaveLength(3);
      expect(result.decision.diplomacyInference.length).toBeGreaterThan(0);
      expect(result.state.diplomacy.pairs['0/1'].lastPublication).toBeNull();
      const candidates = matchTemplates(detect(input).triggers, config, { values: {} });
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.every(candidate => candidate.variants.every(variant => !JSON.stringify(variant).includes('confidence')))).toBe(true);
    });

    it('should reject future diplomacy sources and obsolete checkpoint versions', () => {
      const input = scores([[1, 0], [3, 30], [5, 35]]);
      input.diplomacy!.history[0].source.turn = 6;
      expect(() => runEditorialCheck({ campaignId: 'war', timelineId: 'test', receiver: { playerId: 0, label: 'France' },
        evidence: input, state: createInitialPublicationState(), config, context })).toThrow();
      expect(publicationStateSchema.safeParse({ ...createInitialPublicationState(), schemaVersion: 2 }).success).toBe(false);
    });
  });
});
