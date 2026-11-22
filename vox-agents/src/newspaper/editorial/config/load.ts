/** Load grouped catalogue files, apply local overrides, and validate references together. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isRecord } from '../../../utils/guards.js';
import { variantStyleKinds } from '../../contracts/style.js';
import { prepareEditorialExpressions, type CompiledEditorialExpressions } from './expressions.js';
import { editorialConfigSchema, editorialConfigVersion, type EditorialConfig } from './schema.js';
import { readRootTemplates, resolveTemplateLinks } from './template-links.js';
import { readTemplateSources } from './template-sources.js';

/** Resolve built-in files from both source and installed dist directory layouts. */
export function builtInCatalogueDirectory(): string {
  return fileURLToPath(new URL('../../../../newspaper/', import.meta.url));
}

/** Read a JSON file while allowing an absent overlay file. */
async function readCatalogueFile(
  directory: string,
  name: string,
  optional = false
): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(directory, `${name}.json`), 'utf8'));
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Combine section arrays in filename order, allowing omitted overlay folders. */
async function readCatalogueSection(
  directory: string,
  name: string,
  optional = false
): Promise<unknown[] | undefined> {
  const sectionDirectory = path.join(directory, name);
  let files;
  try {
    files = await readdir(sectionDirectory, { withFileTypes: true });
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const sections = await Promise.all(
    files
      .filter((file) => file.isFile() && file.name.endsWith('.json'))
      .map((file) => file.name)
      .sort()
      .map(async (filename) =>
        z.array(z.unknown()).parse(await readCatalogueFile(sectionDirectory, filename.slice(0, -5)))
      )
  );
  return sections.flat();
}

/** Merge object defaults and keyed catalogue arrays; an overlay can disable choices by weight. */
function overlay(base: unknown, custom: unknown): unknown {
  if (custom === undefined) return base;
  if (
    Array.isArray(base) &&
    Array.isArray(custom) &&
    [...base, ...custom].every(
      (entry) => entry && typeof entry === 'object' && typeof entry.id === 'string'
    )
  ) {
    const entries = new Map(base.map((entry) => [entry.id, entry]));
    for (const entry of custom) entries.set(entry.id, overlay(entries.get(entry.id), entry));
    return [...entries.values()];
  }
  if (isRecord(base) && isRecord(custom))
    return {
      ...base,
      ...Object.fromEntries(Object.entries(custom).map(([key, value]) => [
        key, overlay(Object.hasOwn(base, key) ? base[key] : undefined, value),
      ])),
    };
  return custom;
}

const styleRuleKinds = [...variantStyleKinds, 'mixed'] as const;
type StyleRuleKind = typeof styleRuleKinds[number];
interface StyleRuleSource {
  rule: unknown;
  path: (string | number)[];
  kind?: StyleRuleKind;
}

/** Read rule entries with their file and local index for load diagnostics. */
function styleRuleEntries(value: unknown, file: string[], kind?: StyleRuleKind): StyleRuleSource[] {
  const result = z.array(z.unknown()).safeParse(value);
  if (!result.success)
    throw new z.ZodError(result.error.issues.map(issue => ({ ...issue, path: [...file, ...issue.path] })));
  return result.data.map((rule, index) => ({ rule, path: [...file, index], kind }));
}

/** Read style tags and ordered rule files, applying split entries after the flat overlay. */
async function readStyleCatalogue(directory: string, optional = false) {
  const folder = path.join(directory, 'styles');
  const legacy = optional ? await readCatalogueFile(directory, 'styles', true) : undefined;
  if (legacy !== undefined && !isRecord(legacy)) return { tags: legacy, rules: [] };
  const { rules: flatDocument, ...flatTags } = legacy ?? {};
  const tags = await Promise.all(variantStyleKinds.map(async name =>
    [name, await readCatalogueFile(folder, name, optional)] as const
  ));
  const splitRules = (await Promise.all(styleRuleKinds.map(async kind => {
    const name = `${kind}-rules`;
    const value = await readCatalogueFile(folder, name, optional);
    return value === undefined ? [] : styleRuleEntries(value, ['styles', `${name}.json`], kind);
  }))).flat();
  const flatRules = flatDocument === undefined ? [] : styleRuleEntries(flatDocument, ['styles.json', 'rules']);
  const replaced = new Set<StyleRuleSource>();
  for (const entry of splitRules) {
    const rule = entry.rule;
    if (!isRecord(rule) || typeof rule.id !== 'string') continue;
    const flat = flatRules.find(({ rule: base }) => isRecord(base) && base.id === rule.id);
    if (!flat) continue;
    entry.rule = overlay(flat.rule, rule);
    replaced.add(flat);
  }
  return {
    tags: overlay(flatTags, Object.fromEntries(tags.filter(([, value]) => value !== undefined))),
    rules: [...flatRules.filter(entry => !replaced.has(entry)), ...splitRules],
  };
}

/** Validate rule placement and report catalogue issues at the authored rule index. */
function parseLoadedCatalogue(input: unknown, sources: StyleRuleSource[]): EditorialConfig {
  const parsed = editorialConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new z.ZodError(parsed.error.issues.map(issue => {
      const [section, list, index, ...fields] = issue.path;
      const source = typeof index === 'number' ? sources[index] : undefined;
      return section === 'styles' && list === 'rules' && source
        ? { ...issue, path: [...source.path, ...fields] }
        : issue;
    }));
  }
  const issues: z.ZodIssue[] = [];
  parsed.data.styles?.rules.forEach(({ match }, index) => {
    const { kind, path } = sources[index];
    if (!kind) return;
    const kinds = variantStyleKinds.filter(key => match[key] !== undefined);
    if (kind === 'mixed' ? kinds.length >= 2 : kinds.length === 1 && kinds[0] === kind) return;
    issues.push({
      code: 'custom',
      path: [...path, 'match'],
      message: kind === 'mixed'
        ? 'Match at least two kinds of style tag.'
        : `Match only the ${kind} kind of style tag.`,
    });
  });
  if (issues.length > 0) throw new z.ZodError(issues);
  return parsed.data;
}

