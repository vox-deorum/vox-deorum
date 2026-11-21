import type { EditorialConfig, EditorialLayout } from '../config/schema.js';
import { chooseWeighted } from '../shared/weights.js';

type Page = EditorialConfig['pages'][number];

interface PlacementEntry {
  id: string;
  tags: readonly string[];
  subject: string;
  urgent: boolean;
}

interface PagePlacement {
  page: Page;
  layout: EditorialLayout;
  itemIds: string[];
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

/** Fill the front first, then give each eligible section a chance to claim a complete layout. */
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
  if (entries.length < frontLayout.frontSlots)
    throw new Error('The front layout requires more articles.');
  const lead = entries.find(entry => entry.urgent) ?? entries[0];
  const second = entries.find(entry => entry.subject !== lead.subject);
  const front = [lead, ...(second ? [second] : []), ...entries.filter(entry => entry !== lead && entry !== second)]
    .slice(0, frontLayout.frontSlots);
  const frontIds = front.map(entry => entry.id);
  const pages = [{ page: frontPage, layout: frontLayout, itemIds: frontIds }];
  const claimed = new Set(frontIds);
  const orderedSections = sectionPages.filter(page => !page.front).sort(
    (a, b) => a.order - b.order || comparePageIds(a.id, b.id),
  );
  for (const page of orderedSections) {
    const matches = entries.filter(entry => !claimed.has(entry.id) && entry.tags.some(tag => page.tags.includes(tag)));
    const layouts = sectionLayouts.filter(layout =>
      layout.sectionSlots !== undefined && layout.sectionSlots <= matches.length,
    );
    const layout = chooseWeighted(layouts, layoutWeight, () => sectionDraw(page));
    if (!layout) continue;
    const itemIds = matches.slice(0, layout.sectionSlots).map(entry => entry.id);
    pages.push({ page, layout, itemIds });
    for (const id of itemIds) claimed.add(id);
  }
  return pages;
}
