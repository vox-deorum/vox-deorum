/** Prepare the expression fields of a merged trigger catalogue before evaluating checks. */
import {
  compileEditorialExpressions,
  type EditorialExpression,
  type ExpressionRunner,
} from '../shared/expressions.js';
import type { EditorialConstants } from './constants.js';
import type { EditorialTriggerRule } from './schema.js';

type TriggerExpressionFields = Pick<EditorialTriggerRule, 'id' | 'values' | 'importance' | 'urgent' | 'group'> & {
  when: Readonly<EditorialTriggerRule['when']>;
};

/** Indices of the compiled expressions used by one rule. */
export interface TriggerExpressionSlots {
  readonly when: readonly number[];
  readonly values: ReadonlyMap<string, number>;
  readonly importance?: number;
  readonly urgent?: number;
  readonly groupBy?: number;
}

export interface CompiledTriggerExpressions {
  runner: ExpressionRunner;
  /** Expression indices by trigger ID and field, kept out of the saved catalogue. */
  slots: ReadonlyMap<string, TriggerExpressionSlots>;
}

/** Compile the expression fields of each rule and keep its catalogue location for diagnostics. */
export async function prepareTriggerExpressions(
  rules: readonly TriggerExpressionFields[],
  constants?: EditorialConstants,
): Promise<CompiledTriggerExpressions> {
  const expressions: EditorialExpression[] = [];
  const slots = new Map<string, TriggerExpressionSlots>();
  for (const rule of rules) {
    if (slots.has(rule.id)) throw new Error(`Duplicate trigger rule ID "${rule.id}".`);
    /** Register a field and its index in the shared evaluator. */
    const add = (field: string, source: string): number => {
      const slot = expressions.length;
      expressions.push({ rule: rule.id, field, source });
      return slot;
    };
    slots.set(rule.id, {
      when:
        typeof rule.when === 'string'
          ? [add('when', rule.when)]
          : rule.when.map((source, index) => add(`when[${index}]`, source)),
      values: new Map(
        Object.entries(rule.values ?? {}).map(([name, source]) => [
          name,
          add(`values.${name}`, source),
        ])
      ),
      importance:
        typeof rule.importance === 'string' ? add('importance', rule.importance) : undefined,
      urgent: rule.urgent === undefined ? undefined : add('urgent', rule.urgent),
      groupBy: rule.group && add('group.by', rule.group.by),
    });
  }
  return { runner: await compileEditorialExpressions(expressions, { shortcuts: constants?.shortcuts }), slots };
}
