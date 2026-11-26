import type { DeskText, DeskVariable } from '../../types/api.js';
import { placeholderName, placeholderPattern } from '../editorial/selection/templates.js';

/** Ignore case, punctuation and a trailing name suffix when comparing spellings. */
function looseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/name$/, '');
}

/** Index a spelling by its listed name, or mark it ambiguous if two rows share it. */
function indexName(index: Map<string, string | null>, spelling: string, name: string): void {
  const existing = index.get(spelling);
  if (existing !== name) index.set(spelling, existing === undefined ? name : null);
}

/** Rewrite unambiguous placeholder spellings throughout the editable copy. */
export function repairCopy(text: DeskText, variables: readonly Pick<DeskVariable, 'name' | 'aliases'>[]): DeskText {
  const listed = new Set<string>();
  const aliases = new Map<string, string | null>();
  const loose = new Map<string, string | null>();
  for (const { name, aliases: spellings } of variables) {
    listed.add(name);
    indexName(loose, looseName(name), name);
    for (const spelling of spellings) {
      indexName(aliases, spelling, name);
      indexName(loose, looseName(spelling), name);
    }
  }

  /** Repair a field while preserving plural suffixes and unresolved placeholders. */
  const repair = (field: string): string => field.replace(placeholderPattern, (whole, key: string) => {
    const base = placeholderName(key);
    const trimmed = base.trim();
    const name = listed.has(trimmed) ? trimmed : aliases.get(trimmed) ?? loose.get(looseName(trimmed));
    return name === undefined || name === null ? whole : '{{' + name + key.slice(base.length) + '}}';
  });

  return {
    ...text,
    headline: repair(text.headline),
    ...(text.subheadline !== undefined ? { subheadline: repair(text.subheadline) } : {}),
    ...(text.byline !== undefined ? { byline: repair(text.byline) } : {}),
    body: text.body.map(repair),
  };
}
