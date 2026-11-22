/** Read editable stock templates and the facts needed for writer briefs. */
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { voxAgentsRoot } from '../../agents/prompts/prompt-files.js';
import type { DeskStyle, DeskText } from '../../types/api.js';
import { asRecord } from '../../utils/guards.js';
import { errorMessage } from '../../utils/errors.js';
import { editorialCivicTermsSchema } from '../editorial/config/civic-terms.js';
import { editorialConstantsSchema } from '../editorial/config/constants.js';
import { builtInCatalogueDirectory } from '../editorial/config/load.js';
import { editorialTriggerRuleSchema, templateSchema, type AuthoredVariant, type EditorialTemplate, type EditorialTriggerRule } from '../editorial/config/schema.js';
import { resolveVariantStyle, styleCatalogueSchema, type StyleCatalogue } from '../editorial/config/styles.js';

export type DeskLink = AuthoredVariant['links'][number];
export type DeskTriggerDefinition = Pick<EditorialTriggerRule, 'id' | 'subject' | 'when' | 'values' | 'group'>;
export type DeskStyleCatalogue = Pick<StyleCatalogue, 'voice' | 'stance' | 'genre'>;

/** One authored variant with the revision of the original file entry. */
export interface DeskVariant {
  id: string;
  style?: DeskStyle;
  text: DeskText;
  settled: boolean;
  revision: string;
  links: DeskLink[];
  when?: string;
}

/** One editable template and the file containing it. */
export interface DeskTemplate extends Pick<EditorialTemplate, 'id' | 'tags' | 'triggers' | 'formats' | 'names' | 'when'> {
  file: string;
  triggerSummary: string;
  variants: DeskVariant[];
}

export interface DeskCatalogue {
  available: boolean;
  reason?: string;
  directory: string;
  writingPath: string;
  templates: DeskTemplate[];
  triggers: DeskTriggerDefinition[];
  styles?: DeskStyleCatalogue;
  constants?: { terms?: Record<string, string> };
  civicTerms?: { defaults: Record<string, string> };
}

/** Source locations can be overridden by isolated test fixtures. */
export interface DeskCatalogueOptions {
  directory?: string;
  writingPath?: string;
}

/** A desk operation failed with an HTTP status for the caller. */
export class DeskError extends Error {
  /** Give the route a status without coupling desk code to Express. */
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DeskError';
  }
}

export const deskWritingRulesPath = path.resolve(voxAgentsRoot, '../docs/developers/vox-agents/newspaper/writing.md');

/** Read a JSON asset using the same format as the editorial loader. */
async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Read grouped files in their stock order and retain each filename. */
async function readSection(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name).sort();
}

/** Report stock files that the desk cannot use in this checkout. */
async function requireWritable(target: string, label: string, directory = false) {
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    throw new Error(label + (missing ? ' is missing.' : ' cannot be read.'));
  }
  if (directory ? !info.isDirectory() : !info.isFile()) throw new Error(label + ' has the wrong type.');
  try {
    if (!(info.mode & 0o222)) throw new Error('Read-only');
    await access(target, fsConstants.W_OK);
  } catch {
    throw new Error(label + ' is read-only.');
  }
}

/** Hash the authored entry before applying schema defaults. */
export function deskVariantRevision(raw: unknown): string {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex');
}

/** Resolve a known stock template's source file. */
export function deskTemplateFilePath(catalogue: Pick<DeskCatalogue, 'directory'>, template: Pick<DeskTemplate, 'file'>): string {
  return path.join(catalogue.directory, 'templates', template.file);
}

/** Resolve the trigger definitions in the order named by the template. */
export function deskTriggers(template: DeskTemplate, catalogue: DeskCatalogue): DeskTriggerDefinition[] {
  return template.triggers.flatMap(id => {
    const trigger = catalogue.triggers.find(candidate => candidate.id === id);
    return trigger ? [trigger] : [];
  });
}

