/** Apply editorial preferences only after factual eligibility and story selection. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { variantStyleKinds, type VariantStyle } from '../../contracts/style.js';
import type { CompiledEditorialExpressions } from '../config/expressions.js';
import { resolveVariantStyle, styleMatchTags, type StyleMatch } from '../config/styles.js';
import { recordChoiceError } from '../shared/eligibility.js';
import type { ExpressionBatch, ExpressionCheckBudget } from '../shared/expressions.js';
import type { EditorialCandidate } from './templates.js';

/** A preference applies only when every kind it names includes the variant's tag. */
function matchesStyle(match: StyleMatch, style: VariantStyle): boolean {
  return variantStyleKinds.every(kind => {
    const tags = styleMatchTags(match[kind]);
    return tags === undefined || tags.includes(style[kind]);
  });
}

/** Adjust prose weights and keep the applied rules' sources separate from the article's evidence. */
export async function applyStylePreferences(
  selected: EditorialCandidate[],
  compiled: CompiledEditorialExpressions,
  batch: Pick<ExpressionBatch, 'facts' | 'constants'>,
  budget: ExpressionCheckBudget,
): Promise<{ selected: EditorialCandidate[]; sources: Map<string, NewspaperSourceReference[]> }> {
  const sources = new Map<string, NewspaperSourceReference[]>();
  if (!compiled.styleRules.length) return { selected, sources };
  const plans = selected.flatMap((candidate, index) => {
    if (!candidate.variantBindings || candidate.variants.length < 2) return [];
    const variants = candidate.variants.map(variant => ({ id: variant.id, style: resolveVariantStyle(variant) }));
    const rules = compiled.styleRules.filter(rule => {
      if (rule.multiplier === 1) return false;
      const matches = variants.filter(({ style }) => matchesStyle(rule.match, style)).length;
      return matches > 0 && matches < variants.length;
    });
    return rules.length ? [{ candidate, index, rules, variants, bindings: candidate.variantBindings }] : [];
  });
  if (!plans.length) return { selected, sources };

  const groups = plans.map(({ candidate, rules, bindings }) => ({
    windowFromTurn: candidate.period.from,
    expressions: rules.map(rule => rule.slot),
    subjects: [{
      ...bindings,
      story: {
        tier: candidate.tier,
        importance: candidate.importance,
        urgent: candidate.urgent,
        short: candidate.short ?? false,
        tags: [...candidate.tags],
      },
    }],
  }));
  const results = await compiled.runner.evaluate({ ...batch, groups }, budget);
  const adjusted = selected.slice();
  for (const [index, { candidate, index: selectedIndex, rules, variants }] of plans.entries()) {
    const active = rules.flatMap((rule, offset) => {
      const result = results[index][0][offset];
      recordChoiceError(result, rule.slot, budget);
      return 'value' in result && result.value ? [{ rule, sources: result.sources ?? [] }] : [];
    });
    if (!active.length) continue;
    const weights = variants.map(({ id, style }) => [
      id, active.reduce((weight, { rule }) => matchesStyle(rule.match, style) ? weight * rule.multiplier : weight,
        candidate.variantWeights[id]),
    ] as const);
    // Excessive multipliers must not make an eligible variant disappear or invalidate the draw.
    if (weights.some(([, weight]) => weight <= 0) ||
      !Number.isFinite(weights.reduce((total, [, weight]) => total + weight, 0))) continue;
    adjusted[selectedIndex] = { ...candidate, variantWeights: Object.fromEntries(weights) };
    sources.set(candidate.id, active.flatMap(entry => entry.sources));
  }
  return { selected: adjusted, sources };
}
