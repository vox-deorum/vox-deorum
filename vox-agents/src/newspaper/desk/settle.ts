/** Validate and atomically replace the editable fields of one stock variant. */
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { applyEdits, modify, type FormattingOptions, type JSONPath } from 'jsonc-parser';
import type { DeskRef, DeskText } from '../../types/api.js';
import { errorMessage } from '../../utils/errors.js';
import { asRecord, isRecord } from '../../utils/guards.js';
import { loadEditorialConfig } from '../editorial/config/load.js';
import { templateSchema } from '../editorial/config/schema.js';
import { findDeskVariant } from './brief.js';
import { DeskError, deskTemplateFilePath, deskVariantRevision, readDeskCatalogue, type DeskCatalogueOptions } from './catalogue.js';
import { templateVariables, variantWarnings } from './variables.js';

export interface DeskSettleOptions extends DeskCatalogueOptions {
  /** Override full catalogue validation for a test. */
  validate?: () => Promise<unknown>;
  /** Notify the caller once the file passes validation. */
  onChange?: (ref: DeskRef) => void;
}

let pendingWrite: Promise<void> = Promise.resolve();

/** Run the next write even if the previous one failed. */
function serializeWrite(write: () => Promise<void>): Promise<void> {
  const result = pendingWrite.then(write);
  pendingWrite = result.catch(() => {});
  return result;
}

/** Reparse the template file, which may have changed since the catalogue was loaded. */
function readTemplates(text: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Report stale or malformed on-disk data through the same error.
  }
  throw new DeskError(409, 'The template file is invalid. Reload it before saving.');
}

/** Choose indentation and line endings already used by the stock file. */
function formattingFor(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ';
  return { insertSpaces: !indent.startsWith('\t'), tabSize: indent.length, eol };
}

/** Replace a file if it still has the expected contents. */
async function writeAtomic(file: string, expected: string, content: string): Promise<void> {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    if (await readFile(file, 'utf8') !== expected)
      throw new DeskError(409, 'The template file changed while the save was being prepared. Reload and try again.');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Require printable text and use an empty optional field to remove it. */
function normalizeText(text: DeskText): DeskText {
  const body = text.body.filter(paragraph => paragraph.trim().length > 0);
  if (!text.headline.trim()) throw new DeskError(400, 'The headline cannot be empty.');
  if (!body.length) throw new DeskError(400, 'The body needs at least one paragraph.');
  return {
    headline: text.headline, body,
    subheadline: text.subheadline?.trim() ? text.subheadline : undefined,
    byline: text.byline?.trim() ? text.byline : undefined,
  };
}

/** Edit one variant, validate the catalogue and restore the file on rejection. */
async function updateVariant(ref: DeskRef, revision: string, options: DeskSettleOptions, text?: DeskText) {
  const catalogue = await readDeskCatalogue(options);
  if (!catalogue.available) throw new DeskError(503, catalogue.reason ?? 'The stock newspaper catalogue is unavailable.');
  const found = findDeskVariant(catalogue, ref);
  if (!found) throw new DeskError(404, 'Stock variant not found.');
  const { template, variant } = found;
  if (variant.revision !== revision) throw new DeskError(409, 'This variant changed since it was opened. Reload it and try again.');

  const file = deskTemplateFilePath(catalogue, template);
  const original = await readFile(file, 'utf8');
  const raw = readTemplates(original);
  const templateIndex = raw.findIndex(item => isRecord(item) && item.id === ref.templateId);
  const variants = asRecord(raw[templateIndex])?.variants;
  const variantIndex = Array.isArray(variants) ? variants.findIndex(item => isRecord(item) && item.id === ref.variantId) : -1;
  const entry = Array.isArray(variants) ? asRecord(variants[variantIndex]) : undefined;
  if (!entry || deskVariantRevision(entry) !== revision)
    throw new DeskError(409, 'This variant changed on disk. Reload it and try again.');

  let fields: Record<string, string | string[] | boolean | undefined> = { settled: undefined };
  if (text) {
    const copy = normalizeText(text);
    const variables = templateVariables(template, catalogue, variant);
    const errors = variantWarnings(copy, variant, variables).filter(warning => warning.code !== 'may-be-empty');
    if (errors.length) throw new DeskError(400, errors.map(error => error.message).join(' '));
    fields = { ...copy, settled: true };
  }

  let edited = original;
  const formattingOptions = formattingFor(original);
  const base: JSONPath = [templateIndex, 'variants', variantIndex];
  for (const [field, value] of Object.entries(fields)) {
    if (JSON.stringify(entry[field]) !== JSON.stringify(value))
      edited = applyEdits(edited, modify(edited, [...base, field], value, { formattingOptions }));
  }
  if (edited !== original) {
    const parsed = templateSchema.safeParse(readTemplates(edited)[templateIndex]);
    if (!parsed.success) throw new DeskError(400, errorMessage(parsed.error));
    await writeAtomic(file, original, edited);
    try {
      if (options.validate) await options.validate();
      else await loadEditorialConfig(options.directory);
    } catch (error) {
      await writeAtomic(file, edited, original);
      throw new DeskError(400, 'The catalogue could not load the change: ' + errorMessage(error));
    }
  }
  options.onChange?.(ref);
}

/** Save a new version of the copy and mark it settled. */
export function settleVariant(ref: DeskRef, text: DeskText, revision: string, options: DeskSettleOptions = {}): Promise<void> {
  return serializeWrite(() => updateVariant(ref, revision, options, text));
}

/** Remove the review mark without editing the copy. */
export function unsettleVariant(ref: DeskRef, revision: string, options: DeskSettleOptions = {}): Promise<void> {
  return serializeWrite(() => updateVariant(ref, revision, options));
}
