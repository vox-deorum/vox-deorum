/** Choose an authored masthead alternative for the selected visual design. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { CompiledEditorialExpressions, EditorialTerms } from '../config/expressions.js';
import type { EditorialDesign, EditorialMastheadRule } from '../config/schema.js';
import { stableDraw } from '../shared/determinism.js';
import { evaluateChoices, type ChoiceExpressions } from '../shared/eligibility.js';
import type { ExpressionBatch, ExpressionCheckBudget } from '../shared/expressions.js';
import { uniqueSources } from '../shared/sources.js';
import { resolvePrintableTermText, termTextSources } from './masthead.js';

/** The winning rule together with the printable copy and evidence it printed. */
export interface MastheadRuleSelection {
  rule: EditorialMastheadRule;
  title: string;
  motto?: string;
  sources: NewspaperSourceReference[];
}

export interface MastheadRuleInput {
  campaignId: string;
  receiverPlayerId: number;
  design: EditorialDesign;
  rules: readonly EditorialMastheadRule[];
  compiled: CompiledEditorialExpressions;
  batch: Pick<ExpressionBatch, 'facts' | 'constants'>;
  budget?: ExpressionCheckBudget;
  terms?: EditorialTerms;
}

interface MastheadRuleCandidate {
  rule: EditorialMastheadRule;
  choice: ChoiceExpressions;
  title: string;
  motto?: string;
}

/** Sample the midpoint of a rule's 32-bit bucket so the draw stays strictly inside the unit interval. */
function midpointDraw(
  campaignId: string,
  receiverPlayerId: number,
  designId: string,
  ruleId: string
): number {
  // The hash input names exactly the masthead namespace, campaign, receiver, design and rule.
  const identity = JSON.stringify(['masthead', campaignId, receiverPlayerId]);
  return stableDraw(identity, designId, ruleId) + 0.5 / 0x1_0000_0000;
}

/** Rank a candidate by an exponential race; smaller values win in proportion to weight. */
function weightedRank(draw: number, weight: number): number {
  return Math.log(-Math.log(draw)) - Math.log(weight);
}

/** Compare rule IDs lexically without locale-dependent ordering. */
function compareRuleIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Select one eligible authored masthead rule for the design already chosen by the editor.
 * Rules for other designs, rules with unprintable copy and rules whose choice does not stay
 * positive are excluded. Ties break on the rule ID so the result is stable without shared draws.
 */
export async function selectMastheadRule(
  input: MastheadRuleInput
): Promise<MastheadRuleSelection | undefined> {
  const terms = input.terms ?? new Map();
  const candidates = input.rules.flatMap((rule): MastheadRuleCandidate[] => {
    if (rule.designs !== undefined && !rule.designs.includes(input.design.id)) return [];
    const title = resolvePrintableTermText(rule.title, terms);
    if (title === undefined) return [];
    const motto = rule.motto === undefined ? undefined : resolvePrintableTermText(rule.motto, terms);
    if (rule.motto !== undefined && motto === undefined) return [];
    const choice = input.compiled.mastheadRules.get(rule.id);
    if (!choice) return [];
    return [{ rule, choice, title, ...(motto === undefined ? {} : { motto }) }];
  });
  if (!candidates.length) return undefined;
  const weights = await evaluateChoices(
    input.compiled.runner,
    input.batch,
    candidates.map(({ choice }) => ({ choice })),
    input.budget
  );
  const winner = candidates
    .flatMap((candidate, index) => {
      const weight = weights[index];
      if (weight.weight <= 0) return [];
      return [{
        candidate,
        sources: weight.sources,
        rank: weightedRank(
          midpointDraw(input.campaignId, input.receiverPlayerId, input.design.id, candidate.rule.id),
          weight.weight
        ),
      }];
    })
    .sort((left, right) =>
      left.rank - right.rank || compareRuleIds(left.candidate.rule.id, right.candidate.rule.id)
    )[0];
  if (!winner) return undefined;
  return {
    rule: winner.candidate.rule,
    title: winner.candidate.title,
    ...(winner.candidate.motto === undefined ? {} : { motto: winner.candidate.motto }),
    sources: uniqueSources([
      ...winner.sources,
      ...termTextSources(winner.candidate.rule.title, terms),
      ...(winner.candidate.rule.motto === undefined ? [] : termTextSources(winner.candidate.rule.motto, terms)),
    ]),
  };
}
