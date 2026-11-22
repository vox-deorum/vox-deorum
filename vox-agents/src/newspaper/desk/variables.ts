/**
 * @module newspaper/desk/variables
 *
 * Builds the placeholder table shown to a writer and checks proposed copy
 * against it. The names mirror the runtime payload assembled by
 * `editorial/selection/templates.ts` and `editorial/facts/story.ts`.
 */
import type { DeskText, DeskVariable } from '../../types/api.js';
import { placeholderName, placeholderPattern } from '../editorial/selection/templates.js';
import { deskTriggers, type DeskCatalogue, type DeskTemplate, type DeskTriggerDefinition, type DeskVariant } from './catalogue.js';

/** A warning produced while checking one proposed choice. */
export interface DeskWarning {
  code: 'unknown-variable' | 'dropped-link' | 'may-be-empty';
  message: string;
}

/** Return every base placeholder name used by a text. */
export function deskTextPlaceholders(text: DeskText): Set<string> {
  const names = new Set<string>();
  const fields = [text.headline, text.subheadline, text.byline, ...text.body];
  for (const field of fields) {
    if (typeof field !== 'string') continue;
    for (const match of field.matchAll(placeholderPattern)) names.add(placeholderName(match[1]));
  }
  return names;
}

/** Whether a trigger value expression can produce an absent value. */
function expressionMayBeEmpty(source: unknown): boolean {
  return typeof source === 'string' && /\b(?:null|undefined)\b/.test(source);
}

/** Read a trigger's grouping expression. */
function groupSource(trigger: DeskTriggerDefinition): string {
  const by = trigger.group?.by;
  return typeof by === 'string' ? by : `triggerValues.${trigger.id}.key`;
}

