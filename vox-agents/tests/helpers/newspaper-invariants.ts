import type { IssuePage } from '../../src/newspaper/contracts/issue.js';
import { briefsFit } from '../../src/newspaper/editorial/presentation/page-plan.js';

/** The page and item shape needed to check fixed newspaper rules. */
export interface NewspaperIssueShape {
  pages: readonly Pick<IssuePage, 'id' | 'hasLead' | 'itemIds'>[];
  items: readonly { id: string }[];
}

/** List fixed-rule page problems: brief counts, repeated items, and items missing from pages. */
export function newspaperPageProblems(issue: NewspaperIssueShape): string[] {
  const problems: string[] = [];
  const placements = new Map<string, number>();
  issue.pages.forEach((page, index) => {
    const briefs = page.itemIds.length - (page.hasLead ? 1 : 0);
    if (!briefsFit(briefs, index === 0)) problems.push(`Page ${page.id} has ${briefs} briefs.`);
    for (const id of page.itemIds) placements.set(id, (placements.get(id) ?? 0) + 1);
  });
  for (const [id, count] of placements)
    if (count > 1) problems.push(`Item ${id} prints ${count} times.`);
  for (const item of issue.items)
    if (!placements.has(item.id)) problems.push(`Item ${item.id} is not on a page.`);
  return problems;
}

/** List coverage problems: a candidate repeated in the record instead of appearing once. */
export function newspaperCoverageProblems(candidates: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const { id } of candidates) {
    if (seen.has(id)) problems.push(`Candidate ${id} has more than one coverage outcome.`);
    seen.add(id);
  }
  return problems;
}