/** Keep editable text and the raw revision without keeping the entire source in memory. */
function readTemplate(raw: unknown, template: EditorialTemplate, file: string): DeskTemplate {
  const { id, tags, triggers, formats, names, when } = template;
  const rawVariants = asRecord(raw)?.variants as unknown[];
  return {
    id, tags, triggers, formats, names, when, file,
    triggerSummary: triggers.map(id => id.replaceAll('-', ' ')).join(', '),
    variants: template.variants.map((variant, index) => ({
      id: variant.id,
      style: resolveVariantStyle(variant),
      text: { headline: variant.headline, subheadline: variant.subheadline, byline: variant.byline, body: variant.body },
      settled: variant.settled === true,
      revision: deskVariantRevision(rawVariants[index]),
      when: variant.when,
      links: variant.links,
    })),
  };
}

/** Read and validate the author's stock files and assemble the desk catalogue. */
export async function readDeskCatalogue(options: DeskCatalogueOptions = {}): Promise<DeskCatalogue> {
  const directory = path.resolve(options.directory ?? builtInCatalogueDirectory());
  const writingPath = path.resolve(options.writingPath ?? deskWritingRulesPath);
  const root = { directory, writingPath };
  const templatesDirectory = path.join(directory, 'templates');
  const triggersDirectory = path.join(directory, 'triggers');
  try {
    await requireWritable(templatesDirectory, 'The stock templates folder', true);
    await requireWritable(writingPath, 'The writing guide');
    const templates: DeskTemplate[] = [];
    const seenTemplates = new Set<string>();
    const files = await readSection(templatesDirectory);
    if (!files.length) throw new Error('No stock template files were found.');
    for (const file of files) {
      const location = path.join(templatesDirectory, file);
      await requireWritable(location, 'Template file ' + file);
      const raw = z.array(z.unknown()).parse(await readJson(location));
      const parsed = z.array(templateSchema).parse(raw);
      for (const [index, template] of parsed.entries()) {
        if (seenTemplates.has(template.id)) throw new Error('Duplicate template ID: ' + template.id);
        seenTemplates.add(template.id);
        if (template.mode === 'llmOnly' || !template.variants.length) continue;
        const variantIds = new Set(template.variants.map(variant => variant.id));
        if (variantIds.size !== template.variants.length) throw new Error('Duplicate variant IDs in ' + template.id);
        templates.push(readTemplate(raw[index], template, file));
      }
    }
    const byId = new Map<string, DeskTriggerDefinition>();
    for (const file of await readSection(triggersDirectory)) {
      const triggers = z.array(editorialTriggerRuleSchema).parse(await readJson(path.join(triggersDirectory, file)));
      for (const trigger of triggers) {
        if (byId.has(trigger.id)) throw new Error('Duplicate trigger ID: ' + trigger.id);
        byId.set(trigger.id, trigger);
      }
    }
    /** Resolve a stock asset inside this checkout. */
    const readFileInCatalogue = (file: string) => readJson(path.join(directory, file));
    const [voice, stance, genre, constants, civicTerms] = await Promise.all([
      readFileInCatalogue('styles/voice.json').then(value => styleCatalogueSchema.shape.voice.parse(value)),
      readFileInCatalogue('styles/stance.json').then(value => styleCatalogueSchema.shape.stance.parse(value)),
      readFileInCatalogue('styles/genre.json').then(value => styleCatalogueSchema.shape.genre.parse(value)),
      readFileInCatalogue('constants.json').then(value => editorialConstantsSchema.parse(value)),
      readFileInCatalogue('civic-terms.json').then(value => editorialCivicTermsSchema.parse(value)),
    ]);
    return {
      ...root, available: true, templates, triggers: [...byId.values()],
      styles: { voice, stance, genre }, constants: { terms: constants.terms }, civicTerms: { defaults: civicTerms.defaults },
    };
  } catch (error) {
    return { ...root, available: false, reason: errorMessage(error), templates: [], triggers: [] };
  }
}
