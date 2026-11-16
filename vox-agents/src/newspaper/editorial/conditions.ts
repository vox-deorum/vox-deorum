/** Finite, three-valued editorial eligibility conditions. */
import { z } from 'zod';

export type Truth = true | false | 'unknown';
export type Condition = { op: 'always' } | { op: 'all' | 'any'; conditions: Condition[] }
  | { op: 'not'; condition: Condition }
  | { op: 'technology'; id: string }
  | { op: 'eq' | 'gte' | 'lte' | 'contains'; field: string; value: string | number | boolean };
/** Only supported operators can enter catalogue configuration. */
export const conditionSchema: z.ZodType<Condition> = z.lazy(() => z.discriminatedUnion('op', [
  z.object({ op: z.literal('always') }),
  z.object({ op: z.enum(['all', 'any']), conditions: z.array(conditionSchema) }),
  z.object({ op: z.literal('not'), condition: conditionSchema }),
  z.object({ op: z.literal('technology'), id: z.string().min(1) }),
  z.object({ op: z.enum(['eq', 'gte', 'lte', 'contains']), field: z.string().min(1),
    value: z.union([z.string(), z.number().finite(), z.boolean()]) }),
]));
export interface ConditionContext {
  values: Record<string, unknown>;
  technologies?: readonly string[];
  technologyHistoryComplete?: boolean;
}

/** Evaluate known observations without treating missing history as absence. */
export function evaluateCondition(condition: Condition | undefined, context: ConditionContext): Truth {
  if (!condition || condition.op === 'always') return true;
  if (condition.op === 'not') {
    const result = evaluateCondition(condition.condition, context);
    return result === 'unknown' ? result : !result;
  }
  if (condition.op === 'all' || condition.op === 'any') {
    const results = condition.conditions.map(child => evaluateCondition(child, context));
    if (condition.op === 'all') return results.includes(false) ? false : results.includes('unknown') ? 'unknown' : true;
    return results.includes(true) ? true : results.includes('unknown') ? 'unknown' : false;
  }
  if (condition.op === 'technology') {
    if (context.technologies?.includes(condition.id)) return true;
    return context.technologyHistoryComplete ? false : 'unknown';
  }
  if (!('field' in condition)) return 'unknown';
  const actual = context.values[condition.field];
  if (actual === undefined || actual === null) return 'unknown';
  switch (condition.op) {
    case 'eq': return actual === condition.value;
    case 'gte': return typeof actual === 'number' && typeof condition.value === 'number' ? actual >= condition.value : 'unknown';
    case 'lte': return typeof actual === 'number' && typeof condition.value === 'number' ? actual <= condition.value : 'unknown';
    case 'contains': return Array.isArray(actual) ? actual.includes(condition.value) : 'unknown';
  }
}
