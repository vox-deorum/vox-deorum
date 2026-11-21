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
import { publishedFingerprints, selectHeuristic } from '../../../../src/newspaper/editorial/selection/heuristic.js';
import { mergeSelectedStories } from '../../../../src/newspaper/editorial/selection/merge.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { buildPress } from '../../../../src/newspaper/editorial/rules/press.js';
import { ruleSubjectKey } from '../../../../src/newspaper/editorial/rules/subjects.js';
import { choosePressRunDesign } from '../../../../src/newspaper/editorial/presentation/issue.js';
import { evaluatePresentation, fittingFrontLayouts, prepareFrontLayouts } from '../../../../src/newspaper/editorial/presentation/eligibility.js';
import { createProseDraw } from '../../../../src/newspaper/editorial/shared/determinism.js';

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

/** Supply independent, lower-ranked briefs when testing the publication of a particular story. */
function withBriefs(catalogue: EditorialConfig, count: number): EditorialConfig {
  const briefs = Array.from({ length: count }, (_, index) => `fixture-brief-${index}`);
  return editorialConfigSchema.parse({
    ...catalogue,
    triggers: [...briefs.map(id => ({ id, subject: 'world', tier: 'filler', when: 'true', adjust: '-29', repeat: 1 })), ...catalogue.triggers],
    templates: [...catalogue.templates, ...briefs.map(id => ({
      id, triggers: [id], tags: [], weight: { base: 1 },
      variants: [{ id, headline: 'A brief update', body: ['A background report.'], weight: { base: 1 } }],
    }))],
  });
}

/** Run the real editor on a single fact model. */
function check(evidence: NewspaperEvidence, state = createInitialPublicationState(), catalogue = config,
  timelineId = 'branch', campaignId = 'campaign', briefs = 3) {
  return runEditorialCheck({ campaignId, timelineId, receiver: { playerId: 0, label: 'France' },
    evidence, facts: buildNewspaperFacts(evidence), speedMultiplier: 1, state,
    config: briefs ? withBriefs(catalogue, briefs) : catalogue });
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
  return { id, definitionId, subject, period: { from: 5, to: 10 }, seriesKeys: [id], tier: 'routine', importance, urgent: false,
    tags: [definitionId], values: { amount: 20, $balance: 20 }, sources: [snapshot(0, 10, {}).source], fingerprint: id };
}

