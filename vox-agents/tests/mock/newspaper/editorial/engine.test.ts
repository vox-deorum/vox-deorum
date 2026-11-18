/** Behavioral checks for authored issues, selection, and feedback. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, editorialDecisionRecordSchema, publicationStateSchema, type PublishedItemRecord } from '../../../../src/newspaper/contracts/publication.js';
import type { RuleDevelopment } from '../../../../src/newspaper/contracts/triggers.js';
import { getEditorialExpressions, loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema, type EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { matchTemplates } from '../../../../src/newspaper/editorial/selection/templates.js';
import { computeFeedback, candidateFeedback } from '../../../../src/newspaper/editorial/selection/feedback.js';
import { decaySeries } from '../../../../src/newspaper/editorial/selection/series.js';
import { selectHeuristic } from '../../../../src/newspaper/editorial/selection/heuristic.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { chooseDesign } from '../../../../src/newspaper/editorial/presentation/issue.js';
import { evaluatePresentation } from '../../../../src/newspaper/editorial/presentation/eligibility.js';

let config: EditorialConfig;

/** Build a permitted snapshot with a predictable row reference. */
function snapshot(subjectID: number, turn: number, values: Record<string, unknown>): NewspaperSnapshot {
  return { subjectID, values, source: { table: 'PlayerSummaries', id: turn * 100 + subjectID, turn, createdAt: turn * 1000 } };
}

/** Give the first two known players independent facts for authored stories. */
function fixture(turn = 10, previousCheckTurn = 5, gold = 20, Era = 'Ancient Era'): NewspaperEvidence {
  return {
    request: { receiverPlayerID: 0, previousCheckTurn, cutoffTurn: turn },
    players: [snapshot(0, turn, { Era, Gold: gold }), snapshot(1, turn, { CulturePerTurn: 12 })],
    cities: [], comparisons: { players: [], cities: [] }, events: [],
  };
}

/** Run the real editor on a single fact model. */
function check(evidence: NewspaperEvidence, state = createInitialPublicationState(), catalogue = config, timelineId = 'branch') {
  return runEditorialCheck({ campaignId: 'campaign', timelineId, receiver: { playerId: 0, label: 'France' },
    evidence, facts: buildNewspaperFacts(evidence), speedMultiplier: 1, state, config: catalogue });
}

/** Build minimal history for feedback calculations. */
function historyItem(id: string, tags: string[], seriesKeys = ['trade/0/1']): PublishedItemRecord {
  return { id, issueId: 'old', turn: 1, tags, seriesKeys, templateIds: ['authored'], triggerIds: ['observed'],
    importance: 100, headline: [{ type: 'text', text: 'Earlier headline' }], evidenceSummary: 'Audit detail', sources: [], fingerprint: id };
}

/** Let selection tests control developments without running or reproducing rule evaluation. */
function development(definitionId: string, subject: string, importance = 50): RuleDevelopment {
  const id = `${definitionId}/${subject}`;
  return { id, definitionId, subject, period: { from: 5, to: 10 }, seriesKeys: [id], importance, urgent: false,
    tags: [definitionId], values: { amount: 20, $balance: 20 }, sources: [snapshot(0, 10, {}).source], fingerprint: id };
}

