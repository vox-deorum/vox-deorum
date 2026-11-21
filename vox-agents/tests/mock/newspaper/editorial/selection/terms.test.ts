/** Check printable term evaluation, placeholder merging and per-variant evidence. */
import { describe, expect, it } from 'vitest';
import type { NewspaperEvidence } from '../../../../../../mcp-server/dist/newspaper/evidence.js';
import { createInitialPublicationState } from '../../../../../src/newspaper/contracts/publication.js';
import { evaluateEditorialTerms, runEditorialCheck } from '../../../../../src/newspaper/editorial/check.js';
import { scaleEditorialConstants } from '../../../../../src/newspaper/editorial/config/constants.js';
import { prepareEditorialExpressions } from '../../../../../src/newspaper/editorial/config/expressions.js';
import { loadEditorialConfig, parseEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { evaluateTriggerRules } from '../../../../../src/newspaper/editorial/rules/evaluate.js';
import { matchTemplates } from '../../../../../src/newspaper/editorial/selection/templates.js';

/** Build a catalogue whose terms and variants exercise every printable result. */
async function catalogue() {
  const base = await loadEditorialConfig();
  return parseEditorialConfig({
    ...base,
    constants: {
      ...base.constants,
      terms: {
        ...base.constants.terms,
        ruler: "self.ideology == 'Order' ? 'the Party' : 'the Crown'",
        capital: 'self.capital.name',
        zero: '0',
        missing: 'undefined',
        flag: 'true',
        empty: "''",
        broken: 'unboundTermName',
        hidden: 'self.notARecordedFact',
      },
    },
    triggers: [{ id: 'report', subject: 'world', when: 'true' }],
    templates: [{
      id: 'report', triggers: ['report'], tags: [], weight: { base: 1 },
      variants: [
        {
          id: 'printed', headline: '{{terms.ruler}} rules',
          body: ['The {{terms.civilizationAdjective}} capital of {{terms.capital}} reports {{terms.zero}} voices.'],
          links: [{ placeholder: 'terms.capital', label: 'Visit {{terms.capital}}', target: { type: 'screen', screen: 'map' } }],
          weight: { base: 1 },
        },
        { id: 'plain', headline: 'Plain report', body: ['No terms here.'], weight: { base: 1 } },
        {
          id: 'emptyLink', headline: 'Empty link', body: ['Nothing to read.'],
          links: [{ placeholder: 'terms.empty', label: '{{terms.empty}}', target: { type: 'screen', screen: 'map' } }],
          weight: { base: 1 },
        },
        { id: 'missing', headline: '{{terms.missing}}', body: ['Hidden.'], weight: { base: 1 } },
      ],
    }],
  });
}

describe('printable terms', () => {
  it('should evaluate usable terms once and merge them only into variants that print them', async () => {
    const config = await catalogue();
    const citySource = { table: 'CityInformations' as const, id: 201, turn: 10, createdAt: 10_000 };
    const owner = {
      subjectID: 0,
      source: { table: 'PlayerSummaries' as const, id: 2, turn: 10, createdAt: 10 },
      values: { PolicyBranches: { Order: [] } },
    };
    const city = { subjectID: 11, source: citySource, values: { OwnerID: 0, Name: 'Paris', IsCapital: 1 } };
    const evidence: NewspaperEvidence = {
      request: { receiverPlayerID: 0, cutoffTurn: 10, previousCheckTurn: 8, historyFromTurn: 5 },
      players: [owner], cities: [city], events: [], comparisons: { players: [], cities: [] },
      history: {
        fromTurn: 5, baseline: { players: [], cities: [] },
        snapshots: { players: [owner], cities: [city] }, events: [], gaps: [],
      },
    };
    const facts = buildNewspaperFacts(
      evidence,
      { playerIdentities: { 0: { name: 'France', leader: 'Napoleon', major: true } } },
      { ideologies: config.constants.types.ideologies },
    );
    const compiled = await prepareEditorialExpressions(config);
    const batch = { facts, constants: scaleEditorialConstants(config.constants, 1) };
    const terms = await evaluateEditorialTerms(compiled, batch);

    expect(terms.get('civilization')).toEqual({ value: 'France', sources: [owner.source] });
    expect(terms.get('leader')).toEqual({ value: 'Napoleon', sources: [owner.source] });
    expect(terms.get('civilizationAdjective')).toEqual({ value: 'French', sources: [owner.source] });
    expect(terms.get('ruler')?.value).toBe('the Party');
    expect(terms.get('capital')?.value).toBe('Paris');
    expect(terms.get('capital')?.sources).toEqual(expect.arrayContaining([citySource]));
    expect(terms.get('zero')?.value).toBe(0);
    expect(terms.get('empty')?.value).toBe('');
    expect(terms.has('missing')).toBe(false);
    expect(terms.has('flag')).toBe(false);
    expect(terms.has('broken')).toBe(false);
    expect(terms.has('hidden')).toBe(false);

    const rules = await evaluateTriggerRules({
      rules: config.triggers, compiled, facts, constants: config.constants, speedMultiplier: 1,
    });
    const candidates = await matchTemplates(
      rules.developments, config, compiled, batch, undefined, terms
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].values).toMatchObject({
      'terms.civilizationAdjective': 'French',
      'terms.ruler': 'the Party', 'terms.capital': 'Paris', 'terms.zero': 0,
    });
    // The empty-link variant is omitted because resolved link text must be nonempty.
    expect(candidates[0].variants.map((variant) => variant.id)).toEqual(['printed', 'plain']);
    expect(candidates[0].variantSources.printed).toEqual(expect.arrayContaining([citySource]));
    expect(candidates[0].variantSources.plain).toEqual([]);

    // Term failures reach the decision, while a hidden fact read stays unreported.
    const checked = await runEditorialCheck({
      campaignId: 'campaign', timelineId: 'timeline', receiver: { playerId: 0, label: 'France' },
      evidence, facts, speedMultiplier: 1, state: createInitialPublicationState(),
      config: { ...config, templates: [] },
    });
    expect(checked.decision.choiceErrors).toEqual([
      expect.objectContaining({ message: expect.stringContaining('unboundTermName') }),
    ]);
  });
});
