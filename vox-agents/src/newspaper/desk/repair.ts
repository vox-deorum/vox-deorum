import type { DeskText, DeskVariable } from '../../types/api.js';
import { placeholderName, placeholderUnit } from '../editorial/selection/templates.js';

/** A placeholder together with any stray braces a writer put around it. */
const bracedPlaceholder = /(\{*\{\{([^{}]+)\}\}\}*)/;

/** Match a unit word, singular or plural, written right after a placeholder that already prints it. */
function unitWord(singular: string, plural?: string): RegExp {
  return new RegExp(`^\\s+(?:${[singular, plural].filter(Boolean).join('|')})\\b`, 'i');
}

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

  /** Repair a field, dropping stray braces and any unit the name already prints, and leave unresolved placeholders as written. */
  const repair = (field: string): string => {
    // Splitting keeps the prose between placeholders, then each whole match and its key.
    const parts = field.split(bracedPlaceholder);
    for (let index = 1; index < parts.length; index += 3) {
      const key = parts[index + 1];
      const base = placeholderName(key);
      const trimmed = base.trim();
      const name = listed.has(trimmed) ? trimmed : aliases.get(trimmed) ?? loose.get(looseName(trimmed));
      parts[index + 1] = '';
      if (name === undefined || name === null) continue;
      const unit = placeholderUnit(name);
      parts[index] = '{{' + name + (unit === undefined ? key.slice(base.length) : '') + '}}';
      // A turn point prints `turn N`, so a written `turn` before it repeats the unit.
      if (unit?.kind === 'turn') parts[index - 1] = parts[index - 1].replace(/\bturn\s+$/i, '');
      else if (unit) parts[index + 2] = parts[index + 2].replace(unitWord(unit.singular, unit.plural), '');
    }
    return parts.join('');
  };

  return {
    ...text,
    headline: repair(text.headline),
    ...(text.subheadline !== undefined ? { subheadline: repair(text.subheadline) } : {}),
    ...(text.byline !== undefined ? { byline: repair(text.byline) } : {}),
    body: text.body.map(repair),
  };
}
