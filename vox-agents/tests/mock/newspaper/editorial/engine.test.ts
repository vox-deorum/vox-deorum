/** Behavioral checks for authored issues, selection, and feedback. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewspaperEvidence, NewspaperSnapshot } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState, editorialDecisionRecordSchema, publicationStateSchema, type PublishedItemRecord } from '../../../../src/newspaper/contracts/publication.js';
import type { RuleDevelopment } from '../../../../src/newspaper/contracts/triggers.js';
import { getEditorialExpressions, loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { editorialConfigSchema, type EditorialConfig } from '../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../src/newspaper/editorial/facts/index.js';
import { matchTemplates, type EditorialCandidate } from '../../../../src/newspaper/editorial/selection/templates.js';
import { applyStylePreferences } from '../../../../src/newspaper/editorial/selection/styles.js';
import { computeFeedback, candidateFeedback } from '../../../../src/newspaper/editorial/selection/feedback.js';
import { decaySeries } from '../../../../src/newspaper/editorial/selection/series.js';
import { selectHeuristic } from '../../../../src/newspaper/editorial/selection/heuristic.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { chooseDesign } from '../../../../src/newspaper/editorial/presentation/issue.js';
import { evaluatePresentation } from '../../../../src/newspaper/editorial/presentation/eligibility.js';
import { createEditorialStreams } from '../../../../src/newspaper/editorial/shared/determinism.js';

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
function check(evidence: NewspaperEvidence, state = createInitialPublicationState(), catalogue = config, timelineId = 'branch', campaignId = 'campaign') {
  return runEditorialCheck({ campaignId, timelineId, receiver: { playerId: 0, label: 'France' },
    evidence, facts: buildNewspaperFacts(evidence), speedMultiplier: 1, state, config: catalogue });
}

/** Evaluate the stock designs against the receiver's recorded civilization and era. */
async function designChoices(name: string, era?: string) {
  const evidence = fixture();
  evidence.players[0].values.Era = era;
  const facts = buildNewspaperFacts(evidence, { playerIdentities: { 0: { name } } });
  const weights = await evaluatePresentation(config, await getEditorialExpressions(config), { facts });
  return {
    weights,
    byId: Object.fromEntries(config.designs.map(design => [design.id, weights.get(design)!])),
  };
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

/** Build a selected candidate with explicit style variants for preference tests. */
function styleCandidate(
  id: string, variants: EditorialCandidate['variants'],
  facts: Partial<Pick<EditorialCandidate, 'importance' | 'urgent' | 'short' | 'tags'>> = {},
): EditorialCandidate {
  return {
    id, subject: `player/${id}`, period: { from: 5, to: 10 }, triggerIds: [], ruleIds: [], templateIds: [],
    seriesKeys: [], tags: facts.tags ?? [], importance: facts.importance ?? 50, urgent: facts.urgent ?? false,
    short: facts.short ?? false, weight: 1, variants,
    variantWeights: Object.fromEntries(variants.map(variant => [variant.id, 1])),
    variantSources: {}, variantBindings: {}, values: {}, sources: [], fingerprint: id,
  };
}

/** Build a small style catalogue with the supplied rules and variant styles. */
function styleCatalogue(
  rules: NonNullable<EditorialConfig['styles']>['rules'],
  variants: { id: string; stance: string; genre: string }[] = [
    { id: 'letter', stance: 'neutral', genre: 'letter' },
    { id: 'report', stance: 'neutral', genre: 'report' },
  ],
): EditorialConfig {
  return editorialConfigSchema.parse({
    ...config,
    styles: {
      voice: [{ id: 'general' }],
      stance: [{ id: 'neutral' }, { id: 'pro-government' }, { id: 'government-critical' }],
      genre: [{ id: 'report' }, { id: 'letter' }], rules,
    },
    templates: [{
      id: 'styled', triggers: [config.triggers[0].id], tags: [], weight: { base: 1 },
      variants: variants.map(variant => ({
        ...variant, headline: variant.id, body: [variant.id], voice: 'general', weight: { base: 1 },
      })),
    }],
  });
}

/** Apply style rules to selected candidates without running the rest of a check. */
async function applyRules(catalogue: EditorialConfig, candidates: EditorialCandidate[]) {
  const compiled = await getEditorialExpressions(catalogue);
  return applyStylePreferences(candidates, compiled,
    { constants: {}, facts: buildNewspaperFacts(fixture()) }, { interruptedSlots: new Set() });
}

describe('editorial engine', () => {
  beforeAll(async () => {
    const base = await loadEditorialConfig();
    config = editorialConfigSchema.parse({
      ...base,
      defaults: { ...base.defaults, minItems: 1 },
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
    it('should prefer a tag combination using visible happiness without changing eligibility or story selection', async () => {
      const prose = { headline: 'Settlers', body: ['The town trained settlers.'], voice: 'general', weight: { base: 1 } };
      const tagged = editorialConfigSchema.parse({
        ...config,
        styles: {
          voice: [{ id: 'general' }], stance: [{ id: 'neutral' }, { id: 'pro-government' }],
          genre: [{ id: 'report' }, { id: 'letter' }],
          rules: [{
            id: 'happy-letters', match: { stance: 'pro-government', genre: 'letter' },
            when: "(self.knows('happinessPercentage') && self.happinessPercentage > 50) || " +
              "(subject.kind === 'city' && city.own && city.knows('happinessDelta') && city.happinessDelta > 0)",
            multiplier: 4,
          }],
        },
        triggers: [{ id: 'settlers', subject: 'city', when: 'city.own', importance: 70 }],
        templates: [{ id: 'settlers', triggers: ['settlers'], tags: [], weight: { base: 1 }, variants: [
          { ...prose, id: 'ineligible', stance: 'pro-government', genre: 'letter', when: 'false', weight: { base: 1000 } },
          { ...prose, id: 'supportive-letter', stance: 'pro-government', genre: 'letter' },
          { ...prose, id: 'supportive-report', stance: 'pro-government', genre: 'report' },
          { ...prose, id: 'neutral-letter', stance: 'neutral', genre: 'letter' },
        ] }],
      });
      const unweighted = { ...tagged, styles: { ...tagged.styles!, rules: [] } };
      const campaigns = Array.from({ length: 48 }, (_, i) => `campaign-${i}`);
      /** Select seeds that exercise a change in odds and outcomes outside the preferred variant. */
      function campaignFor(lower: number, upper: number): string {
        const campaign = campaigns.find(id => {
          const draw = createEditorialStreams(`${id}/receiver/0/10`, tagged).prose();
          return draw > lower && draw < upper;
        });
        if (!campaign) throw new Error(`No campaign draw between ${lower} and ${upper}.`);
        return campaign;
      }
      /** Run one city story with independent national and local readings. */
      async function publish(campaign: string, national?: number, local?: number, catalogue = tagged) {
        const evidence = fixture();
        if (national !== undefined) evidence.players[0].values.HappinessPercentage = national;
        const values = { OwnerID: 0, Name: 'Tours', ...(local === undefined ? {} : { HappinessDelta: local }) };
        evidence.cities.push({
          subjectID: 2, source: { table: 'CityInformations', id: 42, turn: 10, createdAt: 10_000 }, values,
        });
        const result = await check(evidence, createInitialPublicationState(), catalogue, 'branch', campaign);
        if (result.status !== 'published') throw new Error(result.reason);
        const id = result.issue.items[0].id;
        return {
          decision: result.decision, articleSources: result.state.issues[0].items[0].sources,
          variant: result.decision.selectedVariants[id], style: result.decision.selectedStyles?.[id],
        };
      }
      const swing = campaignFor(0.4, 0.55);
      const baseline = await publish(swing, 70, undefined, unweighted);
      const happier = await publish(swing, 70);
      expect(baseline.variant).toBe('supportive-report');
      expect(happier).toMatchObject({
        variant: 'supportive-letter', style: { voice: 'general', stance: 'pro-government', genre: 'letter' },
      });
      expect(happier.decision.candidateScores).toEqual(baseline.decision.candidateScores);
      expect(happier.decision).toMatchObject({ designId: baseline.decision.designId, layouts: baseline.decision.layouts });
      expect(happier.decision.evidence).toContainEqual(snapshot(0, 10, {}).source);
      expect(baseline.decision.evidence).not.toContainEqual(snapshot(0, 10, {}).source);
      expect(happier.articleSources).toEqual(baseline.articleSources);
      expect((await publish(swing, undefined, 2)).variant).toBe('supportive-letter');
      expect((await publish(swing)).variant).toBe(baseline.variant);
      expect((await publish(swing, 35, -2)).variant).toBe(baseline.variant);
      expect((await publish(campaignFor(0.70, 0.80), 70)).variant).toBe('supportive-report');
      expect((await publish(campaignFor(0.90, 0.99), 70)).variant).toBe('neutral-letter');
      const playerStory = { ...tagged, triggers: [{ ...tagged.triggers[0], subject: 'player' as const, when: 'player.self' }] };
      expect((await publish(swing, undefined, undefined, playerStory)).decision.choiceErrors).toBeUndefined();
      const uniformVoice = { ...tagged, styles: {
        ...tagged.styles!, rules: [{ ...tagged.styles!.rules[0], match: { voice: 'general' } }],
      } };
      expect((await publish(swing, 70, undefined, uniformVoice)).decision.evidence).toEqual(baseline.decision.evidence);
    });

    it('should require printable credits and keep the evidence for a credit printed as a link', async () => {
      const revised = editorialConfigSchema.parse({
        ...config,
        constants: { ...config.constants, terms: { cityDesk: 'self.capital.name' } },
        triggers: [config.triggers[0]],
        templates: [{
          ...config.templates[0], variants: [
            { ...config.templates[0].variants[0], id: 'missing-deck', subheadline: '{{missingDeck}}' },
            { ...config.templates[0].variants[0], id: 'missing-credit', byline: '{{missingCredit}}' },
            { ...config.templates[0].variants[0], id: 'credited', subheadline: 'Balance: {{$balance}}',
              byline: 'By {{desk}}', links: [{
                placeholder: 'desk', label: 'the {{terms.cityDesk}} desk', target: { type: 'screen', screen: 'map' },
              }] },
          ],
        }],
      });
      const evidence = fixture();
      const citySource = { table: 'CityInformations' as const, id: 42, turn: 10, createdAt: 10_000 };
      evidence.cities.push({ subjectID: 2, source: citySource, values: { OwnerID: 0, Name: 'Tours', IsCapital: 1 } });
      const result = await check(evidence, createInitialPublicationState(), revised);
      if (result.status !== 'published') throw new Error(result.reason);
      const [article] = result.issue.items;
      expect(result.decision.selectedVariants[article.id]).toBe('credited');
      expect(article.subheadline).toContainEqual({ type: 'text', text: '20' });
      expect(article.byline).toContainEqual({
        type: 'link', text: 'the Tours desk', target: { type: 'screen', screen: 'map' },
      });
      expect(result.state.issues[0].items[0].sources).toContainEqual(citySource);
    });

    it('should let rules and choices read only the articles printed before this check', async () => {
      const firstCatalogue = editorialConfigSchema.parse({
        ...config,
        triggers: [
          config.triggers[0],
          { id: 'roundup', subject: 'player', when: 'press.issues === 1 && printed("ledger") === null',
            group: { by: '"news"' }, importance: 'press.lastIssueTurn + count + 50' },
          { id: 'unused', subject: 'world', when: 'true' },
        ],
        templates: [
          config.templates[0],
          { id: 'roundup', triggers: ['roundup'], tags: [], weight: { base: 1 },
            variants: [{ id: 'roundup', headline: 'The roundup',
              body: ['Coverage of {{count}} players.'], weight: { base: 1 } }] },
        ],
      });
      const legacy = createInitialPublicationState();
      legacy.issues.push({ issueId: 'old', turn: 1, items: [historyItem('old-article', [])] });
      const first = await check(fixture(), legacy, firstCatalogue);
      expect(first.status).toBe('published');
      expect(first.decision.triggerAudit.find(({ rule }) => rule === 'unused')?.subjects[0].outcome).toBe('fired');
      expect(first.state.issues.at(-1)?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ ruleIds: ['ledger'], subject: 'player/0' }),
        expect.objectContaining({ ruleIds: ['roundup'], subject: 'group/player/"news"', importance: 53 }),
      ]));

      const memory = 'press.issues === 2 && press.lastIssueTurn === 10 && printed("ledger", self)?.turn === 10 && ' +
        'printed("ledger", self).count === 1 && printed("ledger", players[1]) === null && ' +
        'printed("roundup")?.count === 1 && printed("roundup", self) === null && ' +
        'printed("unused") === null && printed("observed") === null';
      const secondCatalogue = editorialConfigSchema.parse({
        ...config,
        triggers: [{ id: 'follow-up', subject: 'player', when: ['player.self', 'player.is.hasPrinted'] }],
        constants: { ...config.constants, shortcuts: { ...config.constants.shortcuts,
          player: { ...config.constants.shortcuts.player, hasPrinted: memory } } },
        templates: [{ id: 'follow-up', triggers: ['follow-up'], tags: [], weight: { base: 1 },
          when: `${memory} && printed("ledger", subject)?.turn === 10 && printed("ledger", "player/0") === null`,
          variants: [{ id: 'follow-up', when: memory, headline: 'A second report',
            body: ['More news.'], weight: { base: 1 } }] }],
        designs: config.designs.map(design => ({ ...design, when: memory })),
      });
      const restored = publicationStateSchema.parse(JSON.parse(JSON.stringify(first.state)));
      const second = await check(fixture(15, 10), restored, secondCatalogue);
      expect(second.status).toBe('published');
      expect(second.state.issues.at(-1)?.items[0].ruleIds).toEqual(['follow-up']);
      expect(restored.issues).toHaveLength(2);
    });

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

    it('should print a settler departure from the stock template and choose only an eligible authored variant', async () => {
      const stock = await loadEditorialConfig();
      const revised = editorialConfigSchema.parse({
        ...stock,
        defaults: { ...stock.defaults, minItems: 1 },
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
      const stockResult = await check(evidence, createInitialPublicationState(), { ...stock, defaults: { ...stock.defaults, minItems: 1 } });
      expect(stockResult.status).toBe('published');
      if (stockResult.status !== 'published') return;
      expect(stock.templates.find(template => template.id === 'settler-departure-account')?.variants.map(variant => variant.id))
        .toContain(stockResult.decision.selectedVariants[stockResult.issue.items[0].id]);
      expect(stockResult.decision.triggerAudit.find(rule => rule.rule === 'settler-departure')?.subjects)
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
      const later = await check(fixture(20, 10, 35), skipped.state);
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

    it('should retain the wire design when a published Modern Era run reaches the Future Era', async () => {
      const wireOnly = { ...config, designs: config.designs.filter(design => design.id === 'wire') };
      const first = await check(fixture(10, 5, 0, 'Modern Era'), createInitialPublicationState(), wireOnly);
      expect(first.status).toBe('published');
      expect(first.state.previousDesignId).toBe('wire');
      const future = await check(fixture(20, 10, 25, 'Future Era'), first.state);
      expect(future.status === 'published' && future.issue.publication.designId).toBe('wire');
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
        mastheadRules: [],
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

    it('should cover every era for a civilization without a regional design', async () => {
      for (const [era, expected] of [
        [undefined, ['oral-accounts']], ['Unrecognized', ['oral-accounts']],
        ['Ancient', ['oral-accounts']], ['Classical', ['oral-accounts']], ['Classical Era', ['oral-accounts']],
        ['Medieval Era', ['court-dispatch', 'town-book', 'victorian']],
        ['Renaissance', ['court-dispatch', 'port-register', 'printer-dispatch', 'victorian']],
        ['Industrial', ['court-dispatch', 'sunday-colour', 'victorian']],
        ['Modern', ['civic-survey', 'national-review', 'sunday-colour', 'victorian', 'wire']],
        ['Atomic Era', ['civic-survey', 'national-review', 'victorian', 'wire']],
        ['Information Era', ['wire']], ['Future', ['wire']],
      ] as const) {
        const { byId, weights } = await designChoices('France', era);
        const eligible = Object.keys(byId).filter(id => byId[id] > 0);
        expect(eligible, era).toEqual(expect.arrayContaining([...expected]));
        if (era === 'Information Era') {
          expect(eligible).not.toContain('victorian');
          expect(eligible).toContain(chooseDesign(config, weights, 'victorian', () => 0)?.id);
        }
        if (era === 'Modern' || era === 'Atomic Era')
          expect(byId.wire).toBeGreaterThan(byId.victorian);
      }
    });

    it('should favor Heian in Japan and make it an occasional choice in Korea and China', async () => {
      for (const [era, general] of [
        ['Classical Era', 'oral-accounts'], ['Medieval', 'victorian'], ['Renaissance Era', 'victorian'],
      ] as const) {
        const japan = (await designChoices('Japan', era)).byId;
        expect(japan.heian, era).toBeGreaterThan(japan[general]);
        for (const name of ['Korea', 'China']) {
          const { byId } = await designChoices(name, era);
          expect(byId.heian, `${name}, ${era}`).toBeGreaterThan(0);
          expect(byId.heian, `${name}, ${era}`).toBeLessThan(byId[general]);
        }
      }
      expect((await designChoices('Japan', 'Ancient')).byId.heian).toBe(0);
      expect((await designChoices('Japan', 'Industrial')).byId.heian).toBe(0);
    });

    it('should offer Egypt to Nubia and let China draw again when Shang loses weight in Classical', async () => {
      for (const era of ['Ancient Era', 'Classical']) {
        const egypt = (await designChoices('Egypt', era)).byId;
        const nubia = (await designChoices('Nubia', era)).byId;
        expect(nubia.egypt, era).toBeGreaterThan(0);
        expect(egypt.egypt, era).toBeGreaterThan(nubia.egypt);
      }
      expect((await designChoices('Nubia', 'Medieval')).byId.egypt).toBe(0);

      const ancient = await designChoices('China', 'Ancient');
      const classical = await designChoices('China', 'Classical Era');
      expect(ancient.byId.shang).toBeGreaterThan(ancient.byId['oral-accounts']);
      expect(classical.byId.shang).toBeGreaterThan(0);
      expect(classical.byId.shang).toBeLessThan(ancient.byId.shang);
      const draws = [0, 0.25, 0.5, 0.75, 1 - Number.EPSILON];
      const choices = draws.map(draw => chooseDesign(config, classical.weights, 'shang', () => draw)?.id);
      expect(choices).toEqual(expect.arrayContaining(['shang', 'oral-accounts']));
    });

    it('should keep a masthead rule across turns and branches and replace it on an ideology switch', async () => {
      const design = {
        ...config.designs.find(entry => entry.id === 'wire')!,
        civilizationTitles: null,
        title: 'Controlled Design',
        motto: 'Design Motto',
      };
      const catalogue = editorialConfigSchema.parse({
        ...config,
        defaults: { ...config.defaults, minItems: 1, frontPageItems: 2 },
        designs: [design],
        mastheadRules: [
          { id: 'order-first', title: 'Order first of {{terms.civilization}}',
            pageLabels: { front: 'Order Front' }, when: "self.ideology === 'Order'", weight: { base: 10 } },
          { id: 'order-second', title: 'Order second of {{terms.civilization}}',
            pageLabels: { front: 'Second Front' }, when: "self.ideology === 'Order'", weight: { base: 10 } },
          { id: 'freedom-only', title: 'Freedom of {{terms.civilization}}', motto: 'Freedom motto',
            pageLabels: { front: 'Freedom Front' }, when: "self.ideology === 'Freedom'", weight: { base: 10 } },
        ],
      });
      const titles = {
        'order-first': 'Order first of France',
        'order-second': 'Order second of France',
      };
      const labels = { 'order-first': 'Order Front', 'order-second': 'Second Front' };
      /** Publish one edition with the receiver's recorded ideology at a chosen cutoff and branch. */
      async function publish(ideology: string | null, turn: number, timelineId = 'branch') {
        const evidence = fixture(turn, turn - 5);
        evidence.players[0].values.Era = 'Modern Era';
        evidence.players[0].values.PolicyBranches = ideology === null ? null : { [ideology]: [] };
        const facts = buildNewspaperFacts(
          evidence,
          { playerIdentities: { 0: { name: 'France', major: true } } },
          { ideologies: catalogue.constants.types.ideologies },
        );
        const result = await runEditorialCheck({
          campaignId: 'campaign', timelineId, receiver: { playerId: 0, label: 'France' },
          evidence, facts, speedMultiplier: 1, state: createInitialPublicationState(), config: catalogue,
        });
        if (result.status !== 'published') throw new Error(result.reason);
        return result;
      }
      const order = await publish('Order', 10);
      const later = await publish('Order', 20, 'other-branch');
      expect(order.decision.mastheadRuleId).toBeDefined();
      expect(later.decision.mastheadRuleId).toBe(order.decision.mastheadRuleId);
      expect(later.issue.publication.title).toBe(order.issue.publication.title);
      const ruleId = order.decision.mastheadRuleId as keyof typeof titles;
      expect(order.issue.publication.title).toBe(titles[ruleId]);
      expect(order.issue.publication.motto).toBeUndefined();
      expect(order.issue.pages[0].label).toBe(labels[ruleId]);
      expect(order.issue.items[0].sourceNote).toEqual([
        { type: 'text', text: `From the editors of ${titles[ruleId]}` },
      ]);
      expect(order.decision.evidence).toContainEqual(snapshot(0, 10, {}).source);

      const freedom = await publish('Freedom', 10);
      expect(freedom.decision.mastheadRuleId).toBe('freedom-only');
      expect(freedom.issue.publication).toMatchObject({ title: 'Freedom of France', motto: 'Freedom motto' });
      expect(freedom.issue.pages[0].label).toBe('Freedom Front');

      const none = await publish(null, 10);
      expect(none.decision.mastheadRuleId).toBeUndefined();
      expect(none.issue.publication).toMatchObject({ title: 'Controlled Design', motto: 'Design Motto' });
    });

  });

  describe('style preferences', () => {
    it('should raise both stances named in a match list and leave another unchanged', async () => {
      const catalogue = styleCatalogue(
        [{ id: 'listed', match: { stance: ['neutral', 'pro-government'] }, when: 'true', multiplier: 2 }],
        [
          { id: 'neutral', stance: 'neutral', genre: 'letter' },
          { id: 'supportive', stance: 'pro-government', genre: 'letter' },
          { id: 'critical', stance: 'government-critical', genre: 'letter' },
        ],
      );
      const { selected } = await applyRules(catalogue, [
        styleCandidate('story', catalogue.templates[0].variants),
      ]);
      expect(selected[0].variantWeights).toEqual({ neutral: 2, supportive: 2, critical: 1 });
    });

    it('should read the short and importance facts of each selected story', async () => {
      const catalogue = styleCatalogue([
        { id: 'short', match: { genre: 'letter' }, when: 'story.short', multiplier: 2 },
        { id: 'important', match: { genre: 'letter' }, when: 'story.importance > 60', multiplier: 3 },
      ]);
      const variants = catalogue.templates[0].variants;
      const { selected } = await applyRules(catalogue, [
        styleCandidate('short', variants, { short: true, importance: 10 }),
        styleCandidate('important', variants, { importance: 70 }),
        styleCandidate('ordinary', variants, { importance: 10 }),
      ]);
      expect(selected.map(candidate => candidate.variantWeights.letter)).toEqual([2, 3, 1]);
    });

    it('should read story tags in a preference condition', async () => {
      const catalogue = styleCatalogue([
        { id: 'military', match: { genre: 'letter' }, when: "story.tags.includes('military')", multiplier: 4 },
      ]);
      const variants = catalogue.templates[0].variants;
      const { selected } = await applyRules(catalogue, [
        styleCandidate('military', variants, { tags: ['military'] }),
        styleCandidate('economy', variants, { tags: ['economy'] }),
      ]);
      expect(selected.map(candidate => candidate.variantWeights.letter)).toEqual([4, 1]);
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