/** Build a selected candidate with explicit style variants for preference tests. */
function styleCandidate(
  id: string, variants: EditorialCandidate['variants'],
  facts: Partial<Pick<EditorialCandidate, 'importance' | 'tier' | 'urgent' | 'short' | 'tags'>> = {},
): EditorialCandidate {
  return {
    id, subject: `player/${id}`, period: { from: 5, to: 10 }, triggerIds: [], ruleIds: [], templateIds: [],
    seriesKeys: [], tier: facts.tier ?? 'routine', tags: facts.tags ?? [], importance: facts.importance ?? 50, urgent: facts.urgent ?? false,
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
      triggers: [
        { id: 'ledger', subject: 'player', tier: 'notable', when: ['player.self', 'player.gold > 0'], values: { $balance: 'player.gold' }, adjust: '10', urgent: '$balance >= 100' },
        { id: 'culture', subject: 'player', tier: 'routine', adjust: '5', when: ['!player.self', 'player.culturePerTurn > 0'], values: { amount: 'player.culturePerTurn' } },
        { id: 'balance', subject: 'player', tier: 'notable', when: ['player.self', 'player.gold > 10'], values: { amount: 'player.gold - 10' }, adjust: '5' },
      ],
      templates: [
        { id: 'ledger', triggers: ['ledger'], tags: ['economy'], weight: { base: 1 }, variants: [{ id: 'ledger', headline: 'Treasury: {{$balance}}', body: ['The account stood at {{$balance}} gold.'], weight: { base: 1 } }] },
        { id: 'culture', triggers: ['culture'], tags: ['culture'], short: true, weight: { base: 1 }, variants: [{ id: 'culture', headline: 'New work', body: ['Cultural output reached {{amount}}.'], weight: { base: 1 } }] },
      ],
    });
  });

  describe('authored selection and history', () => {
    it('should give one merged story credit for its displayed originals and preserve their history', async () => {
      const catalogue = editorialConfigSchema.parse({
        ...config,
        templates: [...config.templates, {
          id: 'roundup', triggers: ['balance'], tags: ['roundup'], weight: { base: 1 }, variants: [],
          merge: {
            match: "lead.subject.kind === member.subject.kind && (member.templateIds.includes('ledger') || member.templateIds.includes('culture'))",
            min: 2,
            values: {
              missing: 'self.happinessPercentage',
              total: 'merge.members.reduce((sum, member) => sum + (member.$balance ?? member.amount), 0)',
            },
            variants: [{
              id: 'combined', when: 'merge.count === 2 && merge.values.total > 0',
              headline: 'Roundup: {{merge.values.total}}', body: ['Reports combined.'], weight: { base: 1 },
            }],
          },
        }],
      });
      const result = await check(fixture(), undefined, catalogue, 'branch', 'campaign', 4);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      expect(result.issue.items).toHaveLength(5);
      expect(result.issue.items[0].headline).toContainEqual({ type: 'text', text: '32' });
      const item = result.state.issues[0].items.find(item => item.coveredFingerprints)!;
      expect(item.ruleIds).toEqual(expect.arrayContaining(['balance', 'ledger', 'culture']));
      expect(item.sources.map(source => source.id)).toEqual(expect.arrayContaining([1000, 1001]));
      const fingerprints = publicationStateSchema.parse(result.state).issues[0].items[0].coveredFingerprints!;
      expect(fingerprints).toHaveLength(3);
      const scores = editorialDecisionRecordSchema.parse(result.decision).candidateScores;
      const displayed = scores.find(score => score.selected && score.id.startsWith('merge/'))!;
      const replaced = scores.filter(score => score.mergedInto === displayed.id);
      expect(replaced).toHaveLength(2);
      expect(displayed.score).toBe(Math.max(...replaced.map(score => score.score)));
      const press = buildPress(publicationStateSchema.parse(result.state));
      expect(press.subjects[ruleSubjectKey('culture', 'player/1')]).toEqual({ turn: 10, count: 1 });
      expect(press.subjects[ruleSubjectKey('culture', 'player/0')]).toBeUndefined();

      const compiled = await getEditorialExpressions(catalogue);
      const batch = { facts: buildNewspaperFacts(fixture()) };
      /** Restore the recorded fingerprint for a development this edition already covered. */
      const priorDevelopment = (entry: RuleDevelopment) =>
        ({ ...entry, fingerprint: fingerprints.find(id => id.startsWith(`["${entry.definitionId}"`))! });
      const originals = await matchTemplates([
        development('ledger', 'player/0'), development('culture', 'player/1'),
      ].map(priorDevelopment), catalogue, compiled, batch);
      const feedback = computeFeedback(result.state, catalogue);
      expect(selectHeuristic(originals, result.state, catalogue, feedback).selected).toEqual([]);

      const newCandidates = await matchTemplates([
        development('ledger', 'player/0'), development('culture', 'player/1'),
        priorDevelopment(development('balance', 'player/0')),
      ], catalogue, compiled, batch);
      const { selected } = selectHeuristic(newCandidates, result.state, catalogue, feedback);
      expect(selected).toHaveLength(2);
      expect(await mergeSelectedStories(selected, newCandidates, catalogue, compiled, batch,
        { interruptedSlots: new Set() }, publishedFingerprints(result.state), () => true)).toEqual(selected);
    });

    it('should leave a competing original the only story credited to its series', async () => {
      const catalogue = editorialConfigSchema.parse({
        ...config,
        templates: [...config.templates, {
          id: 'roundup', triggers: ['balance'], tags: ['economy'], weight: { base: 1 }, variants: [],
          merge: {
            match: "member.templateIds.includes('ledger') || member.templateIds.includes('culture')",
            min: 2,
            variants: [{ id: 'combined', headline: 'Roundup', body: ['Combined reports.'], weight: { base: 1 } }],
          },
        }, {
          id: 'balance-report', triggers: ['balance'], tags: ['economy'], weight: { base: 1 },
          variants: [{ id: 'balance', headline: 'Balance', body: ['Independent report.'], weight: { base: 1 } }],
        }],
      });
      const result = await check(fixture(), undefined, catalogue, 'branch', 'campaign', 4);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const records = result.state.issues[0].items;
      expect(records).toHaveLength(5);
      const merged = records.find(record => record.coveredFingerprints)!;
      const [balanceSeries] = records.find(record => record.templateIds.includes('balance-report'))!.seriesKeys;
      expect(merged.ruleIds).toContain('balance');
      expect(merged.seriesKeys).not.toContain(balanceSeries);
    });

    it('should retain ordinary stories if merged prose cannot print and keep the reporting window open on a shortfall', async () => {
      const catalogue = editorialConfigSchema.parse({
        ...config,
        templates: [...config.templates, {
          id: 'roundup', triggers: ['balance'], tags: ['roundup'], weight: { base: 1 }, variants: [],
          merge: {
            match: 'true', min: 2, variants: [{
              id: 'combined', headline: '{{merge.values.missing}}', body: ['Reports combined.'], weight: { base: 1 },
            }],
          },
        }],
      });
      const ready = await check(fixture(), undefined, catalogue);
      expect(ready.status).toBe('published');
      if (ready.status !== 'published') return;
      expect(ready.issue.items).toHaveLength(5);
      expect(ready.decision.candidateScores.filter(score => score.selected)).toHaveLength(5);
      expect(ready.decision.candidateScores.every(score => !score.mergedInto)).toBe(true);
      const lacking = await check(fixture(10, 5, 0), undefined, catalogue);
      expect(lacking.status).toBe('skipped');
      expect(lacking.decision.reason).toMatch(/\b4\b.*\b5\b/);
      expect(lacking.state.reportingThroughTurn).toBeNull();
    });

    it('should let a higher priority selected lead absorb only the original reports it matches', async () => {
      const lead = config.templates[0];
      const catalogue = editorialConfigSchema.parse({
        ...config,
        templates: [
          {
            id: 'lower', triggers: ['balance'], tags: ['roundup'], weight: { base: 1 }, variants: [],
            merge: {
              match: 'true', min: 2,
              variants: [{ id: 'lower', headline: 'Other roundup', body: ['Reports combined.'], weight: { base: 1 } }],
            },
          },
          {
            ...lead,
            merge: {
              priority: 10, match: "member.templateIds.includes('culture')", min: 1,
              values: { amount: 'merge.members[0].amount' },
              variants: [{
                id: 'higher', when: 'merge.count === 1',
                headline: 'Treasury and culture', body: ['{{merge.values.amount}}'], weight: { base: 1 },
              }],
            },
          },
          config.templates[1],
        ],
      });
      const result = await check(fixture(10, 5, 100), undefined, catalogue, 'branch', 'campaign', 4);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      expect(result.issue.items).toHaveLength(5);
      expect(result.issue.pages[0].layout).toBe('breaking');
      expect(result.issue.items[0].body).toEqual([[{ type: 'text', text: '12' }]]);
      const [record] = result.state.issues[0].items;
      expect(record.templateIds).toEqual(['ledger', 'culture']);
      expect(record.coveredFingerprints).toHaveLength(2);
    });

    it('should leave an oversized merge available to a lower-priority merge that keeps a full front', async () => {
      const catalogue = editorialConfigSchema.parse({
        ...config,
        templates: [
          {
            ...config.templates[0],
            merge: {
              match: "member.templateIds.includes('culture')", min: 1,
              variants: [{ id: 'two-reports', headline: 'Two reports', body: ['Combined coverage.'], weight: { base: 1 } }],
            },
          },
          config.templates[1],
          {
            id: 'broad-roundup', triggers: ['balance'], tags: [], weight: { base: 1 }, variants: [],
            merge: {
              priority: 10, min: 3,
              match: "member.templateIds.some(id => ['culture', 'fixture-brief-0', 'fixture-brief-1'].includes(id))",
              variants: [{ id: 'too-many', headline: 'Three reports', body: ['Combined coverage.'], weight: { base: 1 } }],
            },
          },
        ],
      });
      const result = await check(fixture(), undefined, catalogue, 'branch', 'campaign', 4);
      if (result.status !== 'published') throw new Error(result.reason);
      expect(result.issue.pages[0].itemIds).toHaveLength(5);
      expect(Object.values(result.decision.selectedVariants)).toContain('two-reports');
      expect(Object.values(result.decision.selectedVariants)).not.toContain('too-many');
      expect(result.state.issues[0].items.filter(item => item.coveredFingerprints).map(item => item.templateIds))
        .toEqual([['ledger', 'culture']]);
    });

    it('should admit an urgent merge anchor only when a breaking front fits', async () => {
      const wire = config.designs.find(design => design.id === 'wire')!;
      const catalogue = editorialConfigSchema.parse({
        ...config,
        mastheadRules: [],
        designs: [{
          ...wire, when: undefined, weight: { base: 1 },
          layouts: wire.layouts.map(layout => layout.variant === 'breaking' ? { ...layout, frontSlots: 5 } : layout),
        }],
        triggers: config.triggers.map(trigger => trigger.id === 'balance' ? { ...trigger, urgent: 'true' } : trigger),
        templates: [...config.templates, {
          id: 'urgent-roundup', triggers: ['balance'], tags: [], weight: { base: 1 }, variants: [],
          merge: {
            match: "member.templateIds.includes('culture')", min: 1,
            variants: [{ id: 'urgent-roundup', headline: 'Urgent roundup', body: ['Combined coverage.'], weight: { base: 1 } }],
          },
        }],
      });
      const regular = await check(fixture(), undefined, catalogue, 'branch', 'campaign', 2);
      if (regular.status !== 'published') throw new Error(regular.reason);
      expect(regular.issue.pages[0].layout).not.toBe('breaking');
      expect(regular.issue.pages[0].itemIds).toHaveLength(4);
      expect(Object.values(regular.decision.selectedVariants)).toContain('culture');
      expect(Object.values(regular.decision.selectedVariants)).not.toContain('urgent-roundup');

      const breaking = await check(fixture(), undefined, catalogue, 'branch', 'campaign', 3);
      if (breaking.status !== 'published') throw new Error(breaking.reason);
      expect(breaking.issue.pages[0].layout).toBe('breaking');
      expect(breaking.issue.pages[0].itemIds).toHaveLength(5);
      expect(breaking.decision.selectedVariants[breaking.issue.pages[0].itemIds[0]]).toBe('urgent-roundup');
    });

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
        triggers: [{ id: 'settlers', subject: 'city', tier: 'notable', when: 'city.own', adjust: '10' }],
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
          const draw = createProseDraw(`${id}/receiver/0/10`, withBriefs(tagged, 4))();
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
        const result = await check(evidence, createInitialPublicationState(), catalogue, 'branch', campaign, 4);
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
      const result = await check(evidence, createInitialPublicationState(), revised, 'branch', 'campaign', 4);
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
          { id: 'roundup', subject: 'player', tier: 'filler', when: 'press.issues === 1 && printed("ledger") === null',
            group: { by: '"news"' }, adjust: 'press.lastIssueTurn + count + 20' },
          { id: 'unused', subject: 'world', tier: 'filler', when: 'true' },
        ],
        templates: [
          config.templates[0],
          { id: 'roundup', triggers: ['roundup'], tags: [], weight: { base: 1 },
            variants: [{ id: 'roundup', headline: 'The roundup',
              body: ['Coverage of {{count}} players.'], weight: { base: 1 } }] },
        ],
      });
      const legacy = createInitialPublicationState();
      legacy.issues.push({ issueId: 'old', turn: 1, designId: 'wire', items: [historyItem('old-article', [])] });
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
        triggers: [{ id: 'follow-up', subject: 'player', tier: 'routine', when: ['player.self', 'player.is.hasPrinted'] }],
        constants: { ...config.constants, shortcuts: { ...config.constants.shortcuts,
          player: { ...config.constants.shortcuts.player, hasPrinted: memory } } },
        templates: [{ id: 'follow-up', triggers: ['follow-up'], tags: [], weight: { base: 1 },
          when: `${memory} && printed("ledger", subject)?.turn === 10 && printed("ledger", "player/0") === null`,
          variants: [{ id: 'follow-up', when: memory, headline: 'A second report',
            body: ['More news.'], weight: { base: 1 } }] }],
        designs: config.designs.map(design => ({ ...design, when: memory })),
      });
      const restored = publicationStateSchema.parse(JSON.parse(JSON.stringify(first.state)));
      const second = await check(fixture(15, 10), restored, secondCatalogue, 'branch', 'campaign', 4);
      if (second.status !== 'published') throw new Error(second.reason);
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
      const result = await check(fixture(), createInitialPublicationState(), revised, 'branch', 'campaign', 4);
      expect(result.status).toBe('published');
      if (result.status !== 'published') throw new Error('Expected unrelated coverage to publish.');
      expect(result.state.issues[0].items.flatMap(item => item.templateIds).filter(id => !id.startsWith('fixture-brief-'))).toEqual(['culture']);
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
      const stockResult = await check(evidence, createInitialPublicationState(), stock, 'branch', 'campaign', 4);
      expect(stockResult.status).toBe('published');
      if (stockResult.status !== 'published') return;
      expect(stock.templates.find(template => template.id === 'settler-departure-account')?.variants.map(variant => variant.id))
        .toContain(stockResult.decision.selectedVariants[stockResult.issue.items[0].id]);
      expect(stockResult.decision.triggerAudit.find(rule => rule.rule === 'settler-departure')?.subjects)
        .toContainEqual(expect.objectContaining({ subject: 'city/10', outcome: 'fired' }));

      const result = await check(evidence, createInitialPublicationState(), revised, 'branch', 'campaign', 4);
      expect(result.status).toBe('published');
      if (result.status !== 'published') return;
      const [article] = result.issue.items;
      expect(result.decision.selectedVariants[article.id]).toBe('departure');
      expect(article.headline).toContainEqual({ type: 'text', text: 'Tours' });
      expect(article.body[0]).toContainEqual({ type: 'text', text: '2' });
      expect(result.decision.evidence).toEqual(expect.arrayContaining([past.source, city.source, training.source]));
    });

    it('should exclude unauthored and LLM-only templates and reserve space for an independent short item', async () => {
      const parsed = editorialConfigSchema.parse({ ...config, templates: [
        ...config.templates, { ...config.templates[0], id: 'model', mode: 'llmOnly' }, { ...config.templates[0], id: 'missing', variants: [] },
        { ...config.templates[0], id: 'balance', triggers: ['balance'] },
      ] });
      const revised = { ...parsed, defaults: { ...parsed.defaults, maxItems: 2 } };
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
      expect(first.decision.evidence).toEqual(expect.arrayContaining(fixture().players.map(player => player.source)));
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

    it('should keep an unprinted rule eligible and spend the repeat of a printed rule', async () => {
      const withSupport = withBriefs(config, 4);
      const revised: EditorialConfig = {
        ...withSupport,
        triggers: withSupport.triggers.map(rule =>
          rule.id === 'fixture-brief-3' ? { ...rule, repeat: 'once' } : rule),
        templates: [...withSupport.templates, { ...config.templates[0], id: 'balance', triggers: ['balance'],
          variants: [{ ...config.templates[0].variants[0], id: 'surplus', headline: 'Surplus', body: ['{{amount}} remained.'] }] }],
      };
      const result = await check(fixture(), createInitialPublicationState(), revised, 'branch', 'campaign', 0);
      if (result.status !== 'published') throw new Error(result.reason);
      const printed = result.state.issues[0].items;
      expect(printed).toHaveLength(5);
      expect(printed.flatMap(item => item.templateIds)).not.toContain('fixture-brief-3');
      expect(Object.keys(result.state.series).some(key => key.includes('fixture-brief-3'))).toBe(false);
      expect(Object.keys(result.decision.selectedStyles ?? {})).toEqual(printed.map(item => item.id));
      expect(result.state.reportingThroughTurn).toBe(10);
      expect(result.state.triggerRepeats[ruleSubjectKey('fixture-brief-3', 'world')]).toBeUndefined();
      expect(result.state.triggerRepeats[ruleSubjectKey('ledger', 'player/0')]).toEqual({ lastTurn: 10, armed: false });

      const next = await check(fixture(15, 10), result.state, revised, 'branch', 'campaign', 0);
      const nextOutcome = (id: string) => next.decision.triggerAudit.find(entry => entry.rule === id)?.subjects[0]?.outcome;
      expect(nextOutcome('fixture-brief-3')).toBe('fired');
      expect(nextOutcome('ledger')).toBe('repeat');
    });

    it('should preserve issue presentation and the configuration snapshot after later catalogue changes', async () => {
      const revised = withBriefs(config, 3);
      const result = await check(fixture(), createInitialPublicationState(), revised, 'branch', 'campaign', 0);
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
      const later = await check(fixture(20, 10, 35), skipped.state, config, 'branch', 'campaign', 4);
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
      expect(result.issue.pages[0].itemIds).toHaveLength(5);
      expect(result.decision.fallbackReason).toBeTruthy();
    });

    it('should retain the wire design when a published Information Era run reaches the Future Era', async () => {
      const wireOnly = { ...config, mastheadRules: [], designs: config.designs.filter(design => design.id === 'wire') };
      const first = await check(fixture(10, 5, 0, 'Information Era'), createInitialPublicationState(), wireOnly);
      expect(first.status).toBe('published');
      expect(first.state.issues[0].designId).toBe('wire');
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
        id: `runaway-${index}`, subject: 'world' as const, tier: 'filler', when: '(() => { while (true) {} })()',
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
      if (partial.status !== 'published') throw new Error(partial.reason);
      expect(partial.issue.publication.designId).toBe('constant-fallback');
      expect(partial.decision.choiceErrors).toEqual(result.decision.choiceErrors);
      expect(JSON.stringify(partial.issue)).not.toContain('interruption limit');
    });

    it('should keep the reporting window and trigger state open if no breaking front is eligible', async () => {
      const first = await check(fixture(10, 5, 0), undefined, config, 'branch', 'campaign', 4);
      expect(first.status).toBe('published');
      const preserved = structuredClone(first.state);
      const unprintable = editorialConfigSchema.parse({
        ...config,
        designs: config.designs.map(design => ({ ...design, when: 'self.gold < 100' })),
      });
      const evidence = fixture(20, 10, 150);
      const skipped = await check(evidence, first.state, unprintable, 'branch', 'campaign', 4);
      expect(skipped.status).toBe('skipped');
      expect(skipped.decision.designSelection).toMatchObject({ reason: 'no-eligible', candidates: [] });
      expect(skipped.decision.reason).toMatch(/breaking.*\b5\b/);
      expect(skipped.state.reportingThroughTurn).toBe(first.state.reportingThroughTurn);
      expect(skipped.state.triggerRepeats).toEqual(first.state.triggerRepeats);
      expect(first.state).toEqual(preserved);
      const retried = await check(evidence, first.state, config, 'branch', 'campaign', 4);
      expect(retried.status).toBe('published');
      expect(retried.state.lastCheckTurn).toBe(20);
    });

    it('should introduce the social news feed in Information and keep it in Future', async () => {
      for (const era of ['Modern', 'Atomic Era'])
        expect((await designChoices('France', era)).byId.wire).toBe(0);
      for (const era of ['Information Era', 'Future'])
        expect((await designChoices('France', era)).byId.wire).toBeGreaterThan(0);
    });

    it('should favor Heian in Japan while keeping it competitive in Korea and China', async () => {
      for (const [era, general] of [
        ['Classical Era', 'oral-accounts'], ['Medieval', 'town-book'], ['Renaissance Era', 'printer-dispatch'],
      ] as const) {
        const japan = (await designChoices('Japan', era)).byId;
        expect(japan.heian, era).toBeGreaterThan(japan[general]);
        for (const name of ['Korea', 'China']) {
          const { byId } = await designChoices(name, era);
          expect(byId.heian, `${name}, ${era}`).toBeGreaterThanOrEqual(Math.max(...Object.values(byId)) / 2);
          expect(byId.heian, `${name}, ${era}`).toBeLessThan(byId[general]);
        }
      }
      expect((await designChoices('Japan', 'Ancient')).byId.heian).toBe(0);
      expect((await designChoices('Japan', 'Industrial')).byId.heian).toBe(0);
    });

    it('should offer a Nubian edition and keep the notice board competitive with Shang in Classical', async () => {
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
      const state = createInitialPublicationState();
      state.issues = [1, 2, 3].map(turn => ({ issueId: `issue-${turn}`, turn, items: [], designId: 'shang' }));
      const draws = [0, 0.25, 0.5, 0.75, 1 - Number.EPSILON];
      const choices = draws.map(draw => choosePressRunDesign([...fittingFrontLayouts(prepareFrontLayouts(config, classical.weights), 5, false).keys()], classical.weights, state, () => draw).design?.id);
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
        evidence.players[0].values.Era = 'Information Era';
        evidence.players[0].values.PolicyBranches = ideology === null ? null : { [ideology]: [] };
        const facts = buildNewspaperFacts(
          evidence,
          { playerIdentities: { 0: { name: 'France', major: true } } },
          { ideologies: catalogue.constants.types.ideologies },
        );
        const result = await runEditorialCheck({
          campaignId: 'campaign', timelineId, receiver: { playerId: 0, label: 'France' },
          evidence, facts, speedMultiplier: 1, state: createInitialPublicationState(), config: withBriefs(catalogue, 3),
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

    it('should read the short, importance and tier facts of each selected story', async () => {
      const catalogue = styleCatalogue([
        { id: 'short', match: { genre: 'letter' }, when: 'story.short', multiplier: 2 },
        { id: 'important', match: { genre: 'letter' }, when: 'story.importance > 60', multiplier: 3 },
        { id: 'crisis', match: { genre: 'letter' }, when: "story.tier === 'crisis'", multiplier: 5 },
      ]);
      const variants = catalogue.templates[0].variants;
      const { selected } = await applyRules(catalogue, [
        styleCandidate('short', variants, { short: true, importance: 10 }),
        styleCandidate('important', variants, { importance: 70, tier: 'crisis' }),
        styleCandidate('ordinary', variants, { importance: 10 }),
      ]);
      expect(selected.map(candidate => candidate.variantWeights.letter)).toEqual([2, 15, 1]);
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
      state.issues = [{ issueId: 'old', turn: 1, designId: 'wire',
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
      state.issues = [{ issueId: 'old', turn: 1, designId: 'wire', items: [historyItem('a', ['trade', 'economy']), historyItem('a', ['trade', 'economy'])] }];
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
      state.issues = [{ issueId: 'old', turn: 1, designId: 'wire', items: [historyItem('a', ['common', 'rare']),
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
