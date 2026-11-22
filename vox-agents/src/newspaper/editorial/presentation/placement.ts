/** Fit planned pages to the articles selected by the editor. */
import type { EditorialConfig, EditorialLayout } from '../config/schema.js';
import { chooseWeighted } from '../shared/weights.js';
import { planPage } from './page-plan.js';

type Page = EditorialConfig['pages'][number];

interface PlacementEntry {
  id: string;
  tags: readonly string[];
  subject: string;
  urgent: boolean;
  importance: number;
}

interface PagePlacement {
  page: Page;
  layout: EditorialLayout;
  itemIds: string[];
  hasLead: boolean;
}

/** Compare page IDs without using the reader's locale or UTF-16 surrogate order. */
function comparePageIds(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const order = left[index].codePointAt(0)! - right[index].codePointAt(0)!;
    if (order) return order;
  }
  return left.length - right.length;
}

/** Put the planned lead first and keep a different subject second on the front page. */
function orderEntries(
  entries: readonly PlacementEntry[],
  leadId: string | undefined,
  diversifySubjects: boolean,
): PlacementEntry[] {
  const lead = leadId === undefined ? undefined : entries.find(entry => entry.id === leadId);
  const first = lead ?? entries[0];
  if (!first) return [];
  const second = diversifySubjects
    ? entries.find(entry => entry !== first && entry.subject !== first.subject)
    : undefined;
  return [first, ...(second ? [second] : []), ...entries.filter(entry => entry !== first && entry !== second)];
}

/** Fill the front first, then give each eligible section a chance to claim a complete page. */
export function placeArticles(input: {
  entries: readonly PlacementEntry[];
  frontPage: Page;
  frontLayout: EditorialLayout;
  sectionPages: readonly Page[];
  sectionLayouts: readonly EditorialLayout[];
  layoutWeight: (layout: EditorialLayout) => number;
  sectionDraw: (page: Page) => number;
}): PagePlacement[] {
  const { entries, frontPage, frontLayout, sectionPages, sectionLayouts, layoutWeight, sectionDraw } = input;
  const frontPlan = planPage(entries, true);
  if (entries.length < frontPlan.count)
    throw new Error('The front page requires more articles.');
  const frontIds = orderEntries(entries, frontPlan.leadId, true)
    .slice(0, frontPlan.count)
    .map(entry => entry.id);
  const pages: PagePlacement[] = [{
    page: frontPage,
    layout: frontLayout,
    itemIds: frontIds,
    hasLead: frontPlan.leadId !== undefined,
  }];
  const claimed = new Set(frontIds);
  const orderedSections = sectionPages.filter(page => !page.front).sort(
    (a, b) => a.order - b.order || comparePageIds(a.id, b.id),
  );
  const layouts = sectionLayouts.filter(layout => layout.variant !== 'breaking');
  for (const page of orderedSections) {
    const matches = entries.filter(entry => !claimed.has(entry.id) && entry.tags.some(tag => page.tags.includes(tag)));
    const plan = planPage(matches, false);
    if (matches.length < plan.count) continue;
    const layout = chooseWeighted(layouts, layoutWeight, () => sectionDraw(page));
    if (!layout) continue;
    const itemIds = orderEntries(matches, plan.leadId, false)
      .slice(0, plan.count)
      .map(entry => entry.id);
    pages.push({ page, layout, itemIds, hasLead: plan.leadId !== undefined });
    for (const id of itemIds) claimed.add(id);
  }
  return pages;
}
