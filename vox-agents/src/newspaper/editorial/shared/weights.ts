/** Shared bounded vocabulary for weighted eligible choices. */
import { z } from 'zod';
import { conditionSchema, evaluateCondition, type ConditionContext } from './conditions.js';

export const weightSchema = z.object({
  base: z.number().finite(),
  adjustments: z
    .array(z.object({ condition: conditionSchema, add: z.number().finite() }))
    .default([]),
});
export type Weight = z.infer<typeof weightSchema>;

/** Apply only known-true adjustments and exclude nonpositive final weights. */
export function selectionWeight(weight: Weight, context: ConditionContext): number {
  return Math.max(
    0,
    weight.adjustments.reduce(
      (value, change) =>
        value + (evaluateCondition(change.condition, context) === true ? change.add : 0),
      weight.base
    )
  );
}

/** Choose a positive-weight option using the caller's independent random stream. */
export function chooseWeighted<T>(
  choices: readonly T[],
  weight: (choice: T) => number,
  random: () => number
): T | undefined {
  const available = choices
    .map((choice) => ({ choice, weight: weight(choice) }))
    .filter((entry) => entry.weight > 0);
  const total = available.reduce((sum, entry) => sum + entry.weight, 0);
  if (!total) return undefined;
  let remainder = random() * total;
  for (const entry of available) {
    remainder -= entry.weight;
    if (remainder < 0) return entry.choice;
  }
  return available.at(-1)?.choice;
}
