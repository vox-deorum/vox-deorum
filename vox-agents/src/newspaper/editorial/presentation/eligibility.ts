/** Evaluate pages, designs and layouts against the same visible facts used by the editor. */
import type { EditorialConfig, EditorialDesign } from '../config/schema.js';
import type { CompiledEditorialExpressions } from '../config/expressions.js';
import { evaluateChoices, type ChoiceEvaluation } from '../shared/eligibility.js';
import type { ExpressionBatch, ExpressionCheckBudget } from '../shared/expressions.js';

type PresentationOption = EditorialConfig['pages'][number] | EditorialDesign | EditorialDesign['layouts'][number];
export type PresentationWeights = ReadonlyMap<PresentationOption, number>;

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
