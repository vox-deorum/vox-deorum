/** Validate and save stock variants to their source and companion files. */
import { randomUUID } from 'node:crypto';
import { constants, copyFile, link, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { applyEdits, modify, type FormattingOptions, type JSONPath } from 'jsonc-parser';
import type { DeskRef, DeskSettleManyRequest, DeskStyle, DeskStyleRequest, DeskText, DeskVariable } from '../../types/api.js';
import { errorMessage } from '../../utils/errors.js';
import { asRecord, isRecord } from '../../utils/guards.js';
import { variantStyleKinds } from '../contracts/style.js';
import { loadEditorialConfig } from '../editorial/config/load.js';
import { templateSchema } from '../editorial/config/schema.js';
import { mergeTemplateVariants, templateVariantIds, variantCompanionFilename } from '../editorial/config/template-sources.js';
import { deskVariantStyle, findDeskVariant } from './brief.js';
import { DeskError, deskTemplateFilePath, deskVariantRevision, readDeskCatalogue, type DeskCatalogueOptions, type DeskVariant } from './catalogue.js';
import { templateVariables, variantWarnings } from './variables.js';

export interface DeskSettleOptions extends DeskCatalogueOptions {
  /** Override full catalogue validation for a test. */
  validate?: () => Promise<unknown>;
  /** Notify the caller once the file passes validation. */
  onChange?: (ref: DeskRef) => void;
}

/** The primary copy and the new sibling copies saved with it. */
interface DeskCopyChange {
  primary: DeskText;
  siblings: DeskText[];
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

/** Read a companion that may not have been created yet. */
async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Publish a new companion without replacing a file created by another editor. */
async function publishNewFile(temporary: string, file: string): Promise<void> {
  try {
    try {
      await link(temporary, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Some filesystems do not support hard links. An exclusive copy still protects other edits.
      if (!code || !['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code)) throw error;
      await copyFile(temporary, file, constants.COPYFILE_EXCL);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new DeskError(409, 'Another editor created the companion file. Reload and try again.');
    throw error;
  }
}

/** Publish a file if it still has the expected contents, or remove it when rolling back a creation. */
async function writeAtomic(file: string, expected: string | undefined, content: string | undefined): Promise<void> {
  if (await readOptional(file) !== expected)
    throw new DeskError(409, 'A template file changed while the save was being prepared. Reload and try again.');
  if (content === undefined) {
    await rm(file);
    return;
  }
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    if (expected === undefined) {
      await publishNewFile(temporary, file);
    } else {
      if (await readOptional(file) !== expected)
        throw new DeskError(409, 'A template file changed while the save was being prepared. Reload and try again.');
      await rename(temporary, file);
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

interface StockFileEdit {
  file: string;
  before: string | undefined;
  after: string;
}

/** Publish the files and restore any already written if a write or validation fails. */
async function saveFiles(edits: StockFileEdit[], options: DeskSettleOptions): Promise<void> {
  const applied: StockFileEdit[] = [];
  try {
    for (const edit of edits) {
      await writeAtomic(edit.file, edit.before, edit.after);
      applied.push(edit);
    }
    try {
      if (options.validate) await options.validate();
      else await loadEditorialConfig(options.directory);
    } catch (error) {
      throw new DeskError(400, 'The catalogue could not load the change: ' + errorMessage(error));
    }
  } catch (error) {
    const failures: string[] = [];
    for (const edit of applied.reverse()) {
      try {
        await writeAtomic(edit.file, edit.after, edit.before);
      } catch (rollbackError) {
        failures.push(`${edit.file}: ${errorMessage(rollbackError)}`);
      }
    }
    if (failures.length) throw new DeskError(500, `${errorMessage(error)} Could not restore: ${failures.join('; ')}`);
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

/** Reject a copy that uses an unknown placeholder or drops a kept link. */
function requireValidCopy(copy: DeskText, variant: DeskVariant, variables: readonly DeskVariable[]): void {
  const errors = variantWarnings(copy, variant, variables).filter(warning => warning.code !== 'may-be-empty');
  if (errors.length) throw new DeskError(400, errors.map(error => error.message).join(' '));
}

/** Combine the files for a save and report incompatible edits since the desk loaded them. */
function mergeForSave(baseText: string, companionText: string | undefined, companionName: string): unknown[] {
  try {
    return mergeTemplateVariants(readTemplates(baseText), readTemplates(companionText ?? '[]'), companionName);
  } catch (error) {
    if (error instanceof DeskError) throw error;
    throw new DeskError(409, `Reload the catalogue before saving. ${errorMessage(error)}`);
  }
}

/** Clone the source row's metadata and replace every copy field. */
function siblingRow(source: Record<string, unknown>, id: string, text: DeskText): Record<string, unknown> {
  const row = { ...source, ...text, id, settled: true };
  if (text.subheadline === undefined) delete row.subheadline;
  if (text.byline === undefined) delete row.byline;
  return row;
}

/** Append sibling rows without reformatting unaffected entries in the companion. */
function appendSiblings(text: string, templateId: string, siblings: Record<string, unknown>[]): string {
  const raw = readTemplates(text);
  const index = raw.findIndex(item => asRecord(item)?.id === templateId);
  const formattingOptions = formattingFor(text);
  if (index === -1)
    return applyEdits(text, modify(text, [raw.length], { id: templateId, variants: siblings }, { formattingOptions }));
  const variants = asRecord(raw[index])?.variants;
  const count = Array.isArray(variants) ? variants.length : 0;
  return siblings.reduce((edited, row, offset) => applyEdits(edited,
    modify(edited, [index, 'variants', count + offset], row, { formattingOptions })), text);
}

/** Edit the primary in its own file and save any new siblings in the companion. */
async function updateVariant(ref: DeskRef, revision: string, options: DeskSettleOptions, change?: DeskCopyChange | DeskStyle) {
  const catalogue = await readDeskCatalogue(options);
  if (!catalogue.available) throw new DeskError(503, catalogue.reason ?? 'The stock newspaper catalogue is unavailable.');
  const found = findDeskVariant(catalogue, ref);
  if (!found) throw new DeskError(404, 'Stock variant not found.');
  const { template, variant } = found;
  if (variant.revision !== revision) throw new DeskError(409, 'This variant changed since it was opened. Reload it and try again.');

  const baseFile = deskTemplateFilePath(catalogue, template);
  const companionName = variantCompanionFilename(template.file);
  const companionFile = deskTemplateFilePath(catalogue, { file: companionName });
  const [baseText, companionText] = await Promise.all([readFile(baseFile, 'utf8'), readOptional(companionFile)]);
  const inCompanion = variant.file === companionName;
  const original = inCompanion ? companionText ?? '[]\n' : baseText;
  const raw = readTemplates(original);
  const templateIndex = raw.findIndex(item => isRecord(item) && item.id === ref.templateId);
  const variants = asRecord(raw[templateIndex])?.variants;
  const variantIndex = Array.isArray(variants) ? variants.findIndex(item => isRecord(item) && item.id === ref.variantId) : -1;
  const entry = Array.isArray(variants) ? asRecord(variants[variantIndex]) : undefined;
  if (!entry || deskVariantRevision(entry) !== revision)
    throw new DeskError(409, 'This variant changed on disk. Reload it and try again.');

  let fields: Record<string, string | string[] | boolean | undefined> = { settled: undefined };
  const siblingRows: Record<string, unknown>[] = [];
  if (change && 'primary' in change) {
    const { primary, siblings } = change;
    if (siblings.length > 0 && variant.settled)
      throw new DeskError(409, 'This variant is already settled. Reopen it before adding copies.');
    const variables = templateVariables(template, catalogue, variant);
    const copy = normalizeText(primary);
    requireValidCopy(copy, variant, variables);
    fields = { ...copy, settled: true };
    if (siblings.length) {
      const templates = mergeForSave(baseText, companionText, companionName);
      const combined = templates.map(asRecord).find(item => item?.id === ref.templateId);
      if (!combined) throw new DeskError(409, 'The template changed on disk. Reload it and try again.');
      const used = new Set(templateVariantIds(combined));
      let next = 1;
      for (const source of siblings) {
        const siblingCopy = normalizeText(source);
        requireValidCopy(siblingCopy, variant, variables);
        while (used.has(`${variant.id}-${next}`)) next++;
        siblingRows.push(siblingRow(entry, `${variant.id}-${next++}`, siblingCopy));
      }
    }
  } else if (change) {
    const current = deskVariantStyle(variant);
    for (const kind of variantStyleKinds) {
      if (!catalogue.styles?.[kind].some(tag => tag.id === change[kind]))
        throw new DeskError(400, `Unknown ${kind} tag "${change[kind]}".`);
    }
    if (variantStyleKinds.every(kind => change[kind] === current[kind])) return;
    fields = { ...change };
  }

  let edited = original;
  const formattingOptions = formattingFor(original);
  const base: JSONPath = [templateIndex, 'variants', variantIndex];
  for (const [field, value] of Object.entries(fields)) {
    if (JSON.stringify(entry[field]) !== JSON.stringify(value))
      edited = applyEdits(edited, modify(edited, [...base, field], value, { formattingOptions }));
  }
  const nextBase = inCompanion ? baseText : edited;
  let nextCompanion = inCompanion ? edited : companionText;
  if (siblingRows.length) nextCompanion = appendSiblings(nextCompanion ?? '[]\n', ref.templateId, siblingRows);
  const edits: StockFileEdit[] = [];
  if (nextBase !== baseText) edits.push({ file: baseFile, before: baseText, after: nextBase });
  if (nextCompanion !== undefined && nextCompanion !== companionText)
    edits.push({ file: companionFile, before: companionText, after: nextCompanion });
  if (edits.length) {
    const combined = mergeForSave(nextBase, nextCompanion, companionName);
    const parsed = templateSchema.safeParse(combined.find(item => asRecord(item)?.id === ref.templateId));
    if (!parsed.success) throw new DeskError(400, errorMessage(parsed.error));
    await saveFiles(edits, options);
  }
  options.onChange?.(ref);
}

/** Save a new version of the copy and mark it settled. */
export function settleVariant(ref: DeskRef, text: DeskText, revision: string, options: DeskSettleOptions = {}): Promise<void> {
  return serializeWrite(() => updateVariant(ref, revision, options, { primary: text, siblings: [] }));
}

/** Save the primary copy and add each sibling as a settled variant in the companion. */
export function settleManyVariants(
  ref: DeskRef,
  request: DeskSettleManyRequest,
  options: DeskSettleOptions = {},
): Promise<void> {
  if (request.siblings.length === 0)
    return Promise.reject(new DeskError(400, 'A multiple settle needs at least one sibling copy.'));
  return serializeWrite(() => updateVariant(ref, request.revision, options, {
    primary: request.primary,
    siblings: request.siblings,
  }));
}

/** Remove the review mark without editing the copy. */
export function unsettleVariant(ref: DeskRef, revision: string, options: DeskSettleOptions = {}): Promise<void> {
  return serializeWrite(() => updateVariant(ref, revision, options));
}

/** Change only the style tags of an authored variant. */
export function updateVariantStyle(ref: DeskRef, request: DeskStyleRequest, options: DeskSettleOptions = {}): Promise<void> {
  return serializeWrite(() => updateVariant(ref, request.revision, options, request.style));
}