const compiledCatalogues = new WeakMap<EditorialConfig, Promise<CompiledEditorialExpressions>>();

/** Compile a catalogue only once; bytecode and expression slots stay out of saved runs. */
export function getEditorialExpressions(config: EditorialConfig): Promise<CompiledEditorialExpressions> {
  let prepared = compiledCatalogues.get(config);
  if (!prepared) {
    prepared = prepareEditorialExpressions(config);
    compiledCatalogues.set(config, prepared);
  }
  return prepared;
}

/** Remove design fields that the editorial catalogue does not use before validation. */
function withoutDesignFields(design: unknown, fields: readonly string[]): unknown {
  if (!isRecord(design)) return design;
  const settings = { ...design };
  for (const field of fields) delete settings[field];
  return settings;
}

/** Validate the entries and IDs in one masthead layer before merging. */
function checkMastheadRuleIds(rules: unknown, source: string): void {
  if (rules === undefined) return;
  if (!Array.isArray(rules)) throw new Error(`Expected an array of masthead rules in ${source}.`);
  const ids = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    if (!isRecord(rule) || typeof rule.id !== 'string' || !rule.id)
      throw new Error(`Expected a masthead rule id in ${source}, entry ${index + 1}.`);
    if (ids.has(rule.id))
      throw new Error(`Duplicate masthead rule id "${rule.id}" in ${source}.`);
    ids.add(rule.id);
  }
}

/** Load grouped mastheads, allowing a local folder to build on an older flat overlay. */
async function loadMastheadRules(builtIn: string, directory?: string): Promise<unknown> {
  const stock = await readCatalogueSection(builtIn, 'mastheads');
  checkMastheadRuleIds(stock, path.join(builtIn, 'mastheads'));
  if (!directory) return stock;
  const [flat, grouped] = await Promise.all([
    readCatalogueFile(directory, 'masthead-rules', true),
    readCatalogueSection(directory, 'mastheads', true),
  ]);
  checkMastheadRuleIds(flat, path.join(directory, 'masthead-rules.json'));
  checkMastheadRuleIds(grouped, path.join(directory, 'mastheads'));
  return overlay(stock, overlay(flat, grouped));
}

/** Load grouped built-ins and optional flat or grouped overrides, then validate together. */
export async function loadEditorialConfig(directory?: string): Promise<EditorialConfig> {
  const builtIn = builtInCatalogueDirectory();
  const result: Record<string, unknown> = { version: editorialConfigVersion };
  for (const name of ['defaults', 'constants', 'triggers', 'templates', 'pages', 'designs', 'civicTerms']) {
    const grouped = name === 'triggers' || name === 'templates' || name === 'designs';
    const file = name === 'civicTerms' ? 'civic-terms' : name;
    const base = name === 'templates'
      ? (await readTemplateSources(path.join(builtIn, name))).flatMap(source => source.templates)
      : grouped ? await readCatalogueSection(builtIn, name) : await readCatalogueFile(builtIn, file, name === 'civicTerms');
    let custom = directory ? await readCatalogueFile(directory, file, true) : undefined;
    if (directory && grouped)
      custom = overlay(custom, await readCatalogueSection(directory, name, true));
    if (name === 'designs' && Array.isArray(custom))
      custom = custom.map((design) => withoutDesignFields(design, ['label']));
    const settings = name === 'designs' && Array.isArray(base)
      ? base.map((design) => withoutDesignFields(design, ['assetDefinitions', 'label']))
      : base;
    const merged = overlay(settings, custom);
    // Ordinary files always exist, but a civic vocabulary file is optional in both layers.
    if (merged !== undefined) result[name] = merged;
  }
  const [stockRoots, customRoots] = await Promise.all([
    readRootTemplates(builtIn),
    directory ? readRootTemplates(directory) : undefined,
  ]);
  result.templates = resolveTemplateLinks(result.templates, new Map([...stockRoots, ...(customRoots ?? [])]));
  result.mastheadRules = await loadMastheadRules(builtIn, directory);
  const stock = await readStyleCatalogue(builtIn);
  const custom = directory ? await readStyleCatalogue(directory, true) : undefined;
  const tags = overlay(stock.tags, custom?.tags);
  const rules = [...stock.rules, ...(custom?.rules ?? [])];
  result.styles = isRecord(tags) ? { ...tags, rules: rules.map(({ rule }) => rule) } : tags;
  const config = parseLoadedCatalogue(result, rules);
  await getEditorialExpressions(config);
  return config;
}

/** Apply the same validation to merged files and serialized replay configurations. */
export async function parseEditorialConfig(input: unknown): Promise<EditorialConfig> {
  const config = editorialConfigSchema.parse(input);
  await getEditorialExpressions(config);
  return config;
}
