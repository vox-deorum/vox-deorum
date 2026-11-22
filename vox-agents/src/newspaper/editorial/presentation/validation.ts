/** Shared deterministic validation for any future editor and its authored fallback. */
import type { IssueDocument } from '../../contracts/issue.js';
import { parseIssueDocument } from '../../renderer/validation.js';
import type { EditorialConfig } from '../config/schema.js';
import type { PresentationWeights } from './eligibility.js';
import type { PresentationResult } from './issue.js';
import { frontBriefCount, sectionBriefCount } from './page-plan.js';

/** Enforce canonical series, threat prominence, evidence dates and required lead counts. */
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
    (!front.hasLead || front.layout !== 'breaking' || !urgent.some((item) => item.id === front.itemIds[0]))
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
    if (!layout || layout.variant !== page.layout || (weights.get(layout) ?? 0) <= 0)
      throw new Error('Unknown or ineligible layout.');
    const lead = candidates.get(page.itemIds[0]);
    if (page.layout === 'breaking' && (!definition.front || !page.hasLead || !lead?.urgent))
      throw new Error('A breaking page requires an urgent lead.');
    const required = (definition.front ? frontBriefCount : sectionBriefCount) + (page.hasLead ? 1 : 0);
    if (page.itemIds.length !== required)
      throw new Error(`Page ${page.id} does not fill its required ${required} articles.`);
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
