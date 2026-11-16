/** Parse the flat catalogue, overlay optional local files, and validate references together. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { presentationSchema } from '../contracts/design.js';
import { newspaperLayoutVariantSchema, linkTargetSchema } from '../contracts/issue.js';
import { getNewspaperAsset } from '../renderer/assets.js';
import { conditionSchema } from './conditions.js';
import { weightSchema } from './weights.js';

const eligibleSchema = z.object({ condition: conditionSchema.optional(), weight: weightSchema });
/** Authored prose uses named placeholders and explicit typed link destinations. */
export const authoredVariantSchema = eligibleSchema.extend({
  id: z.string().min(1), headline: z.string().min(1), body: z.array(z.string().min(1)).min(1),
  links: z.array(z.object({ placeholder: z.string().min(1), label: z.string().min(1), target: linkTargetSchema })).default([]),
});
export type AuthoredVariant = z.infer<typeof authoredVariantSchema>;
/** Available measured detectors and their numeric tuning parameters. */
const triggerSchema = z.object({
  id: z.string().min(1), detector: z.enum(['cityContrast', 'tradeConcentration', 'foreignCulture', 'incomingWar', 'deal', 'peace', 'cityRecovery']),
  condition: conditionSchema.optional(), threshold: z.number().nonnegative(), scale: z.number().positive(),
  tags: z.array(z.string().min(1)),
});
/** Templates explicitly name supported detectors and compatible authored composites. */
const templateSchema = eligibleSchema.extend({
  id: z.string().min(1), triggerIds: z.array(z.string().min(1)).min(1), tags: z.array(z.string().min(1)),
  mode: z.enum(['authored', 'llmOnly']).default('authored'),
  short: z.boolean().default(false), variants: z.array(authoredVariantSchema),
  compositeOf: z.array(z.string().min(1)).default([]),
});
export type EditorialTemplate = z.infer<typeof templateSchema>;
const layoutSchema = eligibleSchema.extend({ id: z.string().min(1), variant: newspaperLayoutVariantSchema });
const designSchema = eligibleSchema.extend({
  id: z.string().min(1), version: z.string().min(1), title: z.string().min(1), presentation: presentationSchema,
  layouts: z.array(layoutSchema).min(1), pageLabels: z.record(z.string(), z.string()).default({}),
});
export type EditorialDesign = z.infer<typeof designSchema>;
/** Complete effective catalogue snapshot stored in editorial decisions. */
export const editorialConfigSchema = z.object({
  version: z.literal(1),
  defaults: z.object({
    frequencyStandardTurns: z.number().int().positive(), llmEnabled: z.boolean(),
    publicationTitle: z.string().min(1), maxItems: z.number().int().positive(), frontPageItems: z.number().int().min(2),
    importanceMax: z.number().positive(), decayPerTurn: z.number().min(0).max(1),
    seriesWeight: z.number().nonnegative(), noveltyBonus: z.number().nonnegative(), varietyBonus: z.number().nonnegative(),
    designStickiness: z.number().min(0).max(1),
    feedback: z.object({ window: z.number().int().positive(), series: z.number().nonnegative(), tag: z.number().nonnegative(), bound: z.number().nonnegative() }),
  }),
  triggers: z.array(triggerSchema), templates: z.array(templateSchema),
  pages: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), tags: z.array(z.string()),
    minimum: z.number().int().positive(), order: z.number(), front: z.boolean().default(false), condition: conditionSchema.optional() })).min(1),
  designs: z.array(designSchema).min(1),
}).superRefine((config, ctx) => {
  // Validate all catalogue identifiers before resolving references.
  for (const section of ['triggers', 'templates', 'pages', 'designs'] as const) {
    const ids = new Set<string>();
    config[section].forEach((entry, index) => {
      if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', path: [section, index, 'id'], message: `Duplicate ${section} id ${entry.id}` });
      ids.add(entry.id);
    });
  }
  const triggerIds = new Set(config.triggers.map(entry => entry.id));
  const templateIds = new Set(config.templates.map(entry => entry.id));
  const pageIds = new Set(config.pages.map(entry => entry.id));
  if (config.pages.filter(page => page.front).length !== 1) ctx.addIssue({ code: 'custom', path: ['pages'], message: 'Exactly one front page is required.' });
  config.pages.forEach((page, index) => {
    if (page.front && page.condition && page.condition.op !== 'always') ctx.addIssue({ code: 'custom', path: ['pages', index], message: 'The front page must be unconditional.' });
  });
  config.templates.forEach((template, index) => {
    for (const id of template.triggerIds) if (!triggerIds.has(id)) ctx.addIssue({ code: 'custom', path: ['templates', index], message: `Unknown trigger ${id}` });
    for (const id of template.compositeOf) if (!templateIds.has(id) || id === template.id) ctx.addIssue({ code: 'custom', path: ['templates', index], message: `Invalid composite template ${id}` });
    if (new Set(template.variants.map(variant => variant.id)).size !== template.variants.length) ctx.addIssue({ code: 'custom', path: ['templates', index], message: 'Variant ids must be unique.' });
  });
  config.designs.forEach((design, index) => {
    for (const variant of ['ordinary', 'breaking']) {
      if (!design.layouts.some(layout => layout.variant === variant && (!layout.condition || layout.condition.op === 'always') &&
        layout.weight.base > 0 && layout.weight.adjustments.length === 0)) ctx.addIssue({ code: 'custom', path: ['designs', index], message: `Every design requires an unconditional positive constant ${variant} layout.` });
    }
    if (new Set(design.layouts.map(layout => layout.id)).size !== design.layouts.length) ctx.addIssue({ code: 'custom', path: ['designs', index], message: 'Layout ids must be unique.' });
    for (const id of Object.keys(design.pageLabels)) if (!pageIds.has(id)) ctx.addIssue({ code: 'custom', path: ['designs', index, 'pageLabels'], message: `Unknown page ${id}` });
    const { tokens, assets } = design.presentation;
    for (const id of [tokens?.bodyFontAssetId, tokens?.headingFontAssetId, tokens?.mastheadFontAssetId]) if (id && getNewspaperAsset(id)?.kind !== 'font') ctx.addIssue({ code: 'custom', path: ['designs', index], message: `Unknown font asset ${id}` });
    if (assets?.ornamentAssetId && getNewspaperAsset(assets.ornamentAssetId)?.kind !== 'ornament') ctx.addIssue({ code: 'custom', path: ['designs', index], message: `Unknown ornament asset ${assets.ornamentAssetId}` });
  });
});
export type EditorialConfig = z.infer<typeof editorialConfigSchema>;

