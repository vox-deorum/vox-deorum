/** Check masthead rule competition, design filtering, copy substitution and page labels. */
import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import {
  prepareEditorialExpressions,
  type EditorialTerms,
} from '../../../../../src/newspaper/editorial/config/expressions.js';
import { editorialConfigSchema, editorialConfigVersion, type EditorialConfig } from '../../../../../src/newspaper/editorial/config/schema.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { evaluatePresentation } from '../../../../../src/newspaper/editorial/presentation/eligibility.js';
import { presentIssue } from '../../../../../src/newspaper/editorial/presentation/issue.js';
import {
  selectMastheadRule,
  type MastheadRuleSelection,
} from '../../../../../src/newspaper/editorial/presentation/masthead-rules.js';
import type { EditorialCandidate } from '../../../../../src/newspaper/editorial/selection/templates.js';
import type { ExpressionCheckBudget } from '../../../../../src/newspaper/editorial/shared/expressions.js';

/** Build a small catalogue with one front page, one section and two designs. */
function createConfig(): EditorialConfig {
  return editorialConfigSchema.parse({
    version: editorialConfigVersion,
    defaults: {
      frequencyStandardTurns: 5, llmEnabled: false, publicationTitle: 'Publication',
      maxItems: 8, importanceMax: 100, decayPerTurn: 0.9,
      seriesWeight: 1, noveltyBonus: 1, varietyBonus: 1,
      feedback: { window: 50, series: 3, tag: 1, bound: 10 },
    },
    constants: { distances: {}, spans: { long: 40 }, sizes: {}, shares: {}, types: {}, shortcuts: {}, stakes: {}, tiers: { filler: 30 } },
    triggers: [{ id: 'coverage', subject: 'world', tier: 'filler', when: 'true', tags: ['economy'] }],
    templates: [{
      id: 'coverage', triggers: ['coverage'], tags: ['economy'], weight: { base: 1 },
      variants: [{ id: 'standard', headline: 'Headline', body: ['Body'], weight: { base: 1 } }],
    }],
    pages: [
      { id: 'front', label: 'Front', tags: [], order: 0, front: true },
      { id: 'desk', label: 'Desk', tags: ['economy'], order: 1 },
      { id: 'unused', label: 'Unused', tags: ['international'], order: 2 },
    ],
    designs: [
      {
        id: 'wire', version: '1', title: 'Design Title', motto: 'Design Motto', weight: { base: 1 },
        presentation: { schemaVersion: 1, rendererFamily: 'feed', tokens: { paperColor: '#ffffff' } },
        layouts: [
          { id: 'ordinary', variant: 'ordinary', weight: { base: 1 } },
          { id: 'breaking', variant: 'breaking', weight: { base: 1 } },
        ],
        pageLabels: { desk: 'Design Desk' },
      },
      {
        id: 'victorian', version: '1', title: 'Other Title', weight: { base: 0 },
        presentation: { schemaVersion: 1, rendererFamily: 'broadsheet', tokens: { paperColor: '#eeeecc' } },
        layouts: [
          { id: 'broadsheet', variant: 'ordinary', weight: { base: 1 } },
          { id: 'war-edition', variant: 'breaking', weight: { base: 1 } },
        ],
      },
    ],
  });
}

/** Add controlled rules to the catalogue without changing the stock fixture shape. */
function withRules(rules: NonNullable<EditorialConfig['mastheadRules']>): EditorialConfig {
  return editorialConfigSchema.parse({ ...createConfig(), mastheadRules: rules });
}

/** Build one prequalified candidate for the presentation boundary. */
function createCandidate(config: EditorialConfig, id: string): EditorialCandidate {
  return {
    id, subject: id, period: { from: 1, to: 5 }, triggerIds: [`trigger/${id}`], ruleIds: ['coverage'],
    templateIds: ['coverage'], seriesKeys: [`series/${id}`], tags: ['economy'], tier: 'filler', importance: 20,
    urgent: false, short: false, weight: 1, variants: config.templates[0].variants,
    variantWeights: { standard: 1 }, variantSources: {}, values: {}, sources: [], fingerprint: id,
  };
}

/** Build permission-filtered facts with one receiver policy branch and identity. */
function factsFor(branches: Record<string, string[]> | null, turn = 10) {
  const source = { table: 'PlayerSummaries' as const, id: turn * 100, turn, createdAt: turn * 1000 };
  const evidence: NewspaperEvidence = {
    request: { receiverPlayerID: 0, previousCheckTurn: turn - 5, cutoffTurn: turn },
    players: [{ subjectID: 0, source, values: { PolicyBranches: branches } }],
    cities: [], comparisons: { players: [], cities: [] }, events: [],
  };
  const facts = buildNewspaperFacts(
    evidence,
    { playerIdentities: { 0: { name: 'France', major: true } } },
    { ideologies: ['Order', 'Freedom', 'Autocracy'] },
  );
  return { facts, source };
}

