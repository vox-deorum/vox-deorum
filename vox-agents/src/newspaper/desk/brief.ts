/**
 * @module newspaper/desk/brief
 *
 * Builds the self-contained writer brief for one batch of variants that share a
 * voice, stance and genre. The view carries data only; the prose lives in
 * `prompts/newspaper-writer.md`, and the writing rules are read from
 * `docs/developers/vox-agents/newspaper/writing.md` each time a brief is built.
 */
import fs from 'node:fs';
import type { DeskRef, DeskStyle, DeskText, DeskVariable } from '../../types/api.js';
import { renderSystemPrompt } from '../../agents/prompts/prompt-files.js';
import { defaultVariantStyle } from '../editorial/config/styles.js';
import { chunkDeskVariants, deskChunkSize, deskRefKey } from './batch.js';
import { deskTriggers, deskWritingRulesPath, type DeskCatalogue, type DeskTemplate, type DeskVariant } from './catalogue.js';
import { normalizeParagraphs } from './paragraphs.js';
import { deskTextPlaceholders, templateVariables } from './variables.js';

/** Examples from other templates per task template, before deduplication. */
const relatedExamplesPerTemplate = 2;
/** Examples from other templates in one request. */
const relatedExampleLimit = 6;

/** A trigger rendered for the brief. */
interface BriefTrigger {
  id: string;
  subject: string;
  when: string;
  values?: string;
  group?: string;
}

/** One variant's block in the writer brief. */
interface BriefVariant {
  templateId: string;
  variantId: string;
  tags: string;
  triggerSummary: string;
  hasTriggers: boolean;
  triggers: BriefTrigger[];
  templateWhen: string;
  variantWhen: string;
  hasFormats: boolean;
  formats: { name: string; format: string }[];
  names: string;
  hasLinks: boolean;
  links: { placeholder: string; keep: boolean }[];
  variables: DeskVariable[];
  current: DeskText;
}

/** One example flattened for the prompt's section loop. */
interface BriefExample extends DeskRef, DeskStyle, DeskText {
  when?: string;
}

/** Data handed to the newspaper-writer prompt template. */
export interface DeskBriefView {
  choices: number;
  writingRules: string;
  style: DeskStyle & {
    voiceGuidance?: string;
    stanceGuidance?: string;
    genreGuidance?: string;
  };
  hasExamples: boolean;
  examples: BriefExample[];
  variants: BriefVariant[];
}

/** Resolve a variant's explicit style, filling in the catalogue defaults. */
export function deskVariantStyle(variant: DeskVariant): DeskStyle {
  return variant.style ?? defaultVariantStyle;
}

/** Find a template in the catalogue by its case-sensitive ID. */
export function findDeskTemplate(catalogue: DeskCatalogue, templateId: string): DeskTemplate | undefined {
  return catalogue.templates.find(template => template.id === templateId);
}

/** Find a variant inside its template by its case-sensitive ID. */
export function findDeskVariant(
  catalogue: DeskCatalogue,
  ref: DeskRef,
): { template: DeskTemplate; variant: DeskVariant } | undefined {
  const template = findDeskTemplate(catalogue, ref.templateId);
  const variant = template?.variants.find(candidate => candidate.id === ref.variantId);
  return template && variant ? { template, variant } : undefined;
}

/** Join authored conditions for a brief. */
function conditions(source?: string | string[]): string {
  return Array.isArray(source) ? source.join(' and ') : source ?? 'none';
}

/** Group unsettled refs by voice, stance and genre, then split each group into chunks. */
export function chunkByStyle(
  refs: readonly DeskRef[],
  catalogue: DeskCatalogue,
  size: number = deskChunkSize,
): DeskRef[][] {
  const entries = refs.flatMap(ref => {
    const found = findDeskVariant(catalogue, ref);
    return found && !found.variant.settled ? [{ ref, style: deskVariantStyle(found.variant) }] : [];
  });
  return chunkDeskVariants(entries, size).map(chunk => chunk.map(entry => entry.ref));
}

/** Format settled copy with the style and condition under which it was written. */
function briefExample(templateId: string, variant: DeskVariant): BriefExample {
  return {
    templateId,
    variantId: variant.id,
    ...deskVariantStyle(variant),
    when: variant.when,
    ...variant.text,
    body: normalizeParagraphs(variant.text.body),
  };
}

