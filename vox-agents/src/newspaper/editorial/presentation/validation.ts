/** Shared deterministic validation for any future editor and its authored fallback. */
import type { IssueDocument } from '../../contracts/issue.js';
import { parseIssueDocument } from '../../renderer/validation.js';
import type { EditorialConfig } from '../config/schema.js';
import type { PresentationWeights } from './eligibility.js';
import type { PresentationResult } from './issue.js';

/** Enforce canonical series, threat prominence, evidence dates and exact layout slots. */
export function validateEditorialIssue(
  { issue, itemCandidates: candidates, layouts, variants }: PresentationResult,
  config: EditorialConfig,
  weights: PresentationWeights,
): IssueDocument {
  const parsed = parseIssueDocument(issue);
  const frontDefinition = config.pages.find((page) => page.front)!;
  const front = parsed.pages[0];
  if (front?.id !== frontDefinition.id)
    throw new Error('The front page must be first and eligible.');
  const design = config.designs.find((entry) => entry.id === parsed.publication.designId);
  if (!design || (weights.get(design) ?? 0) <= 0)
    throw new Error('Unknown or ineligible design.');
  const seenSeries = new Set<string>();
  for (const item of parsed.items) {
    const candidate = candidates.get(item.id);
    if (!candidate || !candidate.variants.some((variant) =>
      variant.id === variants[item.id] && (candidate.variantWeights[variant.id] ?? 0) > 0))
      throw new Error('Every article requires an eligible authored candidate.');
    if (candidate.sources.some((source) => source.turn > parsed.cutoff.turn))
      throw new Error('Article evidence exceeds the cutoff.');
    for (const key of item.seriesKeys) {
      if (seenSeries.has(key)) throw new Error('A series may occupy only one canonical item.');
      seenSeries.add(key);
    }
  }
  const urgent = parsed.items.filter((item) => candidates.get(item.id)?.urgent);
  if (
    urgent.length &&
    (!urgent.some((item) => item.id === front.itemIds[0]) || front.layout !== 'breaking')
  )
    throw new Error('An urgent development must lead a breaking front page.');
  const subjects = new Set(parsed.items.map((item) => candidates.get(item.id)?.subject));
  if (subjects.size > 1 && new Set(front.itemIds.map((id) => candidates.get(id)?.subject)).size < 2)
    throw new Error('The front page must mix available subjects.');
  for (const page of parsed.pages) {
    const definition = config.pages.find((entry) => entry.id === page.id);
    if (!definition || (weights.get(definition) ?? 0) <= 0)
      throw new Error('Unknown or ineligible page.');
    const layout = design.layouts.find((entry) => entry.id === layouts[page.id]);
    const isBreaking = definition.front && page.itemIds.some((id) => candidates.get(id)?.urgent);
    if (!layout || layout.variant !== page.layout || (weights.get(layout) ?? 0) <= 0 ||
        (layout.variant === 'breaking') !== isBreaking)
      throw new Error('Unknown or ineligible layout.');
    if (page.itemIds.length !== (definition.front ? layout.frontSlots : layout.sectionSlots))
      throw new Error(`Page ${page.id} does not fill its configured layout slots.`);
    if (
      !definition.front &&
      page.itemIds.some(
        (id) =>
          !parsed.items
            .find((item) => item.id === id)
            ?.tags.some((tag) => definition.tags.includes(tag))
      )
    )
      throw new Error('Section contains an unrelated article.');
  }
  return parsed;
}
