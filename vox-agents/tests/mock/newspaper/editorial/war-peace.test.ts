/** Exercise permitted diplomacy incidents, pair continuity, and directional score history. */
import { describe, expect, it } from 'vitest';
import type { NewspaperDiplomacySnapshot, NewspaperEvent, NewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { DiplomacyMemory } from '../../../../src/newspaper/contracts/diplomacy.js';
import { inferWarAndPeace } from '../../../../src/newspaper/editorial/diplomacy/war-peace.js';
import type { EditorialContext } from '../../../../src/newspaper/editorial/shared/context.js';

type Relationship = NewspaperDiplomacySnapshot['relationships'][number];
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
/** Run the standalone inference with receiver-aware metadata and optional prior pair memory. */
function detect(input: NewspaperEvidence, memory?: DiplomacyMemory) {
  return inferWarAndPeace(input, { ...context, receiverTeamId: input.request.receiverPlayerID + 100 }, memory);
}
/** Provide a continuous fixed-perspective major-war score history. */
function scores(values: [number, number][], previous = 0): NewspaperEvidence {
  return evidence([], values.map(([turn, warScore]) => snapshot(0, turn, [relationship(1, 'war', { warScore })])), values.at(-1)![0], previous);
}
describe('war and peace editorial inference', () => {

  describe('local incident reconstruction', () => {
    it('should distinguish our declarations, imposed declarations and foreign openings without treating false as intent', () => {
      const observations = [snapshot(0, 9, [relationship(1)]), snapshot(1, 9, [relationship(2)])];
      for (const [origin, target, receiver] of [[0, 1, 0], [1, 0, 0], [1, 2, 0]] as const) {
        const result = detect(evidence([event('DeclareWar', 1, 10, origin, target, { IsAggressor: true })], observations, 10, 5, receiver));
        expect(result.audit).toHaveLength(1);
        expect(result.audit[0]).toMatchObject({ kind: 'war', stage: 'declaration' });
        expect(result.audit[0].rootInitiator).toBe(origin);
      }
      const ambiguous = detect(evidence([event('DeclareWar', 1, 10, 1, 0, { IsAggressor: false })], observations));
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
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0].participants.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
      expect(result.memory.pairs['0/0']).toBeUndefined();
      expect(result.audit[0].sources.filter(source => source.table === 'GameEvents')).toHaveLength(4);
      const vassalReader = detect(evidence(calls, observations, 10, 5, 3));
      expect(vassalReader.audit[0].stage).toBe('followingMaster');
      const pactReader = detect(evidence(calls, observations, 10, 5, 2));
      expect(pactReader.audit[0].stage).toBe('defensivePact');
      const foreign = detect(evidence(calls, observations, 10, 5, 5));
      expect(foreign.audit[0].stage).toBe('vassalsJoining');
    });

    it('should keep independent wars on the same turn separate and ignore dynamic event ordering', () => {
      const observations = [snapshot(0, 9, [relationship(1), relationship(2)]), snapshot(3, 9, [relationship(4)])];
      const calls = [event('DeclareWar', 3, 10, 3, 4, { IsAggressor: true }), event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }),
        event('DeclareWar', 2, 10, 0, 2, { IsAggressor: true }), event('DeclareWar', 10_900_001, 10, 1, 0)];
      const result = detect(evidence(calls, observations));
      expect(result.audit).toHaveLength(3);
      expect(new Set(result.audit.map(incident => incident.incidentId)).size).toBe(3);
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
      expect(result.audit).toHaveLength(1);
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
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0].participants).toContain(10);
      expect(result.audit[0].sources.some(source => source.table === 'GameEvents' && source.id === 4)).toBe(true);
      const later = detect(evidence([{ ...changed, source: { ...changed.source, id: 20 } }, ...calls.slice(1)], observations));
      expect(later.audit.filter(entry => entry.kind === 'war')).toHaveLength(2);
      const dynamic = detect(evidence([{ ...changed, source: { ...changed.source, id: 10_900_001 } }, ...calls.slice(1)], observations));
      expect(dynamic.audit.filter(entry => entry.kind === 'war')).toHaveLength(2);
      const visibleAfter = observations.map(row => row.subjectID === 10 && row.source.turn === 10 ?
        { ...row, relationships: [relationship(1, 'war'), relationship(2, 'war')] } : row);
      const hiddenChange = detect(evidence(calls.slice(1), visibleAfter));
      expect(hiddenChange.audit).toHaveLength(1);
      expect(hiddenChange.audit[0].alternatives.length).toBeGreaterThan(0);
      const knownLater = detect(evidence([{ ...changed, source: { ...changed.source, id: 20 } }, ...calls.slice(1)], visibleAfter));
      expect(knownLater.audit.filter(entry => entry.kind === 'war')).toHaveLength(2);
    });

    it('should retain a broad missing-root incident and avoid naming hidden identities from global context', () => {
      const input = evidence([event('DeclareWar', 1, 10, 0, 14, { IsAggressor: true })]);
      const result = detect(input);
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0].participants).not.toContain(14);
      expect(result.audit[0].confidence).toBe('ambiguous');
      expect(result.memory.pairs).toEqual({});
    });

    it('should distinguish a direct city-state attack from allied participation', () => {
      const observations = [snapshot(0, 9, [relationship(1), relationship(10)]), snapshot(1, 9, [relationship(0, 'war')]),
        ...[10, 11, 12, 13].map(minor => snapshot(minor, 9, [relationship(0)], { majorAllyPlayerID: 1 }))];
      const direct = detect(evidence([event('DeclareWar', 1, 10, 0, 10, { IsAggressor: true })], observations));
      expect(direct.audit[0].stage).toBe('cityStateAttack');
      const joining = detect(evidence([event('DeclareWar', 1, 10, 10, 0, { IsAggressor: false })], observations));
      expect(joining.audit[0].stage).toBe('cityStateJoining');
      const cascade = detect(evidence([event('DeclareWar', 1, 10, 0, 1, { IsAggressor: true }),
        ...[10, 11, 12, 13].map((minor, index) => event('DeclareWar', index + 2, 10, minor, 0, { IsAggressor: false }))], observations));
      expect(cascade.audit).toHaveLength(1);
      expect(cascade.audit[0].participants).toHaveLength(6);
      expect(cascade.audit[0].participants).toContain(13);
      expect(detect(evidence([event('DeclareWar', 1, 10, 10, 11)], observations)).audit[0].stage).toBeUndefined();
    });

    it('should report later alliance-driven war participation and avoid a duplicate new opening', () => {
      const input = evidence([{ type: 'MinorAlliesChanged', values: { MinorPlayerID: 10, MajorPlayerID: 0, IsNowAlly: true },
        source: { table: 'GameEvents', id: 1, turn: 10, createdAt: 10000 } }],
      [snapshot(0, 9, [relationship(1, 'war')]), snapshot(10, 9, [relationship(1)], { majorAllyPlayerID: null }),
        snapshot(10, 10, [relationship(1, 'war')], { majorAllyPlayerID: 0 })]);
      const result = detect(input);
      expect(result.audit.some(trigger => trigger.stage === 'allianceChange')).toBe(true);
      expect(result.audit.filter(trigger => trigger.sources.some(source => source.id === 1010))).toHaveLength(1);
      const repeated = structuredClone(input);
      repeated.diplomacy!.history.push(snapshot(10, 10, [relationship(1, 'war')], {
        majorAllyPlayerID: 0, source: { table: 'PlayerSummaries', id: 1011, turn: 10, createdAt: 10001 },
      }));
      expect(detect(repeated).audit.filter(entry => entry.stage === 'allianceChange')).toHaveLength(1);
      const longstanding = structuredClone(input);
      longstanding.diplomacy!.history[1].relationships[0].state = 'war';
      expect(detect(longstanding).audit.some(trigger => trigger.stage === 'allianceChange')).toBe(false);
      const unknown = structuredClone(input);
      unknown.diplomacy!.history[1].relationships = [];
      expect(detect(unknown).audit.some(trigger => trigger.stage === 'allianceChange')).toBe(false);

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
      expect(detect(input).audit[0].stage).toBe('inheritedWars');
    });
  });

  describe('settlements and continuity', () => {
    it('should retain a city-state war observed from the minor side when another front makes peace', () => {
      const result = detect(evidence([event('MakePeace', 1, 10, 0, 1)], [snapshot(0, 9, [relationship(1, 'war')]),
        snapshot(10, 9, [relationship(0, 'war')]), snapshot(10, 10, [relationship(0, 'war')])]));
      expect(result.memory.pairs['0/10']).toMatchObject({ state: 'war', perspective: 0, lastObserved: 10 });
      expect(result.audit.some(trigger => trigger.stage === 'partial')).toBe(true);
      expect(result.audit.some(trigger => trigger.stage === 'quietFronts')).toBe(false);
      const resumed = detect(evidence([], [snapshot(10, 11, [relationship(0)]), snapshot(10, 12, [relationship(0, 'war')])], 12, 10), result.memory);
      expect(resumed.audit.find(entry => entry.stage === 'resumed')?.sources[0].turn).toBe(12);
    });
    it('should match visible concessions only to the following deal between the settling parties', () => {
      const calls = [event('MakePeace', 2, 10, 0, 1),
        { type: 'DealMade', values: { FromPlayerID: 0, ToPlayerID: 1, TradedItems: [{ ItemType: 'PeaceTreaty' }, { ItemType: 'Gold', Data1: 100 }] }, source: { table: 'GameEvents' as const, id: 3, turn: 10, createdAt: 10000 } }];
      const observations = [snapshot(0, 9, [relationship(1, 'war')])];
      expect(detect(evidence(calls, observations)).audit[0].stage).toBe('concessions');
      expect(detect(evidence(calls, observations)).audit[0].concessionTypes).toBe('gold');
      calls[1].source.id = 1;
      expect(detect(evidence(calls, observations)).audit[0].stage).toBe('quietFronts');
      delete calls[1].values.TradedItems;
      const hidden = detect(evidence(calls, observations));
      expect(hidden.audit[0].concessionTypes).toBeUndefined();
    });

    it('should include peace cascades, distinguish capitulation, and keep a remaining known front active', () => {
      const observations = [snapshot(0, 9, [relationship(1, 'war'), relationship(2, 'war'), relationship(3, 'peace', { vassal: 'voluntary' })]),
        snapshot(3, 9, [relationship(0, 'peace', { master: 'voluntary' })]), snapshot(3, 10, [relationship(1)]),
        snapshot(0, 10, [relationship(1), relationship(2, 'war'), relationship(3, 'peace', { vassal: 'voluntary' })])];
      const calls = [event('MakePeace', 1, 10, 0, 1), event('MakePeace', 2, 10, 0, 1)];
      const result = detect(evidence(calls, observations));
      expect(result.audit.filter(entry => entry.kind === 'peace')).toHaveLength(1);
      expect(result.audit[0].stage).toBe('vassalsIncluded');
      expect(result.audit[0].participants).toContain(3);
      const partial = detect(evidence(calls.slice(0, 1), observations));
      expect(partial.audit[0].stage).toBe('partial');
      const capitulation = detect(evidence(calls.slice(0, 1), [...observations, snapshot(1, 10, [relationship(0, 'peace', { master: 'capitulated' })])]));
      expect(capitulation.audit[0].stage).toBe('capitulation');
    });

    it('should reset pair continuity on peace followed by renewed war and never update a self pair', () => {
      const first = detect(scores([[5, 0], [7, 30], [9, 35]], 4));
      const calls = [event('MakePeace', 1, 10, 0, 1), event('DeclareWar', 2, 10, 0, 1, { IsAggressor: true }), event('DeclareWar', 3, 10, 0, 0)];
      const result = detect(evidence(calls, [snapshot(0, 10, [relationship(1, 'war', { warScore: 1 })])], 10, 9), first.memory);
      expect(result.memory.pairs['0/1']).toMatchObject({ state: 'war', since: 10 });
      expect(result.memory.pairs['0/1'].samples).toHaveLength(1);
      expect(result.memory.pairs['0/0']).toBeUndefined();
      expect(result.audit.some(trigger => trigger.stage === 'resumed')).toBe(true);
    });

    it('should report the newest observed opening when a snapshot-only interval contains peace and renewed war', () => {
      const result = detect(evidence([], [snapshot(0, 0, [relationship(1)]), snapshot(0, 1, [relationship(1, 'war')]),
        snapshot(0, 2, [relationship(1)]), snapshot(0, 3, [relationship(1, 'war')])], 3, 0));
      expect(result.audit).toHaveLength(1);
      expect(result.audit[0]).toMatchObject({ stage: 'resumed', sources: [{ turn: 3 }] });
      expect(result.memory.pairs['0/1'].since).toBe(3);
    });

    it('should keep observed peace anchored but restart continuity after a gap', () => {
      const result = detect(evidence([], [
        snapshot(0, 0, [relationship(1, 'war')]), snapshot(0, 1, [relationship(1)]),
        snapshot(0, 10, [relationship(1)]),
      ], 10, 0));
      expect(result.memory.pairs['0/1']).toMatchObject({ state: 'peace', since: 1, peaceAnchored: true });
      const afterGap = detect(evidence([], [snapshot(0, 21, [relationship(1)])], 21, 10), result.memory);
      expect(afterGap.memory.pairs['0/1']).toMatchObject({
        state: 'peace', since: 21, lastObserved: 21, peaceAnchored: true,
      });
      expect(result.memory.pairs['0/1'].since).toBe(1);
    });
  });

  describe('directional score history', () => {
    it('should keep permitted samples across checks, expire old samples, and skip duplicate sources', () => {
      const first = detect(scores([[1, 0], [5, 25], [8, 30]]));
      const next = detect(scores([[5, 25], [8, 30], [33, 35]], 8), first.memory);
      expect(next.memory.pairs['0/1'].samples.map(({ turn, score }) => [turn, score]))
        .toEqual([[5, 25], [8, 30], [33, 35]]);
      expect(first.memory.pairs['0/1'].samples.map(({ turn }) => turn)).toEqual([1, 5, 8]);
    });

    it('should use the fixed receiver perspective and ignore scores past the cutoff', () => {
      const result = detect(evidence([], [
        snapshot(1, 2, [relationship(0, 'war', { warScore: -12 })]),
        snapshot(0, 2, [relationship(1, 'war', { warScore: 15 })]),
        snapshot(0, 4, [relationship(1, 'war', { warScore: 19 })]),
      ], 3, 1));
      expect(result.memory.pairs['0/1'].samples.map(({ score }) => score)).toEqual([15]);
    });
  });
});
