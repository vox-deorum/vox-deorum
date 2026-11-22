/** Read template arrays and append sibling variant companions without parsing their rows. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isRecord } from '../../../utils/guards.js';

const companionSuffix = '-variants.json';

/** Return the companion filename that holds extra variants for a template file. */
export function variantCompanionFilename(file: string): string {
  const stem = file.endsWith('.json') ? file.slice(0, -'.json'.length) : file;
  return `${stem}${companionSuffix}`;
}

const variantCompanionSchema = z.strictObject({
  id: z.string().min(1),
  variants: z.array(z.unknown()),
});
type VariantCompanion = z.infer<typeof variantCompanionSchema>;

/** Parse companion records strictly so an unexpected field cannot change the merge. */
function parseCompanions(extra: unknown[], companionFilename: string): VariantCompanion[] {
  const parsed = z.array(variantCompanionSchema).safeParse(extra);
  if (!parsed.success)
    throw new Error(`Invalid variant companion ${companionFilename}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Read the authored identifiers, including both regular and merge rows. */
export function templateVariantIds(template: Record<string, unknown>, additionalRows: unknown[] = []): string[] {
  const lists = [
    template.variants,
    isRecord(template.merge) ? template.merge.variants : undefined,
    additionalRows,
  ];
  return lists.flatMap(list => Array.isArray(list)
    ? list.flatMap(row => isRecord(row) && typeof row.id === 'string' ? [row.id] : [])
    : []);
}

/** Append companion rows to their base templates while keeping base row order and raw rows. */
export function mergeTemplateVariants(base: unknown[], extra: unknown[], companionFilename: string): unknown[] {
  const companions = parseCompanions(extra, companionFilename);
  const seenTemplates = new Set<string>();
  const additions = new Map<number, unknown[]>();
  for (const companion of companions) {
    if (seenTemplates.has(companion.id))
      throw new Error(`Duplicate variant companion entry for template "${companion.id}" in ${companionFilename}.`);
    seenTemplates.add(companion.id);
    const index = base.findIndex(row => isRecord(row) && row.id === companion.id);
    if (index === -1)
      throw new Error(`Variant companion ${companionFilename} has no base template "${companion.id}".`);
    const template = base[index] as Record<string, unknown>;
    if (template.variants !== undefined && !Array.isArray(template.variants))
      throw new Error(`Expected variants to be an array in template "${companion.id}" (${companionFilename}).`);
    const ids = new Set<string>();
    for (const id of templateVariantIds(template, companion.variants)) {
      if (ids.has(id)) throw new Error(`Duplicate variant id "${id}" in template "${companion.id}" (${companionFilename}).`);
      ids.add(id);
    }
    additions.set(index, companion.variants);
  }
  if (additions.size === 0) return [...base];
  return base.map((row, index) => {
    const extraRows = additions.get(index);
    if (!extraRows) return row;
    const template = row as Record<string, unknown>;
    return {
      ...template,
      variants: [...(Array.isArray(template.variants) ? template.variants : []), ...extraRows],
    };
  });
}

interface TemplateSource {
  /** Base template filename relative to the templates directory. */
  file: string;
  /** Raw template rows before companion variants are appended. */
  base: unknown[];
  /** Raw template rows after companion variants are appended. */
  templates: unknown[];
  /** Companion filename when the source has one. */
  companion?: string;
}

interface TemplateSourceOptions {
  /** Inspect a filename relative to the templates directory before it is read. */
  beforeRead?: (filename: string) => Promise<void>;
}

/** Read one JSON file, reporting the relative name when it is malformed. */
async function readJsonFile(directory: string, filename: string): Promise<unknown> {
  const text = await readFile(path.join(directory, filename), 'utf8');
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new SyntaxError(`Invalid JSON in template file ${filename}.`, { cause });
  }
}

/** Read base template files with their sibling companions in filename order. */
export async function readTemplateSources(
  templatesDirectory: string,
  options: TemplateSourceOptions = {}
): Promise<TemplateSource[]> {
  const entries = await readdir(templatesDirectory, { withFileTypes: true });
  const names = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => entry.name)
    .sort();
  const companions = new Set(names.filter(name => name.endsWith(companionSuffix)));
  const baseFiles = names.filter(name => !name.endsWith(companionSuffix));
  for (const companion of companions) {
    const baseFile = `${companion.slice(0, -companionSuffix.length)}.json`;
    if (!baseFiles.includes(baseFile))
      throw new Error(`Variant companion ${companion} has no base template file ${baseFile}.`);
  }
  const sources: TemplateSource[] = [];
  for (const file of baseFiles) {
    await options.beforeRead?.(file);
    const base = z.array(z.unknown()).parse(await readJsonFile(templatesDirectory, file));
    const companion = variantCompanionFilename(file);
    if (!companions.has(companion)) {
      sources.push({ file, base, templates: [...base] });
      continue;
    }
    await options.beforeRead?.(companion);
    const extra = z.array(z.unknown()).parse(await readJsonFile(templatesDirectory, companion));
    sources.push({ file, base, templates: mergeTemplateVariants(base, extra, companion), companion });
  }
  return sources;
}