/** Pick settled examples from other templates by shared style and topic. */
function pickRelatedExamples(
  target: DeskTemplate,
  style: DeskStyle,
  otherTemplates: DeskTemplate[],
): BriefExample[] {
  const ranked: { templateId: string; variant: DeskVariant; score: number }[] = [];
  for (const template of otherTemplates) {
    const sharedTags = new Set(template.tags.filter(tag => target.tags.includes(tag)));
    for (const variant of template.variants) {
      if (!variant.settled) continue;
      const candidate = deskVariantStyle(variant);
      let score = Math.min(sharedTags.size, 2);
      if (style.voice === candidate.voice) score += 3;
      if (style.genre === candidate.genre) score += 2;
      if (style.stance === candidate.stance) score += 1;
      if (score > 0) ranked.push({ templateId: template.id, variant, score });
    }
  }
  ranked.sort((left, right) =>
    right.score - left.score ||
    left.variant.id.localeCompare(right.variant.id) ||
    left.templateId.localeCompare(right.templateId));
  return ranked.slice(0, relatedExamplesPerTemplate).map(({ templateId, variant }) => briefExample(templateId, variant));
}

/** Describe the trigger definitions that supply this variant's facts. */
function templateTriggers(template: DeskTemplate, catalogue: DeskCatalogue): BriefTrigger[] {
  return deskTriggers(template, catalogue).map(({ id, subject, when, values, group }) => ({
    id, subject,
    when: conditions(when),
    values: values && JSON.stringify(values),
    group: group && (group.min === undefined ? group.by : group.by + ' (at least ' + group.min + ')'),
  }));
}

/** Build the data view for one chunk's writer brief. */
export function briefView(
  chunk: readonly DeskRef[],
  catalogue: DeskCatalogue,
  choices: number,
  writingPath: string = catalogue.writingPath ?? deskWritingRulesPath,
): DeskBriefView {
  if (!Number.isInteger(choices) || choices < 1) throw new Error('The desk choices must be a positive integer.');
  const writingRules = fs.readFileSync(writingPath, 'utf8').replace(/\r\n?/g, '\n').trim();
  const first = chunk.length > 0 ? findDeskVariant(catalogue, chunk[0]) : undefined;
  const style = first ? deskVariantStyle(first.variant) : { ...defaultVariantStyle };
  const taskTemplates = new Map<string, DeskTemplate>();
  const variants = chunk.flatMap((ref): BriefVariant[] => {
    const found = findDeskVariant(catalogue, ref);
    if (!found) return [];
    const { template, variant } = found;
    taskTemplates.set(template.id, template);
    const current = { ...variant.text, body: normalizeParagraphs(variant.text.body) };
    const used = deskTextPlaceholders(current);
    const links = (variant.links ?? []).map(({ placeholder }) => ({ placeholder, keep: used.has(placeholder) }));
    const formats = Object.entries(template.formats ?? {}).map(([name, format]) => ({ name, format }));
    const triggers = templateTriggers(template, catalogue);
    return [{
      templateId: template.id,
      variantId: variant.id,
      tags: template.tags.length > 0 ? template.tags.join(', ') : 'none',
      triggerSummary: template.triggerSummary,
      hasTriggers: triggers.length > 0,
      triggers,
      templateWhen: conditions(template.when),
      variantWhen: conditions(variant.when),
      hasFormats: formats.length > 0,
      formats,
      names: template.names?.join(', ') || 'none',
      hasLinks: links.length > 0,
      links,
      variables: templateVariables(template, catalogue, variant),
      current,
    }];
  });
  const examples: BriefExample[] = [];
  const related = new Map<string, BriefExample>();
  const otherTemplates = catalogue.templates.filter(template => !taskTemplates.has(template.id));
  for (const template of taskTemplates.values()) {
    for (const variant of template.variants) {
      if (variant.settled) examples.push(briefExample(template.id, variant));
    }
    for (const example of pickRelatedExamples(template, style, otherTemplates)) {
      related.set(deskRefKey(example), example);
    }
  }
  examples.push(...[...related.values()].slice(0, relatedExampleLimit));
  return {
    choices,
    writingRules,
    style: {
      ...style,
      voiceGuidance: catalogue.styles?.voice.find(entry => entry.id === style.voice)?.guidance,
      stanceGuidance: catalogue.styles?.stance.find(entry => entry.id === style.stance)?.guidance,
      genreGuidance: catalogue.styles?.genre.find(entry => entry.id === style.genre)?.guidance,
    },
    hasExamples: examples.length > 0,
    examples,
    variants,
  };
}

/** Render the newspaper-writer system prompt from a prepared brief view. */
export function renderBrief(view: DeskBriefView): string {
  return renderSystemPrompt(undefined, 'newspaper-writer', { ...view });
}