/** Evaluate the presentation weights for a controlled catalogue. */
async function weightsFor(config: EditorialConfig) {
  return evaluatePresentation(config, await prepareEditorialExpressions(config), {});
}

describe('masthead rule selection', () => {
  it('should keep the same winner for the same campaign and design across turns', async () => {
    const config = withRules([
      { id: 'beta-rule', title: 'Beta of {{terms.civilization}}', when: "self.ideology === 'Order'", weight: { base: 10 } },
      { id: 'alpha-rule', title: 'Alpha of {{terms.civilization}}', when: "self.ideology === 'Order'", weight: { base: 10 } },
    ]);
    const compiled = await prepareEditorialExpressions(config);
    const terms: EditorialTerms = new Map([
      ['civilization', { value: 'France', sources: [] }],
    ]);
    /** Select a masthead for one recorded turn of the same campaign. */
    const select = (turn: number) => selectMastheadRule({
      campaignId: 'campaign', receiverPlayerId: 0, design: config.designs[0],
      rules: config.mastheadRules!, compiled, batch: { facts: factsFor({ Order: [] }, turn).facts, constants: {} },
      terms,
    });
    const first = await select(10);
    const later = await select(20);
    const repeated = await select(10);
    expect(first?.rule.id).toBeDefined();
    expect(later?.rule.id).toBe(first?.rule.id);
    expect(repeated?.rule.id).toBe(first?.rule.id);
    expect(later?.title).toBe(first?.title);
  });

  it('should evaluate only rules for the selected design and require a recorded policy', async () => {
    const config = withRules([
      { id: 'wire-order', title: 'Wire {{terms.civilization}}', designs: ['wire'], when: "self.ideology === 'Order'", weight: { base: 1 } },
      { id: 'victorian-policy', title: 'Policy {{terms.civilization}}', designs: ['victorian'], when: "self.hasPolicy('Five-Year Plan')", weight: { base: 100 } },
      { id: 'victorian-broken', title: 'Broken {{terms.civilization}}', designs: ['victorian'], when: "(() => { throw new Error('should not run'); })()", weight: { base: 100 } },
    ]);
    const compiled = await prepareEditorialExpressions(config);
    const terms: EditorialTerms = new Map([
      ['civilization', { value: 'France', sources: [] }],
    ]);
    const errors = new Map();
    const budget: ExpressionCheckBudget = { interruptedSlots: new Set(), choiceErrors: errors };
    const wire = await selectMastheadRule({
      campaignId: 'campaign', receiverPlayerId: 0, design: config.designs[0],
      rules: config.mastheadRules!, compiled, batch: { facts: factsFor({ Order: [] }).facts, constants: {} },
      budget, terms,
    });
    expect(wire?.rule.id).toBe('wire-order');
    expect(errors.size).toBe(0);

    const unknownPolicy = await selectMastheadRule({
      campaignId: 'campaign', receiverPlayerId: 0, design: config.designs[1],
      rules: config.mastheadRules!, compiled, batch: { facts: factsFor({ Order: [] }).facts, constants: {} },
      budget: { interruptedSlots: new Set() }, terms,
    });
    expect(unknownPolicy).toBeUndefined();

    const knownPolicy = await selectMastheadRule({
      campaignId: 'campaign', receiverPlayerId: 0, design: config.designs[1],
      rules: config.mastheadRules!, compiled,
      batch: { facts: factsFor({ Order: ['Five-Year Plan'] }).facts, constants: {} },
      budget: { interruptedSlots: new Set() }, terms,
    });
    expect(knownPolicy?.rule.id).toBe('victorian-policy');
  });

  it('should leave masthead copy to the legacy design when no rule can print', async () => {
    const config = withRules([
      { id: 'missing-title', title: '{{terms.missing}}', when: 'true', weight: { base: 100 } },
      { id: 'missing-motto', title: 'Printable {{terms.civilization}}', motto: '{{terms.missing}}', when: 'true', weight: { base: 100 } },
      { id: 'zero-weight', title: 'Zero {{terms.civilization}}', when: 'true', weight: { base: 0 } },
      { id: 'false-rule', title: 'False {{terms.civilization}}', when: 'false', weight: { base: 100 } },
    ]);
    const compiled = await prepareEditorialExpressions(config);
    const result = await selectMastheadRule({
      campaignId: 'campaign', receiverPlayerId: 0, design: config.designs[0],
      rules: config.mastheadRules!, compiled, batch: { constants: {} },
      terms: new Map([['civilization', { value: 'France', sources: [] }]]),
    });
    expect(result).toBeUndefined();
  });

  it('should cite the winning condition and printed title and motto terms', async () => {
    const config = withRules([
      { id: 'sourced', title: '{{terms.civilization}} Herald', motto: '{{terms.motto}}', when: "self.ideology === 'Order'", weight: { base: 1 } },
    ]);
    const compiled = await prepareEditorialExpressions(config);
    const { facts, source: conditionSource } = factsFor({ Order: [] });
    const titleSource = { table: 'PlayerSummaries' as const, id: 901, turn: 10, createdAt: 9001 };
    const mottoSource = { table: 'PlayerSummaries' as const, id: 902, turn: 10, createdAt: 9002 };
    const result = await selectMastheadRule({
      campaignId: 'campaign', receiverPlayerId: 0, design: config.designs[0],
      rules: config.mastheadRules!, compiled, batch: { facts, constants: {} },
      terms: new Map([
        ['civilization', { value: 'France', sources: [titleSource] }],
        ['motto', { value: 'Printed motto', sources: [mottoSource] }],
      ]),
    });
    expect(result).toMatchObject({ title: 'France Herald', motto: 'Printed motto' });
    expect(result?.sources).toEqual(expect.arrayContaining([conditionSource, titleSource, mottoSource]));
  });
});

