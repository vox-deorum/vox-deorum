/** Exercise permitted diplomacy incidents, pair continuity, and directional score history. */
import { describe, expect, it } from 'vitest';
import type { NewspaperEvent, NewspaperEvidence } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { diplomacyMemorySchema, type DiplomacyMemory } from '../../../../../src/newspaper/contracts/diplomacy.js';
import { inferWarAndPeace } from '../../../../../src/newspaper/editorial/diplomacy/war-peace.js';
import { context, relationship, snapshot, event, evidence, scores } from '../../../../helpers/newspaper-diplomacy.js';

/** Run the standalone inference with receiver-aware metadata and optional prior pair memory. */
function detect(input: NewspaperEvidence, memory?: DiplomacyMemory, historyTurns?: number) {
  return inferWarAndPeace(input, { ...context, receiverTeamId: input.request.receiverPlayerID + 100 }, memory, historyTurns);
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
      expect(result.incidents.find(incident => incident.id.startsWith('alliance/'))?.role).toBeUndefined();
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
      expect(resumed.incidents.find(entry => entry.resumed)).toMatchObject({ turn: 12, observed: true });
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
      expect(result.memory.pairs['0/1'].observations.at(-1)?.warScore).toBe(1);
      expect(result.memory.pairs['0/0']).toBeUndefined();
      expect(result.audit.some(trigger => trigger.stage === 'resumed')).toBe(true);
    });

    it('should distinguish an initial opening from a renewed war in the same reporting period', () => {
      const result = detect(evidence([], [snapshot(0, 0, [relationship(1)]), snapshot(0, 1, [relationship(1, 'war')]),
        snapshot(0, 2, [relationship(1)]), snapshot(0, 3, [relationship(1, 'war')])], 3, 0));
      expect(result.incidents.map(({ turn, resumed, observed }) => ({ turn, resumed, observed }))).toEqual([
        { turn: 1, resumed: false, observed: true }, { turn: 3, resumed: true, observed: true },
      ]);
      expect(result.audit.find(entry => entry.stage === 'resumed')?.sources.map(source => source.turn).sort()).toEqual([1, 2, 3]);
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
    it('should retain long history, one older anchor, and no duplicate observations across checks', () => {
      const first = detect(scores([[0, 0], [1, 0], [5, 25], [8, 30]]));
      const next = detect(scores([[5, 25], [8, 30], [43, 35]], 8), first.memory);
      expect(next.memory.pairs['0/1'].observations.map(({ turn, warScore }) => [turn, warScore]))
        .toEqual([[1, 0], [5, 25], [8, 30], [43, 35]]);
      expect(first.memory.pairs['0/1'].observations.map(({ turn }) => turn)).toEqual([0, 1, 5, 8]);
    });

    it('should use the fixed receiver perspective and ignore scores past the cutoff', () => {
      const result = detect(evidence([], [
        snapshot(1, 2, [relationship(0, 'war', { warScore: -12 })]),
        snapshot(0, 2, [relationship(1, 'war', { warScore: 15 })]),
        snapshot(0, 4, [relationship(1, 'war', { warScore: 19 })]),
      ], 3, 1));
      expect(result.memory.pairs['0/1'].observations.at(-1)).toMatchObject({ warScore: 15, scoreSource: { id: 200 } });
    });

    it('should keep a settled score in its original direction across serialized memory and hide unsigned scores', () => {
      const opening = detect(evidence([], [snapshot(1, 4, [relationship(0, 'war', { warScore: -62 })]),
        snapshot(0, 5, [relationship(1, 'war', { warScore: 25 })])], 5, 0, 1));
      expect(opening.memory.pairs['0/1'].observations.at(-1)?.warScore).toBeUndefined();
      const resume = diplomacyMemorySchema.parse(JSON.parse(JSON.stringify(opening.memory)));
      const settlement = detect(evidence([event('MakePeace', 1, 8, 0, 1)], [snapshot(1, 8, [relationship(0)])], 8, 5, 1), resume);
      expect(settlement.incidents[0].pair).toMatchObject({ state: 'peace', lastWarScore: { score: -62, source: { id: 401 } } });
      expect(settlement.incidents[0].pair?.warScore).toBeUndefined();
    });

    it('should hide conflicting and unobserved pair state without treating it as peace', () => {
      const input = evidence([], [snapshot(0, 4, [relationship(1, 'war', { warScore: 3 })]),
        snapshot(0, 5, [relationship(1, 'war', { warScore: 5 })]), snapshot(1, 5, [relationship(0)]),
        snapshot(0, 6, [relationship(1, 'war')]), snapshot(0, 7, [])], 7, 0);
      const result = detect(input);
      expect(result.memory.pairs['0/1'].observations.map(({ turn, state, warScore }) => [turn, state, warScore])).toEqual([
        [4, 'war', 3], [5, 'unknown', undefined], [6, 'war', undefined], [7, 'unknown', undefined],
      ]);
      expect(result.incidents.map(incident => incident.turn)).toEqual([4]);
    });

    it('should use a same-turn wartime score only when it precedes the settlement', () => {
      const row = snapshot(0, 8, [relationship(1, 'war', { warScore: 17 })]);
      const peace = event('MakePeace', 1, 8, 0, 1);
      const prior = snapshot(0, 7, [relationship(1, 'war', { warScore: 13 })]);
      row.source.createdAt = peace.source.createdAt - 1;
      expect(detect(evidence([peace], [prior, row], 8, 7)).incidents[0].pair?.lastWarScore).toMatchObject({ score: 17, source: row.source });
      row.source.createdAt = peace.source.createdAt;
      expect(detect(evidence([peace], [prior, row], 8, 7)).incidents[0].pair?.lastWarScore?.score).toBe(13);
    });

    it('should keep native declarations and settlements anchored when same-day reports disagree', () => {
      const war = event('DeclareWar', 1, 5, 0, 1);
      const peace = event('MakePeace', 2, 8, 0, 1);
      const warScore = snapshot(0, 5, [relationship(1, 'war', { warScore: 12 })]);
      const wrongPeace = snapshot(1, 5, [relationship(0)]);
      const wrongWar = snapshot(0, 8, [relationship(1, 'war', { warScore: 19 })]);
      const confirmedPeace = snapshot(1, 8, [relationship(0)]);
      const result = detect(evidence([war, peace], [snapshot(0, 4, [relationship(1)]), warScore, wrongPeace, wrongWar, confirmedPeace], 8, 4));
      expect(result.incidents).toMatchObject([
        { turn: 5, kind: 'war', pair: { state: 'war', since: 5, warScore: 12, scoreSource: warScore.source } },
        { turn: 8, kind: 'peace', pair: { state: 'peace', since: 8, peaceAnchored: true,
          lastWarScore: { score: 12, source: warScore.source } } },
      ]);
      expect(result.memory.pairs['0/1'].state).toBe('peace');
      expect(result.incidents[0].pair?.sources).toEqual([war.source, warScore.source]);
      expect(result.incidents[1].pair?.sources).toEqual([peace.source, confirmedPeace.source]);
    });

    it('should recognize renewed war after ambiguous reports and a serialized check', () => {
      const originalWar = snapshot(0, 1, [relationship(1, 'war', { warScore: 22 })]);
      const settlement = snapshot(0, 2, [relationship(1)]);
      const gap = [snapshot(0, 8, [relationship(1)]), snapshot(1, 8, [relationship(0, 'war')])];
      const renewal = snapshot(0, 9, [relationship(1, 'war')]);
      const peace = detect(evidence([], [originalWar, settlement], 2, 1));
      const skipped = detect(evidence([], gap, 8, 7), peace.memory, 0);
      expect(skipped.incidents).toEqual([]);
      expect(skipped.memory.pairs['0/1'].observations.at(-1)).toMatchObject({ state: 'unknown', since: null, peaceAnchored: false });
      const saved = diplomacyMemorySchema.parse(JSON.parse(JSON.stringify(skipped.memory)));
      const afterGap = detect(evidence([], [renewal], 9, 8), saved, 0);
      const uninterrupted = detect(evidence([], [originalWar, settlement, ...gap, renewal], 9, 8));
      expect(afterGap.incidents).toEqual(uninterrupted.incidents);
      expect(afterGap.incidents[0]).toMatchObject({ turn: 9, resumed: true, observed: true });
      expect(afterGap.incidents[0].role).toBeUndefined();
      expect(afterGap.incidents[0].sources).toContainEqual(settlement.source);
      const native = detect(evidence([event('DeclareWar', 1, 9, 0, 1)], [renewal], 9, 8), saved);
      expect(native.incidents[0]).toMatchObject({ resumed: true, observed: false, role: 'initiator' });
    });

    it('should preserve the fact of a settlement score without claiming continuous peace after a gap', () => {
      const result = detect(evidence([], [snapshot(0, 1, [relationship(1, 'war', { warScore: -24 })]),
        snapshot(0, 2, [relationship(1)]), snapshot(0, 3, []), snapshot(0, 4, [relationship(1)])], 4, 1));
      expect(result.memory.pairs['0/1'].observations.at(-1)).toMatchObject({ state: 'peace', peaceAnchored: false,
        lastWarScore: { score: -24, turn: 1 } });
    });
  });

  describe('reporting period and retained evidence', () => {
    it('should retain the scaled long span, a configured wider window, or the full current period', () => {
      const input = scores(Array.from({ length: 101 }, (_, turn) => [turn, turn % 30]), 99);
      const slow = inferWarAndPeace(input, { ...context, standardTurnsPerGameTurn: 0.5 });
      expect(slow.memory.pairs['0/1'].observations[0].turn).toBe(19);
      const explicit = detect(input, undefined, 55);
      expect(explicit.memory.pairs['0/1'].observations[0].turn).toBe(44);
      input.request.previousCheckTurn = 30;
      const period = detect(input);
      expect(period.memory.pairs['0/1'].observations[0].turn).toBe(29);
    });

    it('should reconstruct old transitions without reporting them and agree with an earlier skipped check', () => {
      const rows = [snapshot(0, 1, [relationship(1)]), snapshot(0, 4, [relationship(1, 'war', { warScore: -14 })]),
        snapshot(0, 7, [relationship(1)]), snapshot(0, 9, [relationship(1, 'war', { warScore: 9 })])];
      const earlierCalls = [event('DeclareWar', 1, 3, 0, 1), event('MakePeace', 2, 6, 0, 1)];
      const laterCall = event('DeclareWar', 3, 9, 0, 1);
      const initial = detect(evidence(earlierCalls, rows.slice(0, 3), 7, 0));
      const replay = evidence([laterCall], rows, 9, 7);
      replay.history = { fromTurn: 0, baseline: { players: [], cities: [] }, snapshots: { players: [], cities: [] },
        gaps: [], events: [...earlierCalls, laterCall] };
      const cold = detect(replay);
      const resumed = detect(replay, diplomacyMemorySchema.parse(JSON.parse(JSON.stringify(initial.memory))));
      expect(initial.incidents[0].resumed).toBe(false);
      expect(cold.incidents).toEqual(resumed.incidents);
      expect(cold.memory).toEqual(resumed.memory);
      expect(cold.incidents).toHaveLength(1);
      expect(cold.incidents[0]).toMatchObject({ turn: 9, resumed: true, observed: false });
    });

    it('should keep the fronts and score of each settlement as of its reporting date', () => {
      const calls = [event('MakePeace', 1, 8, 0, 1), event('MakePeace', 3, 11, 0, 2)];
      const deal: NewspaperEvent = { type: 'DealMade', values: { FromPlayerID: 0, ToPlayerID: 1,
        TradedItems: [{ ItemType: 'PeaceTreaty' }, { ItemType: 'Gold' }] }, source: { ...calls[0].source, id: 2 } };
      const input = evidence([...calls, deal], [snapshot(0, 7, [relationship(1, 'war', { warScore: 5 }), relationship(2, 'war')]),
        snapshot(0, 8, [relationship(1), relationship(2, 'war')]), snapshot(0, 11, [relationship(1), relationship(2)])], 11, 7);
      const result = detect(input);
      expect(result.incidents).toMatchObject([
        { turn: 8, partial: true, concessions: ['gold'], pair: { lastWarScore: { score: 5 } } },
        { turn: 11, partial: false, concessions: [] },
      ]);
    });
  });
});
