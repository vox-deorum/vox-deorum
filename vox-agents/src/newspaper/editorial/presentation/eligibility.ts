/** Evaluate pages, designs and layouts against the same visible facts used by the editor. */
import type { EditorialConfig, EditorialDesign, EditorialLayout } from '../config/schema.js';
import type { CompiledEditorialExpressions, EditorialTerms } from '../config/expressions.js';
import { evaluateChoices, type ChoiceEvaluation } from '../shared/eligibility.js';
import type { ExpressionBatch, ExpressionCheckBudget } from '../shared/expressions.js';
import { resolveMasthead } from './masthead.js';

type PresentationOption = EditorialConfig['pages'][number] | EditorialDesign | EditorialDesign['layouts'][number];
export type PresentationWeights = ReadonlyMap<PresentationOption, number>;
export type FrontLayouts = ReadonlyMap<EditorialDesign, readonly EditorialLayout[]>;

/** Collect positive layouts for designs that can print their masthead and front tab. */
export function prepareFrontLayouts(
  config: EditorialConfig,
  weights: PresentationWeights,
  terms: EditorialTerms = new Map(),
): FrontLayouts {
  const fronts = new Map<EditorialDesign, EditorialLayout[]>();
  const front = config.pages.find(page => page.front)!;
  if ((weights.get(front) ?? 0) <= 0) return fronts;
  for (const design of config.designs) {
    if ((weights.get(design) ?? 0) <= 0 || !resolveMasthead(design, terms, config.defaults.publicationTitle))
      continue;
    const layouts = design.layouts.filter(layout => (weights.get(layout) ?? 0) > 0);
    if (layouts.length) fronts.set(design, layouts);
  }
  return fronts;
}

/** Keep only designs with enough ready articles for the required front layout kind. */
export function fittingFrontLayouts(fronts: FrontLayouts, readyCount: number, urgent: boolean): FrontLayouts {
  const fitting = new Map<EditorialDesign, EditorialLayout[]>();
  for (const [design, layouts] of fronts) {
    const choices = layouts.filter(layout => (layout.variant === 'breaking') === urgent && layout.frontSlots <= readyCount);
    if (choices.length) fitting.set(design, choices);
  }
  return fitting;
}

/** Prepare the weights once so issue assembly and validation agree on what is visible. */
export async function evaluatePresentation(
  config: EditorialConfig,
  compiled: CompiledEditorialExpressions,
  batch: Pick<ExpressionBatch, 'constants' | 'facts'>,
  budget?: ExpressionCheckBudget,
): Promise<PresentationWeights> {
  const entries: { option: PresentationOption; request: ChoiceEvaluation }[] = [];
  for (const page of config.pages)
    entries.push({ option: page, request: { choice: compiled.pages.get(page.id)! } });
  for (const design of config.designs) {
    const choice = compiled.designs.get(design.id)!;
    entries.push({ option: design, request: { choice } });
    for (const layout of design.layouts)
      entries.push({ option: layout, request: { choice: choice.layouts.get(layout.id)! } });
  }
  const weights = await evaluateChoices(compiled.runner, batch, entries.map(({ request }) => request), budget);
  return new Map(entries.map(({ option }, index) => [option, weights[index].weight]));
}
