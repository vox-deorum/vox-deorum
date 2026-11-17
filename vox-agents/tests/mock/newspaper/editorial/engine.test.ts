/** Behavioral checks for measured evidence, canonical history, and current-vote feedback. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, publicationStateSchema, type PublishedItemRecord } from '../../../../src/newspaper/contracts/publication.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema, type EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { detectTriggers } from '../../../../src/newspaper/editorial/triggers.js';
import { evidenceConditionContext } from '../../../../src/newspaper/editorial/shared/context.js';
import { matchTemplates } from '../../../../src/newspaper/editorial/selection/templates.js';
import { computeFeedback, candidateFeedback } from '../../../../src/newspaper/editorial/selection/feedback.js';
import { decaySeries } from '../../../../src/newspaper/editorial/selection/series.js';
import { selectHeuristic } from '../../../../src/newspaper/editorial/selection/heuristic.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { chooseDesign } from '../../../../src/newspaper/editorial/presentation/issue.js';
import { selectionWeight } from '../../../../src/newspaper/editorial/shared/weights.js';

let config: EditorialConfig;
const context = { receiverTeamId: 7, receiverOwnerName: 'France', playerNames: { '0': 'France', '1': 'Morocco', '2': 'Zulu' }, playerTeamIds: { '0': 7, '1': 8, '2': 9 } };

/** Build a permitted snapshot with predictable original row references. */
function snapshot(subjectID: number, turn: number, values: Record<string, unknown>, city = false): NewspaperSnapshot {
  return { subjectID, values, source: { table: city ? 'CityInformations' : 'PlayerSummaries', id: turn * 100 + subjectID, turn, createdAt: turn * 1000 } };
}

/** Provide newly observed city contrasts, route changes, culture growth, and an authored deal combination. */
function fixture(turn = 10, previousCheckTurn = 5): NewspaperEvidence {
  return {
    request: { receiverPlayerID: 0, previousCheckTurn, cutoffTurn: turn, comparisonRange: { fromTurn: 0, toTurn: turn } },
    players: [snapshot(0, turn, { Era: 'Ancient Era', OutgoingTradeRoutes: {
      'Paris => Marrakesh (Morocco)': { FromGold: 40 }, 'Paris => Ulundi (Zulu)': { FromGold: 10 },
      'Paris => Lyon (France)': { FromGold: 900 }, 'Paris => Fes (Morocco)': { FromGold: -1 },
    } }), snapshot(1, turn, { CulturePerTurn: 120 }), snapshot(2, turn, { CulturePerTurn: 20 })],
    cities: [snapshot(3, turn, { Owner: 'France', Name: 'Paris', X: 1, Y: 1, Population: 12 }, true),
      snapshot(4, turn, { Owner: 'France', Name: 'Lyon', X: 2, Y: 2, Population: 8 }, true)],
    comparisons: { players: [snapshot(0, 5, { OutgoingTradeRoutes: {
      'Paris => Marrakesh (Morocco)': { FromGold: 10 }, 'Paris => Ulundi (Zulu)': { FromGold: 40 },
    } }), snapshot(1, 5, { CulturePerTurn: 20 }), snapshot(2, 5, { CulturePerTurn: 20 })],
    cities: [snapshot(3, 5, { Owner: 'France', Name: 'Paris', Population: 10 }, true),
      snapshot(4, 5, { Owner: 'France', Name: 'Lyon', Population: 8 }, true)] },
    events: [{ type: 'DealMade', values: { FromPlayerID: 0, ToPlayerID: 1, StartTurn: turn, TradedItems: [{ ItemType: 'OpenBorders', FromPlayerID: 0 }] },
      source: { table: 'GameEvents', id: turn, turn, createdAt: turn * 1000 } }],
  };
}

