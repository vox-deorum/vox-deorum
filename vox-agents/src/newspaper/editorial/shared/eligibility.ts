/** Evaluate prepared editorial choices in their own visible fact bindings. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { ExpressionBatch, ExpressionBindings, ExpressionCheckBudget, ExpressionResult, ExpressionRunner } from './expressions.js';
import { uniqueSources } from './sources.js';

export interface ChoiceExpressions {
  readonly when?: number;
  readonly base: number;
  readonly adjustments: readonly { when: number; add: number }[];
}

export interface ChoiceEvaluation {
  choice: ChoiceExpressions;
  bindings?: ExpressionBindings;
  windowFromTurn?: number;
}

interface EvaluatedChoice {
  weight: number;
  sources: NewspaperSourceReference[];
  /** The choice's `when` did not evaluate to true. */
  ineligible?: true;
}

type ChoiceBatch = Pick<ExpressionBatch, 'constants' | 'facts' | 'globals'>;
type ChoiceGroup = ExpressionBatch['groups'][number];

/** Use the same truthiness as trigger guards. An unknown condition cannot enable anything. */
function matches(result: ExpressionResult): boolean {
  return 'value' in result && !!result.value;
}

/** Record a diagnostic for a failed expression while leaving hidden, skipped and unreached reads unreported. */
export function recordChoiceError(
  result: ExpressionResult,
  slot: number,
  budget?: ExpressionCheckBudget,
): void {
  if (!('error' in result)) return;
  const { rule, field, message, hidden, skipped, unreached, budgetExhausted } = result.error;
  if (budgetExhausted && budget) budget.choiceEvaluationIncomplete = true;
  const errors = budget?.choiceErrors;
  if (!errors || errors.has(slot) || hidden !== undefined || skipped || unreached) return;
  errors.set(slot, { choice: rule, field, message: message.slice(0, 500) });
}

/** Build one batch across all applicable subjects, bypassing constant choices. */
export async function evaluateChoices(
  runner: ExpressionRunner,
  batch: ChoiceBatch,
  choices: readonly ChoiceEvaluation[],
  budget: ExpressionCheckBudget = { interruptedSlots: new Set() },
): Promise<EvaluatedChoice[]> {
  /** Apply choice expressions in bulk and write their results back to the matching choice. */
  async function evaluate(
    targets: { index: number; slots: readonly number[] }[],
    apply: (results: ExpressionResult[], index: number) => void,
  ) {
    const groups: ChoiceGroup[] = targets.map(({ index, slots }) => ({
      windowFromTurn: choices[index].windowFromTurn,
      expressions: slots,
      subjects: [choices[index].bindings ?? {}],
    }));
    if (!groups.length) return;
    const results = await runner.evaluate({ ...batch, groups }, budget);
    targets.forEach(({ index, slots }, offset) => {
      const evaluated = results[offset][0];
      evaluated.forEach((result, step) => recordChoiceError(result, slots[step], budget));
      apply(evaluated, index);
    });
  }

  const results: EvaluatedChoice[] = choices.map(({ choice }) => ({ weight: choice.base, sources: [] }));
  const eligible = choices.map(({ choice }) => choice.when === undefined);
  const whenFailed = choices.map(() => false);
  await evaluate(
    choices.flatMap(({ choice }, index) => choice.when === undefined ? [] : [{ index, slots: [choice.when] }]),
    ([result], index) => {
      eligible[index] = matches(result);
      whenFailed[index] = !eligible[index];
      if (eligible[index] && result.sources) results[index].sources.push(...result.sources);
    },
  );
  await evaluate(
    choices.flatMap(({ choice }, index) => eligible[index] && choice.adjustments.length
      ? [{ index, slots: choice.adjustments.map(({ when }) => when) }]
      : []),
    (adjustments, index) => {
      for (const [offset, result] of adjustments.entries()) {
        // An unfinished adjustment may have removed the entire weight.
        if ('error' in result && (result.error.interrupted || result.error.skipped)) {
          eligible[index] = false;
          return;
        }
        if (!matches(result)) continue;
        results[index].weight += choices[index].choice.adjustments[offset].add;
        if (result.sources) results[index].sources.push(...result.sources);
      }
    },
  );
  return results.map(({ weight, sources }, index) => {
    if (whenFailed[index]) return { weight: 0, sources: [], ineligible: true };
    if (!eligible[index]) return { weight: 0, sources: [] };
    return Number.isFinite(weight) && weight > 0 ? { weight, sources: uniqueSources(sources) } : { weight: 0, sources: [] };
  });
}
