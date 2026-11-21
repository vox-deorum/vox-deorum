import { beforeAll, describe, expect, it } from 'vitest';
import { getEditorialExpressions, loadEditorialConfig } from '../../../../../src/newspaper/editorial/config/load.js';
import { evaluateEditorialTerms } from '../../../../../src/newspaper/editorial/check.js';
import { buildNewspaperFacts } from '../../../../../src/newspaper/editorial/facts/index.js';
import { evaluatePresentation } from '../../../../../src/newspaper/editorial/presentation/eligibility.js';
import { selectMastheadRule } from '../../../../../src/newspaper/editorial/presentation/masthead-rules.js';
import { resolveMasthead } from '../../../../../src/newspaper/editorial/presentation/masthead.js';

/** Give the editor the recorded era, policy branches, and civilization of one receiver. */
function receiverFacts(era: string | null | undefined, name?: string, policies: Record<string, string[]> = {}) {
  return buildNewspaperFacts({
    request: { receiverPlayerID: 0, previousCheckTurn: 5, cutoffTurn: 10 },
    players: [{
      subjectID: 0,
      source: { table: 'PlayerSummaries', id: 1, turn: 10, createdAt: 100 },
      values: { ...(era === undefined ? {} : { Era: era }), PolicyBranches: policies },
    }],
    cities: [], comparisons: { players: [], cities: [] }, events: [],
  }, { playerIdentities: { 0: { name, major: true } } }, { ideologies: ['Order', 'Freedom', 'Autocracy'] });
}

describe('stock newspaper designs', () => {
  let config: Awaited<ReturnType<typeof loadEditorialConfig>>;
  let compiled: Awaited<ReturnType<typeof getEditorialExpressions>>;
  beforeAll(async () => {
    config = await loadEditorialConfig();
    compiled = await getEditorialExpressions(config);
  });

  it.each(['Ancient', 'Classical', 'Medieval', 'Renaissance', 'Industrial', 'Modern', 'Atomic', 'Information', 'Future', 'Unknown', null, undefined])(
    'should print for a receiver without a recorded civilization in era %s', async era => {
      const batch = { facts: receiverFacts(era) };
      const weights = await evaluatePresentation(config, compiled, batch);
      const terms = await evaluateEditorialTerms(compiled, batch);
      expect(config.designs.some(design => (weights.get(design) ?? 0) > 0 && resolveMasthead(design, terms))).toBe(true);
    },
  );

  it.each([
    { era: 'Medieval', policies: { Fealty: ['Fiefdoms'] } },
    { era: 'Atomic', policies: { Industry: [], Order: ['Five-Year Plan'] } },
  ])('should give the competitive $era formats distinct mastheads', async ({ era, policies }) => {
    const batch = { facts: receiverFacts(era, 'The Netherlands', policies as Record<string, string[]>) };
    const weights = await evaluatePresentation(config, compiled, batch);
    const terms = await evaluateEditorialTerms(compiled, batch);
    const strongest = Math.max(...config.designs.map(design => weights.get(design) ?? 0));
    expect(strongest).toBeGreaterThan(0);
    const competitive = config.designs.filter(design => (weights.get(design) ?? 0) >= strongest / 2);
    expect(competitive.length).toBeGreaterThan(1);
    const names: string[] = [];
    let themed = 0;
    for (const design of competitive) {
      const choice = await selectMastheadRule({
        campaignId: 'recording', receiverPlayerId: 0, design, rules: config.mastheadRules!, compiled, batch, terms,
      });
      if (choice) themed++;
      const title = (choice ?? resolveMasthead(design, terms))?.title;
      expect(title).toBeTruthy();
      names.push(title!);
    }
    expect(themed).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(competitive.length);
  });
});
