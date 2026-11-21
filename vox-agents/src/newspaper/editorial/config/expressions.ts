/** Prepare the expressions of a merged catalogue before evaluating checks. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import {
  compileEditorialExpressions,
  type EditorialExpression,
  type ExpressionRunner,
} from '../shared/expressions.js';
import type { EditorialConstants } from './constants.js';
import { literalTierName, type EditorialConfig, type EditorialTriggerRule } from './schema.js';
import type { ChoiceExpressions } from '../shared/eligibility.js';
import type { StyleCatalogue } from './styles.js';

type TriggerExpressionFields = Pick<EditorialTriggerRule, 'id' | 'values' | 'tier' | 'adjust' | 'urgent' | 'group'> & {
  when: Readonly<EditorialTriggerRule['when']>;
};

/** Indices of the compiled expressions used by one rule. */
export interface TriggerExpressionSlots {
  readonly when: readonly number[];
  readonly values: ReadonlyMap<string, number>;
  readonly tier?: number;
  readonly literalTier?: string;
  readonly adjust: readonly number[];
  readonly urgent?: number;
  readonly groupBy?: number;
}

/** A printable term and the recorded rows its expression read. */
export interface EditorialTerm {
  readonly value: string | number;
  readonly sources: NewspaperSourceReference[];
}
/** Resolved terms by their catalogue name. */
export type EditorialTerms = ReadonlyMap<string, EditorialTerm>;

export interface CompiledTriggerExpressions {
  runner: ExpressionRunner;
  /** Expression indices by trigger ID and field, kept out of the saved catalogue. */
  slots: ReadonlyMap<string, TriggerExpressionSlots>;
  /** Expression indices by printable term name. */
  terms: ReadonlyMap<string, number>;
}

interface PreparedTemplate extends ChoiceExpressions {
  variants: ReadonlyMap<string, ChoiceExpressions>;
  merge?: {
    match: number;
    values: ReadonlyMap<string, number>;
    variants: ReadonlyMap<string, ChoiceExpressions>;
  };
}

interface PreparedDesign extends ChoiceExpressions {
  layouts: ReadonlyMap<string, ChoiceExpressions>;
}

export interface CompiledEditorialExpressions extends CompiledTriggerExpressions {
  templates: ReadonlyMap<string, PreparedTemplate>;
  pages: ReadonlyMap<string, ChoiceExpressions>;
  designs: ReadonlyMap<string, PreparedDesign>;
  mastheadRules: ReadonlyMap<string, ChoiceExpressions>;
  styleRules: readonly (StyleCatalogue['rules'][number] & { slot: number })[];
}

/** Compile the expression fields of each rule and keep its catalogue location for diagnostics. */
export async function prepareTriggerExpressions(
  rules: readonly TriggerExpressionFields[],
  constants?: EditorialConstants,
): Promise<CompiledTriggerExpressions> {
  const expressions: EditorialExpression[] = [];
  const terms = termSlots(constants?.terms, expressions);
  const slots = triggerSlots(rules, expressions);
  return {
    runner: await compileEditorialExpressions(expressions, { shortcuts: constants?.shortcuts, stakes: constants?.stakes }),
    slots, terms,
  };
}

/** Record a compiled index and its authored location. */
function addExpression(expressions: EditorialExpression[], rule: string, field: string, source: string): number {
  return expressions.push({ rule, field, source }) - 1;
}

/** Register printable terms beside shortcuts, keeping their catalogue names for diagnostics. */
function termSlots(
  terms: Readonly<Record<string, string>> | undefined,
  expressions: EditorialExpression[]
): ReadonlyMap<string, number> {
  return new Map(Object.entries(terms ?? {}).map(([name, source]) =>
    [name, addExpression(expressions, `constants.terms.${name}`, 'expression', source)]
  ));
}

/** Register all rule fields in the catalogue's common expression table. */
function triggerSlots(rules: readonly TriggerExpressionFields[], expressions: EditorialExpression[]) {
  const slots = new Map<string, TriggerExpressionSlots>();
  for (const rule of rules) {
    if (slots.has(rule.id)) throw new Error(`Duplicate trigger rule ID "${rule.id}".`);
    /** Register a field and its index in the shared evaluator. */
    const add = (field: string, source: string) => addExpression(expressions, rule.id, field, source);
    const literalTier = literalTierName(rule.tier);
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
      tier: literalTier === undefined ? add('tier', rule.tier) : undefined,
      literalTier,
      adjust: typeof rule.adjust === 'string' ? [add('adjust', rule.adjust)] :
        (rule.adjust ?? []).map((source, index) => add(`adjust[${index}]`, source)),
      urgent: rule.urgent === undefined ? undefined : add('urgent', rule.urgent),
      groupBy: rule.group && add('group.by', rule.group.by),
    });
  }
  return slots;
}

/** Compile rules and choices together so constants and shortcuts have one definition per catalogue. */
export async function prepareEditorialExpressions(config: EditorialConfig): Promise<CompiledEditorialExpressions> {
  const expressions: EditorialExpression[] = [];
  const terms = termSlots(config.constants.terms, expressions);
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
    ...(template.merge ? { merge: {
      match: addExpression(expressions, `template ${template.id} / merge`, 'match', template.merge.match),
      values: new Map(Object.entries(template.merge.values ?? {}).map(([name, source]) =>
        [name, addExpression(expressions, `template ${template.id} / merge`, `values.${name}`, source)]
      )),
      variants: new Map(template.merge.variants.map(variant => [
        variant.id, choice(`template ${template.id} / merge variant ${variant.id}`, variant),
      ])),
    } } : {}),
  }]));
  const pages = new Map(config.pages.map(page => [page.id, choice(`page ${page.id}`, page)]));
  const designs = new Map(config.designs.map(design => [design.id, {
    ...choice(`design ${design.id}`, design),
    layouts: new Map(design.layouts.map(layout => [
      layout.id, choice(`design ${design.id} / layout ${layout.id}`, layout),
    ])),
  }]));
  const mastheadRules = new Map((config.mastheadRules ?? []).map(rule => [
    rule.id, choice(`masthead rule ${rule.id}`, rule),
  ]));
  const styleRules = (config.styles?.rules ?? []).map(rule => ({
    ...rule, slot: addExpression(expressions, `style rule ${rule.id}`, 'when', rule.when),
  }));

  const runner = await compileEditorialExpressions(expressions, { shortcuts: config.constants.shortcuts, stakes: config.constants.stakes });
  return { runner, slots, terms, templates, pages, designs, mastheadRules, styleRules };
}
