import type { DeskText, DeskVariable } from '../../types/api.js';
import { placeholderName, placeholderUnit } from '../editorial/selection/templates.js';

/** A placeholder together with any stray braces a writer put around it. */
const bracedPlaceholder = /\{*\{\{([^{}]+)\}\}\}*/g;

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

  /** Repair a field, dropping stray braces and a plural suffix the name already prints, and leave unresolved placeholders as written. */
  const repair = (field: string): string => field.replace(bracedPlaceholder, (whole, key: string) => {
    const base = placeholderName(key);
    const trimmed = base.trim();
    const name = listed.has(trimmed) ? trimmed : aliases.get(trimmed) ?? loose.get(looseName(trimmed));
    if (name === undefined || name === null) return whole;
    const suffix = placeholderUnit(name) === undefined ? key.slice(base.length) : '';
    return '{{' + name + suffix + '}}';
  });

  return {
    ...text,
    headline: repair(text.headline),
    ...(text.subheadline !== undefined ? { subheadline: repair(text.subheadline) } : {}),
    ...(text.byline !== undefined ? { byline: repair(text.byline) } : {}),
    body: text.body.map(repair),
  };
}