describe('editorial engine', () => {
  beforeAll(async () => {
    const base = await loadEditorialConfig();
    config = editorialConfigSchema.parse({
      ...base,
      triggers: [
        { id: 'ledger', subject: 'player', when: ['player.self', 'player.gold > 0'], values: { $balance: 'player.gold' }, importance: 70, urgent: '$balance >= 100' },
        { id: 'culture', subject: 'player', when: ['!player.self', 'player.culturePerTurn > 0'], values: { amount: 'player.culturePerTurn' } },
        { id: 'balance', subject: 'player', when: ['player.self', 'player.gold > 10'], values: { amount: 'player.gold - 10' }, importance: 65 },
      ],
      templates: [
        { id: 'ledger', triggers: ['ledger'], tags: ['economy'], weight: { base: 1 }, variants: [{ id: 'ledger', headline: 'Treasury: {{$balance}}', body: ['The account stood at {{$balance}} gold.'], weight: { base: 1 } }] },
        { id: 'culture', triggers: ['culture'], tags: ['culture'], short: true, weight: { base: 1 }, variants: [{ id: 'culture', headline: 'New work', body: ['Cultural output reached {{amount}}.'], weight: { base: 1 } }] },
      ],
    });
  });

  describe('authored selection and history', () => {
    it('should archive runtime choice errors without printing failed stories or disrupting other coverage', async () => {
      const revised = editorialConfigSchema.parse({
        ...config,
        templates: [
          { ...config.templates[0], when: '(() => { throw new Error("template failure"); })()' },
          { ...config.templates[0], id: 'failed-variant', variants: [
            { ...config.templates[0].variants[0], when: '(() => { throw new Error("variant failure"); })()' },
          ] },
          config.templates[1],
        ],
      });
      const result = await check(fixture(), createInitialPublicationState(), revised);
      expect(result.status).toBe('published');
      if (result.status !== 'published') throw new Error('Expected unrelated coverage to publish.');
      expect(result.state.issues[0].items.map(item => item.templateIds)).toEqual([['culture']]);
      const expectedErrors = [
        { choice: 'template ledger', field: 'when', message: 'template failure' },
        { choice: 'template failed-variant / variant ledger', field: 'when', message: 'variant failure' },
      ];
      expect(editorialDecisionRecordSchema.parse(result.decision).choiceErrors).toEqual(expectedErrors);
      const publicIssue = JSON.stringify(result.issue);
      expect(publicIssue).not.toContain('template failure');
      expect(publicIssue).not.toContain('variant failure');

      const noStories = await check(fixture(), createInitialPublicationState(), { ...revised, templates: revised.templates.slice(0, 2) });
      expect(noStories.status).toBe('skipped');
      expect(noStories.decision.choiceErrors).toEqual(expectedErrors);
    });

    it('should print a settler departure only when an authored variant is eligible', async () => {
      const stock = await loadEditorialConfig();
      const revised = editorialConfigSchema.parse({
        ...stock,
        templates: [{
          id: 'pioneer-departure', triggers: ['settler-departure'], tags: ['home'],
          when: 'city.id === 10 && values.lost === 2 && period.to === 10',
          weight: { base: 1 },
          variants: [
            { id: 'unavailable', when: 'false', weight: { base: 10000 },
              headline: '{{city.name}} welcomes new residents', body: ['Several families have arrived.'] },
            { id: 'departure', when: 'lost > 0', weight: { base: 1 },
              headline: 'Pioneers depart {{city.name}}', body: ['The settlement counts {{lost}} fewer residents.'] },
          ],
        }],
      });
      const evidence = fixture();
      const past = {
        subjectID: 10, values: { Name: 'Tours', OwnerID: 0, X: 10, Y: 0, Population: 8 },
        source: { table: 'CityInformations' as const, id: 101, turn: 5, createdAt: 5002 },
      };
      const city = {
        ...past, values: { ...past.values, Population: 6, FoodPerTurn: 2 },
        source: { ...past.source, id: 102, turn: 10, createdAt: 10002 },
      };
      const training = {
        type: 'CityTrained', values: { PlayerID: 0, CityID: 10, CityX: 10, CityY: 0, Unit: 'Pioneer' },
        source: { table: 'GameEvents' as const, id: 103, turn: 7, createdAt: 7008 },
      };
      evidence.cities.push(city);
      evidence.comparisons.cities.push(past);
      evidence.events.push(training);
      evidence.request.historyFromTurn = -1;
      evidence.history = {
        fromTurn: -1, baseline: { cities: [], players: [] },
        snapshots: { cities: [past, city], players: evidence.players }, events: [training], gaps: [],
      };
      const empty = await check(evidence, createInitialPublicationState(), stock);
      expect(empty.status).toBe('skipped');
      expect(empty.decision.triggerAudit.find(rule => rule.rule === 'settler-departure')?.subjects)
        .toContainEqual(expect.objectContaining({ subject: 'city/10', outcome: 'fired' }));

      const result = await check(evidence, createInitialPublicationState(), revised);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const [article] = result.issue.items;
      expect(result.decision.selectedVariants).toEqual({ [article.id]: 'departure' });
      expect(article.headline).toContainEqual({ type: 'text', text: 'Tours' });
      expect(article.body[0]).toContainEqual({ type: 'text', text: '2' });
      expect(result.decision.evidence).toEqual(expect.arrayContaining([past.source, city.source, training.source]));
    });

    it('should exclude unauthored and LLM-only templates and reserve space for an independent short item', async () => {
      const revised = editorialConfigSchema.parse({ ...config, defaults: { ...config.defaults, maxItems: 2 }, templates: [
        ...config.templates, { ...config.templates[0], id: 'model', mode: 'llmOnly' }, { ...config.templates[0], id: 'missing', variants: [] },
        { ...config.templates[0], id: 'balance', triggers: ['balance'] },
      ] });
      const candidates = await matchTemplates([
        development('ledger', 'player/0', 90), development('balance', 'player/0', 80), development('culture', 'player/1', 10),
      ], revised, await getEditorialExpressions(revised), { facts: buildNewspaperFacts(fixture()) });
      expect(candidates.map(candidate => candidate.templateIds[0])).toEqual(['ledger', 'culture', 'balance']);
      const state = createInitialPublicationState();
      expect(selectHeuristic(candidates, state, revised, computeFeedback(state, revised)).selected.map(candidate => candidate.templateIds[0]))
        .toEqual(['ledger', 'culture']);
    });

    it('should publish reproducibly and preserve choices across branches with distinct identities', async () => {
      const state = createInitialPublicationState();
      const before = structuredClone(state);
      const first = await check(fixture(), state);
      const same = await check(fixture(), state);
      const branch = await check(fixture(), state, config, 'comparison');
      expect(first).toEqual(same);
      expect(state).toEqual(before);
      expect(first.status).toBe('published');
      expect(branch.status).toBe('published');
      if (first.status !== 'published' || branch.status !== 'published') return;
      expect(publicationStateSchema.parse(first.state)).toEqual(first.state);
      expect(first.issue.items.map(item => [item.headline, item.body])).toEqual(branch.issue.items.map(item => [item.headline, item.body]));
      expect(first.issue.pages.map(page => page.layout)).toEqual(branch.issue.pages.map(page => page.layout));
      expect(first.issue.items[0].id).not.toBe(branch.issue.items[0].id);
      expect(first.issue.items[0].headline).toContainEqual({ type: 'text', text: '20' });
      expect(first.decision.seed).toBe(branch.decision.seed);
      expect(first.decision.evidence).toEqual(fixture().players.map(player => player.source));
    });

    it('should publish independent rules about the same subject as separate series', async () => {
      const revised = editorialConfigSchema.parse({ ...config, templates: [...config.templates,
        { ...config.templates[0], id: 'balance', triggers: ['balance'],
          variants: [{ id: 'surplus', headline: 'Surplus', body: ['{{amount}} remained.'], weight: { base: 1 } }] },
      ] });
      const result = await check(fixture(), createInitialPublicationState(), revised);
      expect(result.status).toBe('published');
      expect(result.state.issues[0].items.map(item => item.templateIds[0])).toEqual(expect.arrayContaining(['ledger', 'balance']));
      const keys = result.state.issues[0].items.flatMap(item => item.seriesKeys);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('should count a story only once in history when it appears on two pages', async () => {
      const revised = editorialConfigSchema.parse({
        ...config, defaults: { ...config.defaults, frontPageItems: 2 },
        pages: [...config.pages, { id: 'ledger-and-culture', label: 'Local news', order: 10,
          minimum: 2, tags: ['economy', 'culture'] }],
        templates: [...config.templates, { ...config.templates[0], id: 'balance', triggers: ['balance'],
          variants: [{ id: 'surplus', headline: 'Surplus', body: ['{{amount}} remained.'], weight: { base: 1 } }] }],
      });
      const result = await check(fixture(), createInitialPublicationState(), revised);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const repeated = result.issue.items.find(item => result.issue.pages.filter(page => page.itemIds.includes(item.id)).length > 1);
      expect(repeated).toBeDefined();
      const records = result.state.issues[0].items.filter(item => item.id === repeated!.id);
      expect(records).toHaveLength(1);
      for (const key of records[0].seriesKeys) expect(result.state.series[key].importance).toBe(records[0].importance);
    });

    it('should preserve issue presentation and the configuration snapshot after later catalogue changes', async () => {
      const revised = structuredClone(config);
      const result = await check(fixture(), createInitialPublicationState(), revised);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const presentation = structuredClone(result.issue.publication);
      const snapshot = structuredClone(result.decision.configurationSnapshot);
      const active = revised.designs.find(design => design.id === result.issue.publication.designId)!;
      active.presentation.tokens!.paperColor = '#123456';
      revised.defaults.maxItems = 1;
      expect(result.issue.publication).toEqual(presentation);
      expect(result.decision.configurationSnapshot).toEqual(snapshot);
    });

    it('should reject a missing masthead font in an authored design', () => {
      const revised = structuredClone(config);
      revised.designs[0].presentation.tokens!.mastheadFontAssetId = 'missing-masthead-font';
      expect(editorialConfigSchema.safeParse(revised).success).toBe(false);
      revised.designs[0].presentation.tokens!.mastheadFontAssetId = 'font-unifrakturmaguntia-400';
      expect(editorialConfigSchema.safeParse(revised).success).toBe(true);
    });

    it('should keep invalid evidence from changing the checkpoint', async () => {
      const state = createInitialPublicationState();
      const before = structuredClone(state);
      const evidence = fixture();
      evidence.players.push(snapshot(5, 11, {}));
      await expect(check(evidence, state)).rejects.toThrow('after the cutoff');
      expect(state).toEqual(before);
    });

    it('should decay series through a skipped check and link a later report to authored prose', async () => {
      const first = await check(fixture());
      expect(first.status).toBe('published');
      if (first.status !== 'published') return;
      const earlier = first.state.issues[0].items.find(item => item.templateIds[0] === 'ledger')!;
      const key = earlier.seriesKeys[0];
      const skipped = await check(fixture(15, 10, 0), first.state);
      expect(skipped.status).toBe('skipped');
      expect(skipped.state.lastCheckTurn).toBe(15);
      expect(skipped.state.series[key].importance).toBeCloseTo(first.state.series[key].importance * config.defaults.decayPerTurn ** 5);
      expect(decaySeries(skipped.state.series, 15, config.defaults.decayPerTurn)).toEqual(skipped.state.series);
      const later = await check(fixture(20, 15, 35), skipped.state);
      expect(later.status).toBe('published');
      if (later.status !== 'published') return;
      expect(later.issue.items.find(item => item.seriesKeys.includes(key))?.earlierReport).toMatchObject({
        target: { issueId: earlier.issueId, itemId: earlier.id }, summary: [earlier.headline],
      });
      await expect(check(fixture(20, 15), later.state)).rejects.toThrow('must follow');
    });

    it('should lead with a rule marked urgent and record heuristic fallback', async () => {
      const result = await check(fixture(10, 5, 150), createInitialPublicationState({ llmEnabled: true }));
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const lead = result.state.issues[0].items.find(item => item.id === result.issue.pages[0].itemIds[0]);
      expect(lead?.templateIds).toEqual(['ledger']);
      expect(result.issue.pages[0].layout).toBe('breaking');
      expect(result.issue.pages[0].itemIds).toHaveLength(2);
      expect(result.decision.fallbackReason).toBeTruthy();
    });

    it('should retain the modern design when a published Modern Era run reaches the Future Era', async () => {
      const modernOnly = { ...config, designs: config.designs.filter(design => design.id === 'modern') };
      const first = await check(fixture(10, 5, 0, 'Modern Era'), createInitialPublicationState(), modernOnly);
      expect(first.status).toBe('published');
      expect(first.state.previousDesignId).toBe('modern');
      const future = await check(fixture(20, 10, 25, 'Future Era'), first.state);
      expect(future.status === 'published' && future.issue.publication.designId).toBe('modern');
    });

    it('should save a skipped check when no design is eligible', async () => {
      const revised = editorialConfigSchema.parse({
        ...config,
        designs: config.designs.map(design => ({ ...design, when: 'false' })),
      });
      const result = await check(fixture(), createInitialPublicationState(), revised);
      expect(result.status).toBe('skipped');
      expect(result.state.lastCheckTurn).toBe(10);
      expect(result.state.issues).toHaveLength(0);
      expect(result.decision.designId).toBeNull();
      expect(result.decision).not.toHaveProperty('choiceErrors');
      expect(result.decision.triggerAudit.some(rule => rule.subjects.some(subject => subject.outcome === 'fired')))
        .toBe(true);
    });

    it('should save a design runtime error when it causes publication to skip', async () => {
      const [design] = config.designs;
      const revised = editorialConfigSchema.parse({
        ...config,
        designs: [{ ...design, when: '(() => { throw new Error("design failure"); })()' }],
      });
      const result = await check(fixture(), createInitialPublicationState(), revised);
      expect(result.status).toBe('skipped');
      expect(result.decision.choiceErrors).toEqual([
        { choice: `design ${design.id}`, field: 'when', message: 'design failure' },
      ]);
    });

    it('should explain when exhausting the shared rule budget prevented presentation choices', async () => {
      const runawayRules = Array.from({ length: 8 }, (_, index) => ({
        id: `runaway-${index}`, subject: 'world' as const, when: '(() => { while (true) {} })()',
      }));
      const oneRunaway = editorialConfigSchema.parse({ ...config, triggers: [...config.triggers, runawayRules[0]] });
      const complete = await check(fixture(), createInitialPublicationState(), oneRunaway);
      expect(complete.status).toBe('published');
      expect(complete.decision).not.toHaveProperty('choiceErrors');

      const exhausted = editorialConfigSchema.parse({ ...config, triggers: [...config.triggers, ...runawayRules] });
      const result = await check(fixture(), createInitialPublicationState(), exhausted);
      expect(result.status).toBe('skipped');
      expect(result.decision.triggerAudit.find(rule => rule.rule === 'ledger')?.subjects)
        .toContainEqual(expect.objectContaining({ outcome: 'fired' }));
      expect(result.decision.reason).toMatch(/choices could not run.*interruption limit/);
      expect(result.decision.choiceErrors).toEqual([
        { choice: 'editorial choices', field: 'evaluation', message: expect.stringContaining('interruption limit') },
      ]);

      const fallback = editorialConfigSchema.parse({
        ...exhausted,
        designs: [...exhausted.designs, {
          ...exhausted.designs[0], id: 'constant-fallback', when: undefined, weight: { base: 1 },
        }],
      });
      const partial = await check(fixture(), createInitialPublicationState(), fallback);
      expect(partial.status).toBe('published');
      if (partial.status !== 'published') throw new Error('Expected the constant fallback to publish.');
      expect(partial.issue.publication.designId).toBe('constant-fallback');
      expect(partial.decision.choiceErrors).toEqual(result.decision.choiceErrors);
      expect(JSON.stringify(partial.issue)).not.toContain('interruption limit');
    });

    it('should reject an invalid layout without consuming a rule or mutating the checkpoint', async () => {
      const first = await check(fixture(10, 5, 0));
      expect(first.status).toBe('published');
      const preserved = structuredClone(first.state);
      const invalid = structuredClone(config);
      const active = invalid.designs.find(design => design.id === first.state.previousDesignId)!;
      const layout = active.layouts.find(entry => entry.variant === 'breaking')!;
      layout.when = 'false';
      expect(editorialConfigSchema.safeParse(invalid).success).toBe(false);
      const evidence = fixture(20, 10, 150);
      await expect(check(evidence, first.state, invalid)).rejects.toThrow(/available breaking layout/i);
      expect(first.state).toEqual(preserved);
      const retried = await check(evidence, first.state);
      expect(retried.status).toBe('published');
      expect(retried.state.lastCheckTurn).toBe(20);
    });

    it('should exclude the early account from all known later-era choices while preserving unknown and Ancient coverage', async () => {
      const early = config.designs.find(design => design.id === 'oral-accounts')!;
      const compiled = await getEditorialExpressions(config);
      for (const [era, expected] of [
        ['Classical', 0], ['Classical Era', 0], ['Modern', 0], ['Modern Era', 0], ['Future', 0], ['Future Era', 0],
        [undefined, 10], ['Unrecognized', 10], ['Ancient', 10], ['Ancient Era', 10],
      ] as const) {
        const evidence = fixture();
        evidence.players[0].values.Era = era;
        const weights = await evaluatePresentation(config, compiled, { facts: buildNewspaperFacts(evidence) });
        expect(weights.get(early)).toBe(expected);
        if (expected === 0)
          expect(chooseDesign(config, weights, 'oral-accounts', () => 0.99)?.id).not.toBe('oral-accounts');
      }
    });

  });

  describe('current-vote feedback', () => {
    it('should change the next selected story when a current vote changes and restore it when cleared', async () => {
      const revised = structuredClone(config);
      revised.defaults.maxItems = 1;
      const candidates = (await matchTemplates([development('ledger', 'player/0'), development('culture', 'player/1')],
        revised, await getEditorialExpressions(revised), { facts: buildNewspaperFacts(fixture()) })).map((candidate, index) => ({ ...candidate, id: `candidate-${index}`, importance: 40, weight: 1 }));
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
