/** Load grouped catalogue files, apply local overrides, and validate references together. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { isRecord } from '../../../utils/guards.js';
import { variantStyleAxes } from '../../contracts/style.js';
import { prepareEditorialExpressions, type CompiledEditorialExpressions } from './expressions.js';
import { editorialConfigSchema, type EditorialConfig } from './schema.js';

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

/** Assemble the style catalogue, applying split overrides after any legacy flat overlay. */
async function readStyleCatalogue(directory: string, optional = false): Promise<unknown> {
  const folder = path.join(directory, 'styles');
  const files = await Promise.all([...variantStyleAxes, 'rules'].map(async name =>
    [name, await readCatalogueFile(folder, name, optional)] as const
  ));
  const split = Object.fromEntries(files.filter(([, value]) => value !== undefined));
  if (!optional) return split;
  const legacy = await readCatalogueFile(directory, 'styles', true);
  return legacy === undefined || isRecord(legacy) ? overlay(legacy, split) : legacy;
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

/** Load grouped built-ins and optional flat or grouped overrides, then validate together. */
export async function loadEditorialConfig(directory?: string): Promise<EditorialConfig> {
  const builtIn = builtInCatalogueDirectory();
  const result: Record<string, unknown> = { version: 1 };
  for (const name of ['defaults', 'constants', 'triggers', 'templates', 'pages', 'designs']) {
    const grouped = name === 'triggers' || name === 'templates' || name === 'designs';
    const base = grouped
      ? await readCatalogueSection(builtIn, name)
      : await readCatalogueFile(builtIn, name);
    let custom = directory ? await readCatalogueFile(directory, name, true) : undefined;
    if (directory && grouped)
      custom = overlay(custom, await readCatalogueSection(directory, name, true));
    result[name] = overlay(base, custom);
  }
  result.styles = overlay(
    await readStyleCatalogue(builtIn),
    directory ? await readStyleCatalogue(directory, true) : undefined
  );
  return parseEditorialConfig(result);
}

/** Apply the same validation to merged files and serialized replay configurations. */
export async function parseEditorialConfig(input: unknown): Promise<EditorialConfig> {
  const config = editorialConfigSchema.parse(input);
  await getEditorialExpressions(config);
  return config;
}
