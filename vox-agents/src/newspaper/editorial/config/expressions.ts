/** Prepare the expressions of a merged catalogue before evaluating checks. */
import {
  compileEditorialExpressions,
  type EditorialExpression,
  type ExpressionRunner,
} from '../shared/expressions.js';
import type { EditorialConstants } from './constants.js';
import type { EditorialConfig, EditorialTriggerRule } from './schema.js';
import type { ChoiceExpressions } from '../shared/eligibility.js';

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

interface PreparedTemplate extends ChoiceExpressions {
  variants: ReadonlyMap<string, ChoiceExpressions>;
}

interface PreparedDesign extends ChoiceExpressions {
  layouts: ReadonlyMap<string, ChoiceExpressions>;
}

export interface CompiledEditorialExpressions extends CompiledTriggerExpressions {
  templates: ReadonlyMap<string, PreparedTemplate>;
  pages: ReadonlyMap<string, ChoiceExpressions>;
  designs: ReadonlyMap<string, PreparedDesign>;
}

/** Compile the expression fields of each rule and keep its catalogue location for diagnostics. */
export async function prepareTriggerExpressions(
  rules: readonly TriggerExpressionFields[],
  constants?: EditorialConstants,
): Promise<CompiledTriggerExpressions> {
  const expressions: EditorialExpression[] = [];
  const slots = triggerSlots(rules, expressions);
  return { runner: await compileEditorialExpressions(expressions, { shortcuts: constants?.shortcuts }), slots };
}

/** Record a compiled index and its authored location. */
function addExpression(expressions: EditorialExpression[], rule: string, field: string, source: string): number {
  return expressions.push({ rule, field, source }) - 1;
}

/** Register all rule fields in the catalogue's common expression table. */
function triggerSlots(rules: readonly TriggerExpressionFields[], expressions: EditorialExpression[]) {
  const slots = new Map<string, TriggerExpressionSlots>();
  for (const rule of rules) {
    if (slots.has(rule.id)) throw new Error(`Duplicate trigger rule ID "${rule.id}".`);
    /** Register a field and its index in the shared evaluator. */
    const add = (field: string, source: string) => addExpression(expressions, rule.id, field, source);
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
  return slots;
}

/** Compile rules and choices together so constants and shortcuts have one definition per catalogue. */
export async function prepareEditorialExpressions(config: EditorialConfig): Promise<CompiledEditorialExpressions> {
  const expressions: EditorialExpression[] = [];
  const slots = triggerSlots(config.triggers, expressions);

  /** Prepare one authored choice; omitted expressions need no sandbox work. */
  function choice(path: string, entry: { when?: string; weight?: EditorialConfig['designs'][number]['weight'] }): ChoiceExpressions {
    return {
      when: entry.when === undefined ? undefined : addExpression(expressions, path, 'when', entry.when),
      base: entry.weight?.base ?? 1,
      adjustments: (entry.weight?.adjustments ?? []).map(({ when, add }, index) => ({
        when: addExpression(expressions, path, `weight.adjustments[${index}].when`, when),
        add,
      })),
    };
  }

  const templates = new Map(config.templates.map(template => [template.id, {
    ...choice(`template ${template.id}`, template),
    variants: new Map(template.variants.map(variant => [
      variant.id, choice(`template ${template.id} / variant ${variant.id}`, variant),
    ])),
  }]));
  const pages = new Map(config.pages.map(page => [page.id, choice(`page ${page.id}`, page)]));
  const designs = new Map(config.designs.map(design => [design.id, {
    ...choice(`design ${design.id}`, design),
    layouts: new Map(design.layouts.map(layout => [
      layout.id, choice(`design ${design.id} / layout ${layout.id}`, layout),
    ])),
  }]));

  const runner = await compileEditorialExpressions(expressions, { shortcuts: config.constants.shortcuts });
  return { runner, slots, templates, pages, designs };
}
