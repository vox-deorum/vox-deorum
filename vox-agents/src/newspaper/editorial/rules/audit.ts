/** Translate runner results into JSON audit records without unevaluated fields. */
import type { TriggerRuleAudit } from '../../contracts/triggers.js';
import type { ExpressionResult } from '../shared/expressions.js';
import { uniqueSources } from '../shared/sources.js';

type ExpressionAudit = TriggerRuleAudit['subjects'][number]['expressions'][number];

/** Record the authored expression, result or reason for failure, and permitted source rows. */
export function auditExpressions(
  fields: readonly { field: string; source: string }[],
  results: readonly ExpressionResult[],
): ExpressionAudit[] {
  return results.flatMap<ExpressionAudit>((result, index) => {
    const location = fields[index];
    if ('error' in result) {
      if (result.error.unreached) return [];
      return [{
        ...location, error: result.error.message,
        ...(result.error.hidden === undefined ? {} : { hidden: result.error.hidden }),
        ...(result.sources?.length ? { sources: result.sources } : {}),
      }];
    }
    return [{
      ...location,
      ...(result.value === undefined ? {} : { value: result.value }),
      ...(result.sources?.length ? { sources: result.sources } : {}),
    }];
  });
}

/** Deduplicate provenance without losing the order in which facts were read. */
export function expressionSources(expressions: readonly ExpressionAudit[]) {
  return uniqueSources(expressions.flatMap(expression => expression.sources ?? []));
}
