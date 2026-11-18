/** Shared deterministic validation for any future editor and its authored fallback. */
import type { IssueDocument } from '../../contracts/issue.js';
import { parseIssueDocument } from '../../renderer/validation.js';
import { evaluateCondition, type ConditionContext } from '../shared/conditions.js';
import type { EditorialConfig } from '../config/schema.js';
import type { EditorialCandidate } from '../selection/templates.js';

/** Enforce canonical series, threat prominence, evidence dates and configured page minimums. */
export function validateEditorialIssue(
  issue: IssueDocument,
  candidates: Map<string, EditorialCandidate>,
  config: EditorialConfig,
  context: ConditionContext
): IssueDocument {
  const parsed = parseIssueDocument(issue);
  const frontDefinition = config.pages.find((page) => page.front)!;
  const front = parsed.pages[0];
  if (front?.id !== frontDefinition.id)
    throw new Error('The front page must be first and eligible.');
  const seenSeries = new Set<string>();
  for (const item of parsed.items) {
    const candidate = candidates.get(item.id);
    if (!candidate || !candidate.variants.length)
      throw new Error('Every article requires an eligible authored candidate.');
    if (candidate.sources.some((source) => source.turn > parsed.cutoff.turn))
      throw new Error('Article evidence exceeds the cutoff.');
    if (!parsed.pages.some((page) => page.itemIds.includes(item.id)))
      throw new Error('Every article must be displayed.');
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
    if (!definition || evaluateCondition(definition.condition, context) !== true)
      throw new Error('Unknown or ineligible page.');
    if (!definition.front && page.itemIds.length < definition.minimum)
      throw new Error('Section content is below its minimum.');
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