/** Resolve built-in files from both source and installed dist directory layouts. */
export function builtInCatalogueDirectory(): string {
  return fileURLToPath(new URL('../../../newspaper/catalogue/', import.meta.url));
}

/** Read a JSON file while allowing an absent overlay file. */
async function readCatalogueFile(directory: string, name: string, optional = false): Promise<unknown> {
  try { return JSON.parse(await readFile(path.join(directory, `${name}.json`), 'utf8')); }
  catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Merge object defaults and keyed catalogue arrays; an overlay can disable choices by weight. */
function overlay(base: unknown, custom: unknown): unknown {
  if (custom === undefined) return base;
  if (Array.isArray(base) && Array.isArray(custom) && [...base, ...custom].every(entry =>
    entry && typeof entry === 'object' && typeof entry.id === 'string')) {
    const entries = new Map(base.map(entry => [entry.id, entry]));
    for (const entry of custom) entries.set(entry.id, overlay(entries.get(entry.id), entry));
    return [...entries.values()];
  }
  if (base && custom && typeof base === 'object' && typeof custom === 'object' && !Array.isArray(custom)) {
    const result = { ...base } as Record<string, unknown>;
    for (const [key, value] of Object.entries(custom)) result[key] = overlay(result[key], value);
    return result;
  }
  return custom;
}

/** Load and jointly validate the effective built-in and configured flat catalogue. */
export async function loadEditorialConfig(directory?: string): Promise<EditorialConfig> {
  const result: Record<string, unknown> = { version: 1 };
  for (const name of ['defaults', 'triggers', 'templates', 'pages', 'designs']) {
    const base = await readCatalogueFile(builtInCatalogueDirectory(), name);
    result[name] = overlay(base, directory ? await readCatalogueFile(directory, name, true) : undefined);
  }
  return editorialConfigSchema.parse(result);
}
