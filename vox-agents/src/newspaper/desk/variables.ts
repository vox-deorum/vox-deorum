/**
 * @module newspaper/desk/variables
 *
 * Builds the placeholder table shown to a writer and checks proposed copy
 * against it. The names mirror the runtime payload assembled by
 * `editorial/selection/templates.ts` and `editorial/facts/story.ts`.
 */
import type { DeskText, DeskVariable } from '../../types/api.js';
import { identityNames } from '../editorial/facts/story.js';
import { placeholderName, placeholderPattern, placeholderUnit } from '../editorial/selection/templates.js';
import { deskTriggers, type DeskCatalogue, type DeskTemplate, type DeskTriggerDefinition, type DeskVariant } from './catalogue.js';

/** A warning produced while checking one proposed choice. */
export interface DeskWarning {
  code: 'unknown-variable' | 'dropped-link' | 'may-be-empty';
  message: string;
}

/** A desk variable before its printed form is derived from the runtime unit rule. */
type DeskVariableSpec = Omit<DeskVariable, 'aliases' | 'prints'> & { aliases?: string[] };

/** Describe how a placeholder prints, using the renderer's unit rule. */
function variablePrints(name: string): string {
  const unit = placeholderUnit(name);
  if (unit?.kind === 'turn') return 'turn N';
  if (unit?.kind === 'unit') return `N ${unit.plural ?? unit.singular}`;
  return 'as is';
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

/** Count repeated scalar value names across triggers. */
function repeatedTriggerNames(triggers: readonly DeskTriggerDefinition[]): Set<string> {
  const counts = new Map<string, number>();
  for (const trigger of triggers) {
    for (const [name, value] of Object.entries(trigger.values ?? {})) {
      if (Array.isArray(value)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

/** Build trigger and group variables with one canonical name per value. */
function triggerVariables(triggers: readonly DeskTriggerDefinition[], repeated: ReadonlySet<string>): DeskVariableSpec[] {
  const variables: DeskVariableSpec[] = [];
  for (const trigger of triggers) {
    for (const [name, value] of Object.entries(trigger.values ?? {})) {
      if (Array.isArray(value)) continue;
      const qualified = `triggerValues.${trigger.id}.${name}`;
      variables.push({
        group: 'trigger',
        // A repeated value is ambiguous alone, so list its rule-qualified name instead.
        name: repeated.has(name) ? qualified : name,
        aliases: [repeated.has(name) ? name : qualified],
        source: typeof value === 'string' ? value : `${trigger.id}.values.${name}`,
        mayBeEmpty: trigger.group !== undefined || expressionMayBeEmpty(value),
        keep: false,
      });
    }
  }
  const grouped = triggers.filter((trigger) => trigger.group !== undefined);
  for (const trigger of grouped) {
    const single = grouped.length === 1;
    variables.push({
      group: 'group',
      name: single ? 'key' : `triggerValues.${trigger.id}.key`,
      aliases: ['group.key', `triggerValues.${trigger.id}.key`],
      source: groupSource(trigger),
      mayBeEmpty: false,
      keep: false,
    });
    variables.push({
      group: 'group',
      name: single ? 'count' : `triggerValues.${trigger.id}.count`,
      aliases: ['group.count', `triggerValues.${trigger.id}.count`],
      source: `triggerValues.${trigger.id}.count`,
      mayBeEmpty: false,
      keep: false,
    });
  }
  return variables;
}

/** Build the canonical subject name and player vocabulary for the template's first trigger kind. */
function subjectVariables(
  triggers: readonly DeskTriggerDefinition[],
  catalogue: DeskCatalogue,
  repeated: ReadonlySet<string>,
): DeskVariableSpec[] {
  const first = triggers[0];
  // Grouped triggers anchor on `group/<member kind>/<key>`, which carries no identity fields.
  if (!first || first.group) return [];
  if (first.subject !== 'city' && first.subject !== 'player') return [];
  const variables: DeskVariableSpec[] = [];
  // A repeated trigger value owns the bare name, so the subject name yields to it.
  if (!repeated.has(first.subject)) {
    variables.push({
      group: 'subject',
      name: first.subject,
      aliases: identityNames(first.subject, 'name'),
      source: first.subject,
      mayBeEmpty: true,
      keep: false,
    });
  }
  if (first.subject !== 'player') return variables;
  variables.push({
    group: 'subject',
    name: 'player.leader',
    aliases: identityNames(first.subject, 'leader'),
    source: 'player.leader',
    mayBeEmpty: true,
    keep: false,
  });
  for (const slot of Object.keys(catalogue.civicTerms?.defaults ?? {})) {
    variables.push({
      group: 'subject',
      name: `player.civic.${slot}`,
      aliases: identityNames(first.subject, `civic.${slot}`),
      source: `player.civic.${slot}`,
      mayBeEmpty: false,
      keep: false,
    });
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

/** Add the short reference names and the qualified fields that have no short form. */
function referenceVariables(
  trigger: DeskTriggerDefinition,
  catalogue: DeskCatalogue,
): DeskVariableSpec[] {
  const variables: DeskVariableSpec[] = [];
  const subject = trigger.subject;
  for (const reference of subjectReferences[subject] ?? []) {
    const field = reference.name;
    variables.push({
      group: 'reference',
      name: field,
      aliases: identityNames(subject, 'name', field),
      source: `${subject}.${field}.name`,
      mayBeEmpty: true,
      keep: false,
    });
    if (reference.kind !== 'player') continue;
    for (const slot of Object.keys(catalogue.civicTerms?.defaults ?? {})) {
      variables.push({
        group: 'reference',
        name: `${field}.civic.${slot}`,
        aliases: identityNames(subject, `civic.${slot}`, field),
        source: `${subject}.${field}.civic.${slot}`,
        mayBeEmpty: true,
        keep: false,
      });
    }
    // A reference leader has no short name, so keep the subject-qualified one.
    variables.push({
      group: 'reference',
      name: `${subject}.${field}.leader`,
      aliases: identityNames(subject, 'leader', field),
      source: `${subject}.${field}.leader`,
      mayBeEmpty: true,
      keep: false,
    });
  }
  return variables;
}

/** Build the current turn and reader terms from constants and civic vocabulary. */
function readerVariables(catalogue: DeskCatalogue): DeskVariableSpec[] {
  const variables: DeskVariableSpec[] = [
    { group: 'reader', name: 'turn', source: 'current turn', mayBeEmpty: false, keep: false },
    ...Object.keys(catalogue.constants?.terms ?? {}).map((name): DeskVariableSpec => ({
      group: 'reader',
      name: `terms.${name}`,
      source: `terms.${name}`,
      mayBeEmpty: false,
      keep: false,
    })),
  ];
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
): DeskVariableSpec[] {
  const variants = variant ? [variant] : template.variants;
  const variables: DeskVariableSpec[] = [];
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
): DeskVariableSpec[] {
  const siblings = variant
    ? template.variants.filter((candidate) => candidate.id !== variant.id)
    : template.variants;
  return siblings.flatMap((sibling) =>
    [...deskTextPlaceholders(sibling.text)].map((name): DeskVariableSpec => ({
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
  /** Merge one variable, keeping the strongest link and empty flags and deriving its printed form. */
  const add = (variable: DeskVariableSpec): void => {
    const existing = byName.get(variable.name);
    if (existing) {
      existing.keep = existing.keep || variable.keep;
      existing.mayBeEmpty = existing.mayBeEmpty || variable.mayBeEmpty;
      return;
    }
    const aliases = (variable.aliases ?? []).filter(alias => alias !== variable.name);
    byName.set(variable.name, { ...variable, aliases, prints: variablePrints(variable.name) });
  };
  triggerVariables(triggers, repeated).forEach(add);
  subjectVariables(triggers, catalogue, repeated).forEach(add);
  const first = triggers[0];
  if (first && !first.group) referenceVariables(first, catalogue).forEach(add);
  readerVariables(catalogue).forEach(add);
  linkVariables(template, variant).forEach(add);
  siblingVariables(template, variant).forEach(add);
  const variables = [...byName.values()];
  // A listed row reserves its bare name even if several triggers use it.
  for (const variable of variables)
    if (variable.group === 'trigger')
      variable.aliases = variable.aliases.filter(alias => !repeated.has(alias) || !byName.has(alias));
  return variables;
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