describe('masthead presentation', () => {
  it('should print the winning masthead and use fallbacks for missing page labels', async () => {
    const config = withRules([
      {
        id: 'winner', title: '{{terms.civilization}} Rule', motto: 'Rule Motto',
        pageLabels: { front: '{{terms.frontName}}', desk: '{{terms.deskName}}', unused: '{{terms.unusedName}}' },
        when: 'true', weight: { base: 1 },
      },
    ]);
    config.pages.push({ ...config.pages[1], id: 'constructor', label: 'Page Default', order: 3 });
    const conditionSource = { table: 'PlayerSummaries' as const, id: 801, turn: 10, createdAt: 8001 };
    const titleSource = { table: 'PlayerSummaries' as const, id: 802, turn: 10, createdAt: 8002 };
    const frontSource = { table: 'PlayerSummaries' as const, id: 803, turn: 10, createdAt: 8003 };
    const unusedSource = { table: 'PlayerSummaries' as const, id: 804, turn: 10, createdAt: 8004 };
    const selection: MastheadRuleSelection = {
      rule: config.mastheadRules![0],
      title: 'Rule Title',
      motto: 'Rule Motto',
      sources: [conditionSource, titleSource],
    };
    const result = (await presentIssue({
      checkId: 'check/10',
      issueId: 'issue/10', campaignId: 'campaign', timelineId: 'branch',
      receiver: { playerId: 0, label: 'France' }, turn: 10,
      selected: Array.from({ length: 8 }, (_, index) => createCandidate(config, String(index))),
      state: createInitialPublicationState(), config, weights: await weightsFor(config),
      proseRandom: () => 0,
      terms: new Map([
        ['civilization', { value: 'France', sources: [titleSource] }],
        ['frontName', { value: 'Rule Front', sources: [frontSource] }],
        ['unusedName', { value: 'Unused Label', sources: [unusedSource] }],
      ]),
      selectMasthead: async () => selection,
    }))!;
    expect(result.issue.publication).toMatchObject({ title: 'Rule Title', motto: 'Rule Motto' });
    expect(result.issue.pages.map(page => [page.id, page.label])).toEqual([
      ['front', 'Rule Front'],
      ['desk', 'Design Desk'],
      ['constructor', 'Page Default'],
    ]);
    expect(result.issue.pages.map(page => page.hasLead)).toEqual([false, false, false]);
    expect(result.mastheadRuleId).toBe('winner');
    expect(result.mastheadSources).toEqual([conditionSource, titleSource, frontSource]);
    expect(result.mastheadSources).not.toContainEqual(unusedSource);
    expect(result.issue.items[0].sourceNote).toEqual([
      { type: 'text', text: 'From the editors of Rule Title' },
    ]);
  });

  it('should keep the design title, motto and page labels when no rule wins', async () => {
    const config = createConfig();
    const result = (await presentIssue({
      checkId: 'check/10',
      issueId: 'issue/10', campaignId: 'campaign', timelineId: 'branch',
      receiver: { playerId: 0, label: 'France' }, turn: 10,
      selected: Array.from({ length: 6 }, (_, index) => createCandidate(config, String(index))),
      state: createInitialPublicationState(), config, weights: await weightsFor(config),
      proseRandom: () => 0,
      selectMasthead: async () => undefined,
    }))!;
    expect(result.issue.publication).toMatchObject({ title: 'Design Title', motto: 'Design Motto' });
    expect(result.issue.pages.map(page => [page.id, page.label])).toEqual([
      ['front', 'Front'],
      ['desk', 'Design Desk'],
    ]);
    expect(result.issue.pages.map(page => page.hasLead)).toEqual([false, false]);
    expect(result.mastheadRuleId).toBeUndefined();
    expect(result.mastheadSources).toEqual([]);
  });
});