/** Count repeated scalar trigger value names across ungrouped triggers. */
function repeatedTriggerNames(triggers: readonly DeskTriggerDefinition[]): Set<string> {
  const counts = new Map<string, number>();
  for (const trigger of triggers) {
    if (trigger.group) continue;
    for (const [name, value] of Object.entries(trigger.values ?? {})) {
      if (Array.isArray(value)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

/** Build trigger and group variables, keeping shared bare names out of the table. */
function triggerVariables(triggers: readonly DeskTriggerDefinition[]): DeskVariable[] {
  const variables: DeskVariable[] = [];
  const repeated = repeatedTriggerNames(triggers);
  for (const trigger of triggers) {
    if (trigger.group) continue;
    for (const [name, value] of Object.entries(trigger.values ?? {})) {
      if (Array.isArray(value) || repeated.has(name)) continue;
      variables.push({
        group: 'trigger',
        name,
        source: typeof value === 'string' ? value : `${trigger.id}.values.${name}`,
        mayBeEmpty: expressionMayBeEmpty(value),
        keep: false,
      });
    }
  }
  for (const trigger of triggers) {
    if (trigger.group) {
      variables.push({
        group: 'group',
        name: `triggerValues.${trigger.id}.key`,
        source: groupSource(trigger),
        mayBeEmpty: false,
        keep: false,
      });
      variables.push({
        group: 'group',
        name: `triggerValues.${trigger.id}.count`,
        source: `triggerValues.${trigger.id}.count`,
        mayBeEmpty: false,
        keep: false,
      });
      continue;
    }
    for (const [name, value] of Object.entries(trigger.values ?? {})) {
      if (Array.isArray(value)) continue;
      variables.push({
        group: 'trigger',
        name: `triggerValues.${trigger.id}.${name}`,
        source: typeof value === 'string' ? value : `${trigger.id}.values.${name}`,
        mayBeEmpty: expressionMayBeEmpty(value),
        keep: false,
      });
    }
  }
  const grouped = triggers.filter((trigger) => trigger.group !== undefined);
  if (grouped.length === 1) {
    for (const name of ['key', 'group.key', 'count', 'group.count']) {
      variables.push({ group: 'group', name, source: name.endsWith('key') ? groupSource(grouped[0]) : 'group.count',
        mayBeEmpty: false, keep: false });
    }
  }
  return variables;
}

/** Identity fields each concrete subject kind projects into the runtime placeholder table. */
const subjectIdentityFields: Readonly<Record<string, readonly string[]>> = {
  city: ['name', 'id'],
  player: ['name', 'id', 'leader'],
  event: ['id'],
  pair: ['id'],
  incident: ['id'],
};

/** Build subject identity variables for the template's first trigger kind. */
function subjectVariables(
  triggers: readonly DeskTriggerDefinition[],
  catalogue: DeskCatalogue,
  repeated: ReadonlySet<string>,
): DeskVariable[] {
  const first = triggers[0];
  if (!first) return [];
  const variables: DeskVariable[] = [];
  /** Add one identity alias if no repeated trigger value hides it. */
  const add = (name: string, mayBeEmpty = false): void => {
    if (repeated.has(name)) return;
    variables.push({
      group: 'subject',
      name,
      source: name,
      mayBeEmpty,
      keep: false,
    });
  };
  add('subject.key');
  add('subject.kind');
  // Grouped triggers anchor on `group/<member kind>/<key>`, which carries no identity fields.
  if (first.group) return variables;
  for (const key of subjectIdentityFields[first.subject] ?? []) {
    add(`subject.${key}`, key !== 'id');
    add(`${first.subject}.${key}`, key !== 'id');
    if (key === 'name') add(first.subject, true);
    else if (key === 'id') add(`${first.subject}Id`);
  }
  if (first.subject === 'player') {
    for (const slot of Object.keys(catalogue.civicTerms?.defaults ?? {})) {
      add(`civic.${slot}`);
      add(`player.civic.${slot}`);
      add(`subject.civic.${slot}`);
    }
  }
  return variables;
}

/** Reference fields carried by each subject kind. */
const subjectReferences: Readonly<Record<string, readonly { name: string; kind: 'city' | 'player' }[]>> = {
  city: [{ name: 'owner', kind: 'player' }],
  player: [{ name: 'capital', kind: 'city' }, { name: 'majorAlly', kind: 'player' }],
  pair: [{ name: 'a', kind: 'player' }, { name: 'b', kind: 'player' }, { name: 'other', kind: 'player' }],
  event: [{ name: 'player', kind: 'player' }, { name: 'city', kind: 'city' }],
};

/** Add the visible identity fields of one reference target. */
function referenceVariables(
  trigger: DeskTriggerDefinition,
  catalogue: DeskCatalogue,
): DeskVariable[] {
  const variables: DeskVariable[] = [];
  const references = subjectReferences[trigger.subject] ?? [];
  for (const reference of references) {
    const prefix = trigger.subject;
    const field = reference.name;
    const names = reference.kind === 'player' ? ['name', 'id', 'leader'] : ['name', 'id'];
    for (const key of names) {
      variables.push({
        group: 'reference',
        name: `${prefix}.${field}.${key}`,
        source: `${prefix}.${field}.${key}`,
        mayBeEmpty: true,
        keep: false,
      });
      if (key !== 'leader') {
        variables.push({
          group: 'reference',
          name: key === 'name' ? field : `${field}Id`,
          source: `${prefix}.${field}.${key}`,
          mayBeEmpty: true,
          keep: false,
        });
      }
    }
    if (reference.kind === 'player') {
      for (const slot of Object.keys(catalogue.civicTerms?.defaults ?? {})) {
        variables.push({
          group: 'reference',
          name: `${field}.civic.${slot}`,
          source: `${prefix}.${field}.civic.${slot}`,
          mayBeEmpty: true,
          keep: false,
        });
        variables.push({
          group: 'reference',
          name: `${prefix}.${field}.civic.${slot}`,
          source: `${prefix}.${field}.civic.${slot}`,
          mayBeEmpty: true,
          keep: false,
        });
      }
    }
  }
  return variables;
}

/** Build the reporting-period placeholders. */
function periodVariables(): DeskVariable[] {
  return ['period.from', 'period.to'].map((name): DeskVariable => ({
    group: 'period',
    name,
    source: name,
    mayBeEmpty: false,
    keep: false,
  }));
}

/** Build reader terms from constants and civic vocabulary. */
function readerVariables(catalogue: DeskCatalogue): DeskVariable[] {
  const variables: DeskVariable[] = Object.keys(catalogue.constants?.terms ?? {}).map(
    (name): DeskVariable => ({
      group: 'reader',
      name: `terms.${name}`,
      source: `terms.${name}`,
      mayBeEmpty: false,
      keep: false,
    }),
  );
  for (const slot of Object.keys(catalogue.civicTerms?.defaults ?? {})) {
    variables.push({
      group: 'reader',
      name: `terms.civic.${slot}`,
      source: `terms.civic.${slot}`,
      mayBeEmpty: false,
      keep: false,
    });
  }
  return variables;
}

/** Build link placeholders and mark the ones the current text keeps. */
function linkVariables(
  template: DeskTemplate,
  variant?: DeskVariant,
): DeskVariable[] {
  const variants = variant ? [variant] : template.variants;
  const variables: DeskVariable[] = [];
  for (const source of variants) {
    const used = deskTextPlaceholders(source.text);
    for (const [index, link] of (source.links ?? []).entries()) {
      variables.push({
        group: 'link',
        name: link.placeholder,
        source: `${source.id}.links[${index}]`,
        mayBeEmpty: false,
        keep: used.has(link.placeholder),
      });
    }
  }
  return variables;
}

/** Build placeholders seen only in other variants of the same template. */
function siblingVariables(
  template: DeskTemplate,
  variant?: DeskVariant,
): DeskVariable[] {
  const siblings = variant
    ? template.variants.filter((candidate) => candidate.id !== variant.id)
    : template.variants;
  return siblings.flatMap((sibling) =>
    [...deskTextPlaceholders(sibling.text)].map((name): DeskVariable => ({
      group: 'sibling',
      name,
      source: `sibling:${sibling.id}`,
      mayBeEmpty: false,
      keep: false,
    })),
  );
}

/**
 * Build the variable table for a template. When a variant is supplied its own
 * links and siblings are used; otherwise links and sibling names are pooled
 * across the template.
 */
export function templateVariables(
  template: DeskTemplate,
  catalogue: DeskCatalogue,
  variant?: DeskVariant,
): DeskVariable[] {
  const triggers = deskTriggers(template, catalogue);
  const repeated = repeatedTriggerNames(triggers);
  const byName = new Map<string, DeskVariable>();
  const add = (variable: DeskVariable): void => {
    const existing = byName.get(variable.name);
    if (existing) {
      existing.keep = existing.keep || variable.keep;
      existing.mayBeEmpty = existing.mayBeEmpty || variable.mayBeEmpty;
      return;
    }
    byName.set(variable.name, { ...variable });
  };
  triggerVariables(triggers).forEach(add);
  subjectVariables(triggers, catalogue, repeated).forEach(add);
  const first = triggers[0];
  if (first && !first.group) referenceVariables(first, catalogue).forEach(add);
  periodVariables().forEach(add);
  readerVariables(catalogue).forEach(add);
  linkVariables(template, variant).forEach(add);
  siblingVariables(template, variant).forEach(add);
  return [...byName.values()];
}

/** Check proposed copy for unknown names, dropped links, and potentially absent facts. */
export function variantWarnings(
  text: DeskText,
  variant: DeskVariant,
  variables: readonly DeskVariable[],
): DeskWarning[] {
  const table = new Map(variables.map(variable => [variable.name, variable]));
  const current = deskTextPlaceholders(variant.text);
  const proposed = deskTextPlaceholders(text);
  const warnings: DeskWarning[] = [];
  for (const name of proposed) {
    const variable = table.get(name);
    if (!variable) {
      warnings.push({ code: 'unknown-variable', message: 'Unknown placeholder {{' + name + '}}.' });
    } else if (variable.mayBeEmpty && !current.has(name)) {
      warnings.push({ code: 'may-be-empty', message: 'The placeholder {{' + name + '}} may be empty.' });
    }
  }
  for (const variable of variables) {
    if (variable.keep && !proposed.has(variable.name))
      warnings.push({ code: 'dropped-link', message: 'Keep the {{' + variable.name + '}} link in the copy.' });
  }
  return warnings;
}

/** Return human-readable warnings for one proposed choice. */
export function candidateWarnings(
  text: DeskText,
  variant: DeskVariant,
  variables: readonly DeskVariable[],
): string[] {
  return variantWarnings(text, variant, variables).map((warning) => warning.message);
}