/** Run a check with a stable branch and receiver identity. */
function check(evidence: NewspaperEvidence, state = createInitialPublicationState(), catalogue = config) {
  return runEditorialCheck({ campaignId: 'campaign', timelineId: 'branch', receiver: { playerId: 0, label: 'France' },
    evidence, state, config: catalogue, context });
}

/** Build minimal canonical history for feedback calculations. */
function historyItem(id: string, tags: string[], seriesKeys = ['trade/0/1']): PublishedItemRecord {
  return { id, issueId: 'old', turn: 1, tags, seriesKeys, templateIds: ['authored'], triggerIds: ['observed'],
    importance: 100, evidenceSummary: 'Observed', sources: [], fingerprint: id };
}

describe('editorial engine', () => {
  beforeAll(async () => { config = await loadEditorialConfig(); });

  describe('measured developments', () => {
    it('should use positive foreign route gold and explicit observation changes', () => {
      const triggers = detectTriggers(fixture(), config, context);
      const trade = triggers.find(trigger => trigger.definitionId === 'trade-concentration' && trigger.subject === 'civilization/1')!;
      expect(trade.values).toMatchObject({ share: 80, previousShare: 20, gold: 40, tradeFromTurn: 5, tradeToTurn: 10 });
      expect(trade.importance).toBe(config.defaults.importanceMax);
      const cities = triggers.find(trigger => trigger.definitionId === 'city-population-boom')!;
      expect(cities.values).toMatchObject({ growth: 2, population: 12 });
      expect(cities.importance).toBeLessThan(trade.importance);
      expect(trade.sources.map(source => source.turn)).toEqual([5, 10]);
    });

    it('should preserve unknown route histories and suppress ambiguous endpoint names', () => {
      const evidence = fixture();
      evidence.comparisons.players[0].values = {};
      expect(detectTriggers(evidence, config, context).some(trigger => trigger.definitionId === 'trade-concentration')).toBe(false);
      evidence.comparisons.players[0].values = { OutgoingTradeRoutes: {} };
      expect(detectTriggers(evidence, config, context).some(trigger => trigger.definitionId === 'trade-partner')).toBe(true);
      expect(detectTriggers(fixture(), config, { ...context, playerNames: { '0': 'France' } }).some(trigger => trigger.definitionId === 'trade-concentration')).toBe(false);
    });

    it('should skip unchanged snapshots and reject future observations', () => {
      const evidence = fixture(10, 10);
      evidence.events = [];
      expect(detectTriggers(evidence, config, context)).toEqual([]);
      const future = fixture();
      future.players[0].source.turn = 11;
      expect(() => check(future)).toThrow();
    });

    it('should suppress city comparisons across observed captures and ownership changes', () => {
      const evidence = fixture();
      evidence.events.push({ type: 'CityCaptureComplete', values: { CityID: 3, CityX: 1, CityY: 1 },
        source: { table: 'GameEvents', id: 100, turn: 7, createdAt: 7000 } });
      expect(detectTriggers(evidence, config, context).some(trigger => trigger.definitionId === 'city-population-boom')).toBe(false);
      evidence.events = [];
      evidence.comparisons.cities[0].values.Owner = 'Morocco';
      expect(detectTriggers(evidence, config, context).some(trigger => trigger.definitionId === 'city-population-boom')).toBe(false);
    });

    it('should resolve an incoming war through the recorded player team mapping', () => {
      const evidence = fixture();
      evidence.events = [{ type: 'DeclareWar', values: { OriginatingPlayerID: 2, TargetTeamID: 7, IsAggressor: false },
        source: { table: 'GameEvents', id: 88, turn: 9, createdAt: 9000 } }];
      const triggers = detectTriggers(evidence, config, context);
      expect(triggers.find(trigger => trigger.definitionId === 'war-declaration')).toMatchObject({ urgent: true, values: { partner: 'Zulu', rootIntent: 'unknown' } });
      expect(detectTriggers(evidence, config, { ...context, receiverTeamId: undefined, playerTeamIds: { '1': 8, '2': 9 } }).some(trigger => trigger.urgent)).toBe(false);
    });

    it('should require known involvement before reporting a peace event', () => {
      const evidence = fixture();
      evidence.events = [{ type: 'MakePeace', values: { OriginatingPlayerID: 1 },
        source: { table: 'GameEvents', id: 88, turn: 9, createdAt: 9000 } }];
      const unknownReceiver = { ...context, receiverTeamId: undefined, playerTeamIds: { '1': 8, '2': 9 } };
      expect(detectTriggers(evidence, config, unknownReceiver).some(trigger => trigger.definitionId.startsWith('peace-'))).toBe(false);
      evidence.events[0].values.TargetTeamID = 8;
      expect(detectTriggers(evidence, config, unknownReceiver).some(trigger => trigger.definitionId.startsWith('peace-'))).toBe(false);
      evidence.events[0].values.TargetTeamID = 7;
      expect(detectTriggers(evidence, config, context).find(trigger => trigger.definitionId === 'peace-quiet-fronts'))
        .toMatchObject({ values: { partner: 'Morocco', eventTurn: 9 } });
    });

    it('should recognize a population rebound only with an observed earlier decline', () => {
      const evidence = fixture();
      evidence.comparisons.cities.push(snapshot(3, 2, { Owner: 'France', Population: 13 }, true));
      expect(detectTriggers(evidence, config, context).find(trigger => trigger.definitionId === 'city-recovery')).toMatchObject({ values: { cityId: 3, growth: 2 } });
      evidence.comparisons.cities.pop();
      expect(detectTriggers(evidence, config, context).some(trigger => trigger.definitionId === 'city-recovery')).toBe(false);
    });

    it('should bound city growth comparisons to the configured history window', () => {
      const evidence = fixture();
      evidence.comparisons.cities[0].source.turn = -100;
      expect(detectTriggers(evidence, config, context).some(trigger => trigger.definitionId === 'city-population-boom')).toBe(false);
    });
  });

  describe('authored selection and history', () => {
    it('should reject a masthead font that is absent from the renderer asset registry', () => {
      const invalid = structuredClone(config);
      invalid.designs[0].presentation.tokens!.mastheadFontAssetId = 'missing-masthead-font';
      expect(editorialConfigSchema.safeParse(invalid).success).toBe(false);
      invalid.designs[0].presentation.tokens!.mastheadFontAssetId = 'font-unifrakturmaguntia-400';
      expect(editorialConfigSchema.safeParse(invalid).success).toBe(true);
    });

    it('should merge only authored compatible angles with maximum importance and unique tags', () => {
      const evidence = fixture();
      const candidates = matchTemplates(detectTriggers(evidence, config, context), config, evidenceConditionContext(evidence, context));
      const composite = candidates.find(candidate => candidate.templateIds.includes('trade-and-exchange'))!;
      const parts = candidates.filter(candidate => composite.contributingIds.includes(candidate.id));
      expect(parts).toHaveLength(2);
      expect(composite.importance).toBe(Math.max(...parts.map(part => part.importance)));
      expect(composite.tags).toEqual(expect.arrayContaining([...new Set(parts.flatMap(part => part.tags))]));
      expect(new Set(composite.tags).size).toBe(composite.tags.length);
      expect(composite.seriesKeys).toHaveLength(2);
      expect(composite.values).toMatchObject({ tradeFromTurn: 5, tradeToTurn: 10, eventTurn: 10 });
      const mismatched = detectTriggers(evidence, config, context).map(trigger => trigger.definitionId === 'deal' ? { ...trigger, subject: 'civilization/99' } : trigger);
      expect(matchTemplates(mismatched, config, evidenceConditionContext(evidence, context)).some(candidate => candidate.templateIds.includes('trade-and-exchange'))).toBe(false);
    });

    it('should exclude LLM-only and unauthored templates before scoring and keep canonical series unique', () => {
      const evidence = fixture();
      const altered = structuredClone(config);
      altered.templates.push({ ...altered.templates[0], id: 'llm-only', mode: 'llmOnly', variants: [] });
      altered.templates.push({ ...altered.templates[0], id: 'no-prose', variants: [] });
      const candidates = matchTemplates(detectTriggers(evidence, altered, context), altered, evidenceConditionContext(evidence, context));
      expect(candidates.some(candidate => candidate.templateIds.includes('llm-only') || candidate.templateIds.includes('no-prose'))).toBe(false);
      const state = createInitialPublicationState();
      const selected = selectHeuristic(candidates, state, altered, computeFeedback(state, altered)).selected;
      const keys = selected.flatMap(candidate => candidate.seriesKeys);
      expect(new Set(keys).size).toBe(keys.length);
      expect(selected.some(candidate => candidate.templateIds.includes('trade-and-exchange'))).toBe(true);
      expect(selected.some(candidate => candidate.short)).toBe(false);
    });

    it('should author domestic recovery alongside an urgent diplomatic account', () => {
      const evidence = fixture();
      evidence.comparisons.cities.push(snapshot(3, 2, { Owner: 'France', Population: 13 }, true));
      evidence.events.push({ type: 'DeclareWar', values: { OriginatingPlayerID: 2, TargetTeamID: 7 },
        source: { table: 'GameEvents', id: 99, turn: 9, createdAt: 9000 } });
      const candidates = matchTemplates(detectTriggers(evidence, config, context), config, evidenceConditionContext(evidence, context));
      const domestic = candidates.find(candidate => candidate.templateIds.includes('settlement-recovery'))!;
      const urgent = candidates.find(candidate => candidate.templateIds.includes('war-declaration-account'))!;
      expect(domestic).toMatchObject({ subject: 'city/3', values: { recoveryGrowth: 2, population: 12 } });
      expect(urgent).toMatchObject({ urgent: true, values: { eventTurn: 9, partner: 'Zulu' } });
      expect(urgent.variants.length).toBeGreaterThan(0);
    });

    it('should publish reproducibly with one history contribution despite repeated page membership', () => {
      const state = createInitialPublicationState();
      const before = structuredClone(state);
      const catalogue = structuredClone(config);
      catalogue.defaults.frontPageItems = 2;
      const first = check(fixture(), state, catalogue);
      const second = check(fixture(), state, catalogue);
      expect(first).toEqual(second);
      expect(state).toEqual(before);
      expect(first.status).toBe('published');
      if (first.status !== 'published') return;
      expect(publicationStateSchema.safeParse(first.state).success).toBe(true);
      expect(first.issue.publication.designId).toBe('oral-accounts');
      const repeated = first.issue.items.find(item => first.issue.pages.filter(page => page.itemIds.includes(item.id)).length > 1)!;
      expect(repeated).toBeDefined();
      const record = first.state.issues[0].items.find(item => item.id === repeated.id)!;
      for (const key of record.seriesKeys) expect(first.state.series[key].importance).toBe(record.importance);
      expect(new Set(first.issue.items.flatMap(item => item.seriesKeys)).size).toBe(first.issue.items.flatMap(item => item.seriesKeys).length);
      expect(first.state.issues[0].items.some(item => item.templateIds.includes('trade-and-exchange'))).toBe(true);
    });

    it('should preserve random choices across comparison branches while giving their articles distinct identities', () => {
      const first = check(fixture());
      const second = runEditorialCheck({ campaignId: 'campaign', timelineId: 'comparison', receiver: { playerId: 0, label: 'France' },
        evidence: fixture(), state: createInitialPublicationState(), config, context });
      expect(first.status).toBe('published');
      expect(second.status).toBe('published');
      if (first.status !== 'published' || second.status !== 'published') return;
      expect(first.issue.items.map(item => [item.headline, item.body])).toEqual(second.issue.items.map(item => [item.headline, item.body]));
      expect(first.issue.pages.map(page => page.layout)).toEqual(second.issue.pages.map(page => page.layout));
      expect(first.issue.items[0].id).not.toBe(second.issue.items[0].id);
      expect(first.decision.seed).toBe(second.decision.seed);
    });

    it('should evolve designs with recorded era names while keeping incomplete early history eligible', () => {
      const early = check(fixture());
      const classicalEvidence = fixture();
      classicalEvidence.players[0].values.Era = 'Classical';
      const classical = check(classicalEvidence);
      const modernEvidence = fixture();
      modernEvidence.players[0].values.Era = 'Modern';
      const modern = check(modernEvidence);
      expect(early.status === 'published' && early.issue.publication.designId).toBe('oral-accounts');
      expect(classical.status === 'published' && classical.issue.publication.designId).toBe('victorian');
      // Limit the choices to verify eligibility independently of weighted alternatives.
      const modernOnly = structuredClone(config);
      modernOnly.designs = modernOnly.designs.filter(design => design.id === 'modern');
      const controlled = check(modernEvidence, createInitialPublicationState(), modernOnly);
      expect(controlled.status === 'published' && controlled.issue.publication.designId).toBe('modern');
      expect(modern.status).toBe('published');
    });

    it('should retain the modern design for Future Era and use the early account for an unknown era', () => {
      const state = createInitialPublicationState();
      state.previousDesignId = 'modern';
      const late = fixture();
      late.players[0].values.Era = 'Future Era';
      const future = check(late, state);
      expect(future.status === 'published' && future.issue.publication.designId).toBe('modern');
      late.players[0].values.Era = 'Unrecognized';
      const unknown = check(late, state);
      expect(unknown.status === 'published' && unknown.issue.publication.designId).toBe('oral-accounts');
    });

    it('should exclude the early account from all known later-era choices while preserving unknown and Ancient coverage', () => {
      const early = config.designs.find(design => design.id === 'oral-accounts')!;
      for (const Era of ['Classical', 'Classical Era', 'Modern', 'Modern Era', 'Future', 'Future Era']) {
        const conditions = { values: { Era } };
        expect(selectionWeight(early.weight, conditions)).toBe(0);
        for (let draw = 0; draw < 100; draw++) {
          expect(chooseDesign(config, conditions, null, () => draw / 100)?.id).not.toBe('oral-accounts');
          expect(chooseDesign(config, conditions, 'oral-accounts', () => draw / 100)?.id).not.toBe('oral-accounts');
        }
      }
      for (const values of [{}, { Era: 'Unrecognized' }, { Era: 'Ancient' }, { Era: 'Ancient Era' }]) {
        expect(selectionWeight(early.weight, { values })).toBeGreaterThan(0);
        expect(chooseDesign(config, { values }, null, () => 0.99)?.id).toBe('oral-accounts');
      }
    });

    it('should propagate invalid effective layouts and preserve the original checkpoint for retry', () => {
      const first = check(fixture());
      expect(first.status).toBe('published');
      const preserved = structuredClone(first.state);
      const invalid = structuredClone(config);
      const activeDesign = invalid.designs.find(design => design.id === first.decision.designId)!;
      activeDesign.layouts.find(layout => layout.variant === 'breaking')!.weight.adjustments = [
        { condition: { op: 'eq', field: 'Era', value: 'Ancient Era' }, add: -10 },
      ];
      expect(editorialConfigSchema.safeParse(invalid).success).toBe(false);
      const next = fixture(20, 10);
      expect(() => check(next, first.state, invalid)).toThrow();
      expect(first.state).toEqual(preserved);
      const retried = check(next, first.state);
      expect(retried.status).toBe('published');
      expect(retried.state.lastCheckTurn).toBe(20);
    });

    it('should reserve room for a useful independent short piece alongside larger developments', () => {
      const evidence = fixture();
      evidence.events.push({ type: 'DealMade', values: { FromPlayerID: 0, ToPlayerID: 2, TradedItems: [{ ItemType: 'OpenBorders', FromPlayerID: 0 }] },
        source: { table: 'GameEvents', id: 123, turn: 10, createdAt: 10000 } });
      const revised = structuredClone(config);
      revised.defaults.maxItems = 2;
      const candidates = matchTemplates(detectTriggers(evidence, revised, context), revised, evidenceConditionContext(evidence, context));
      const state = createInitialPublicationState();
      const selected = selectHeuristic(candidates, state, revised, computeFeedback(state, revised)).selected;
      expect(selected).toHaveLength(2);
      expect(selected.some(candidate => candidate.short)).toBe(true);
      expect(selected.some(candidate => !candidate.short)).toBe(true);
    });

    it('should retain stored presentation and configuration when later catalogue values change', () => {
      const catalogue = structuredClone(config);
      const result = check(fixture(), createInitialPublicationState(), catalogue);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const preserved = structuredClone(result.issue.publication);
      const snapshot = structuredClone(result.decision.configurationSnapshot);
      catalogue.designs[0].presentation.tokens!.paperColor = '#123456';
      catalogue.defaults.maxItems = 1;
      expect(result.issue.publication).toEqual(preserved);
      expect(result.decision.configurationSnapshot).toEqual(snapshot);
    });

    it('should advance skipped periods and decay memory once before a returning development', () => {
      const first = check(fixture());
      expect(first.status).toBe('published');
      const quiet = fixture(10, 10);
      quiet.request.cutoffTurn = 15;
      quiet.events = [];
      const skipped = check(quiet, first.state);
      expect(skipped.status).toBe('skipped');
      expect(skipped.state.lastCheckTurn).toBe(15);
      const key = Object.keys(first.state.series).find(key => key.endsWith('/trade/0/1'))!;
      expect(skipped.state.series[key].importance).toBeCloseTo(first.state.series[key].importance * config.defaults.decayPerTurn ** 5);
      expect(decaySeries(skipped.state.series, 15, config.defaults.decayPerTurn)).toEqual(skipped.state.series);
      const returned = fixture(20, 15);
      returned.comparisons.players = fixture().players;
      returned.players[0].values.OutgoingTradeRoutes = { 'Paris => Marrakesh (Morocco)': { FromGold: 10 }, 'Paris => Ulundi (Zulu)': { FromGold: 40 } };
      const result = check(returned, skipped.state);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      expect(result.issue.items.some(item => item.seriesKeys.includes(key) && item.earlierReport?.target.issueId === first.state.issues[0].issueId)).toBe(true);
      expect(result.state.lastCheckTurn).toBe(20);
      expect(() => check(returned, result.state)).toThrow();
    });

    it('should lead with an incoming threat despite negative reader votes and large older series', () => {
      const evidence = fixture();
      evidence.events.push({ type: 'DeclareWar', values: { OriginatingPlayerID: 2, TargetTeamID: 7, IsAggressor: false },
        source: { table: 'GameEvents', id: 99, turn: 9, createdAt: 9000 } });
      const state = createInitialPublicationState();
      state.issues = [{ issueId: 'old', turn: 0, items: [historyItem('war-vote', ['war', 'diplomacy'])] }];
      state.votes['war-vote'] = -1;
      const result = check(evidence, state);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const lead = result.state.issues.at(-1)!.items.find(item => item.id === result.issue.pages[0].itemIds[0])!;
      expect(lead.templateIds).toContain('war-declaration-account');
      expect(result.issue.pages[0].layout).toBe('breaking');
      expect(result.issue.pages[0].itemIds.length).toBeGreaterThan(1);
    });

    it('should retain useful short pieces and explicitly record heuristic fallback', () => {
      const evidence = fixture();
      evidence.players = [];
      evidence.cities = [];
      const state = createInitialPublicationState({ llmEnabled: true });
      const result = check(evidence, state);
      expect(result.status).toBe('published');
      expect(result.decision.editor).toBe('heuristic');
      expect(result.decision.fallbackReason).toBeTruthy();
      expect(result.state.issues[0].items[0].templateIds).toContain('diplomatic-exchange');
    });
  });

  describe('current-vote feedback', () => {
    it('should change the next selected story when a current vote changes and restore it when cleared', () => {
      const revised = structuredClone(config);
      revised.defaults.maxItems = 1;
      const evidence = fixture();
      const matched = matchTemplates(detectTriggers(evidence, revised, context), revised, evidenceConditionContext(evidence, context));
      const candidates = [matched.find(candidate => candidate.templateIds.includes('population-boom'))!,
        matched.find(candidate => candidate.templateIds.includes('cultural-development'))!]
        .map((candidate, index) => ({ ...candidate, id: `candidate-${index}`, importance: 40, weight: 1 }));
      const state = createInitialPublicationState();
      state.issues = [{ issueId: 'old', turn: 1,
        items: [historyItem('reader-choice', candidates[1].tags, candidates[1].seriesKeys)] }];
      const neutral = selectHeuristic(candidates, state, revised, computeFeedback(state, revised));
      expect(neutral.selected.map(candidate => candidate.id)).toEqual(['candidate-0']);
      state.votes['reader-choice'] = 1;
      const voted = selectHeuristic(candidates, state, revised, computeFeedback(state, revised));
      expect(voted.selected.map(candidate => candidate.id)).toEqual(['candidate-1']);
      state.votes['reader-choice'] = 0;
      const cleared = selectHeuristic(candidates, state, revised, computeFeedback(state, revised));
      expect(cleared.selected.map(candidate => candidate.id)).toEqual(['candidate-0']);
    });

    it('should replace and clear votes exactly, ignoring importance and page duplication', () => {
      const state = createInitialPublicationState();
      state.issues = [{ issueId: 'old', turn: 1, items: [historyItem('a', ['trade', 'economy']), historyItem('a', ['trade', 'economy'])] }];
      state.votes.a = 1;
      const positive = computeFeedback(state, config);
      expect(positive.windowItemIds).toEqual(['a']);
      expect(positive.seriesAdjustments['trade/0/1']).toBe(config.defaults.feedback.series);
      state.votes.a = -1;
      const negative = computeFeedback(state, config);
      expect(negative.seriesAdjustments['trade/0/1']).toBe(-positive.seriesAdjustments['trade/0/1']);
      expect(negative.tagAdjustments.trade).toBe(-positive.tagAdjustments.trade);
      state.votes.a = 0;
      expect(candidateFeedback(['trade/0/1'], ['trade'], computeFeedback(state, config))).toBe(0);
    });

    it('should give rare tags more influence and count unrated items in the corpus window', () => {
      const state = createInitialPublicationState();
      state.issues = [{ issueId: 'old', turn: 1, items: [historyItem('a', ['common', 'rare']),
        historyItem('b', ['common']), historyItem('c', ['common']), historyItem('d', ['common'])] }];
      state.votes.a = 1;
      const feedback = computeFeedback(state, config);
      expect(feedback.windowItemIds).toHaveLength(4);
      expect(feedback.tagCounts).toEqual({ common: 4, rare: 1 });
      expect(feedback.tagAdjustments.rare).toBeGreaterThan(feedback.tagAdjustments.common);
      const revised = structuredClone(config);
      revised.defaults.feedback.window = 1;
      const bounded = computeFeedback(state, revised);
      expect(bounded.windowItemIds).toEqual(['d']);
      expect(bounded.tagAdjustments.common).toBe(0);
      expect(bounded.seriesAdjustments['trade/0/1']).toBe(config.defaults.feedback.series);
    });
  });
});
