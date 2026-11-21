/** Resolve publication names for both the editor and the browser mockups. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { EditorialTerms } from '../config/expressions.js';
import type { EditorialDesign } from '../config/schema.js';
import { placeholderPattern, substitute, termPlaceholders } from '../selection/templates.js';
import { uniqueSources } from '../shared/sources.js';

/** Choose the first printable title and cite the facts that determined the masthead. */
export function resolveMasthead(
  design: Pick<EditorialDesign, 'title' | 'civilizationTitles' | 'motto'>,
  terms: EditorialTerms = new Map(),
  defaultTitle = ''
): { title: string; motto?: string; sources: NewspaperSourceReference[] } | undefined {
  const values = termPlaceholders(terms);
  const civilization = terms.get('civilization');
  const alternatives = design.civilizationTitles;
  const name = civilization?.value;
  const exact = alternatives && typeof name === 'string' && Object.hasOwn(alternatives, name)
    ? alternatives[name]
    : undefined;
  const pattern = typeof name === 'string' && name ? alternatives?.['*'] : undefined;
  const localized = [exact, pattern].find(template => {
    if (!template) return false;
    const text = substitute(template, values);
    return text.trim().length > 0 && !text.match(placeholderPattern);
  });
  const titleTemplate = localized ?? design.title;
  const resolvedTitle = substitute(titleTemplate, values);
  const motto = design.motto === undefined ? undefined : substitute(design.motto, values);
  if (resolvedTitle.match(placeholderPattern) || motto?.match(placeholderPattern)) return undefined;

  const used = [
    ...(resolvedTitle ? [titleTemplate] : []),
    ...(motto ? [design.motto!] : []),
  ].flatMap(text => [...text.matchAll(placeholderPattern)].map(match => match[1]));
  const sources = uniqueSources([
    ...(localized ? civilization?.sources ?? [] : []),
    ...used.flatMap(key => key.startsWith('terms.') ? terms.get(key.slice('terms.'.length))?.sources ?? [] : []),
  ]);
  return { title: resolvedTitle || defaultTitle, ...(motto ? { motto } : {}), sources };
}
