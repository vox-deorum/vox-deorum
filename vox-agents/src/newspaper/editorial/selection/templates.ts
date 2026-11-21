/** Match templates against developments with a common visible subject and reporting period. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { linkTargetSchema } from '../../contracts/issue.js';
import type { RuleDevelopment, RuleScalar } from '../../contracts/triggers.js';
import type { CompiledEditorialExpressions, EditorialTerms } from '../config/expressions.js';
import type { EditorialConfig, EditorialTemplate, AuthoredVariant } from '../config/schema.js';
import { storyIdentity, storySubject } from '../facts/story.js';
import { evaluateChoices } from '../shared/eligibility.js';
import type { ExpressionBatch, ExpressionBindings, ExpressionCheckBudget } from '../shared/expressions.js';
import { uniqueSources } from '../shared/sources.js';

type TemplateValues = Record<string, RuleScalar>;
type Period = RuleDevelopment['period'];
type BatchFacts = Pick<ExpressionBatch, 'constants' | 'facts'>;
export const placeholderPattern = /\{\{([^{}]+)\}\}/g;

/** A complete, evidence-supported authored choice available to an editor. */
export interface EditorialCandidate {
  id: string;
  subject: string;
  period: Period;
  triggerIds: string[];
  /** Trigger definition IDs supporting the candidate, retained for printed-article memory. */
  ruleIds: string[];
  templateIds: string[];
  seriesKeys: string[];
  conflictKeys?: string[];
  tags: string[];
  importance: number;
  urgent: boolean;
  short: boolean;
  weight: number;
  variants: AuthoredVariant[];
  variantWeights: Record<string, number>;
  variantSources: Record<string, NewspaperSourceReference[]>;
  /** Check-local fact bindings used by style rules after the story is selected. */
  variantBindings?: ExpressionBindings;
  /** Visible identity fields available to merged prose. */
  mergeIdentity?: ReturnType<typeof storyIdentity>;
  /** Fingerprints of the anchor and original selections covered by this merged story. */
  coveredFingerprints?: string[];
  /** Original candidate IDs replaced by this merged story. */
  mergedCandidateIds?: string[];
  /** Original rule and subject pairs used by publication memory. */
  ruleSubjects?: { ruleId: string; subject: string }[];
  values: TemplateValues;
  sources: NewspaperSourceReference[];
  fingerprint: string;
}

/** Substitute authored placeholders, preserving unresolved values for explicit validation. */
export function substitute(text: string, values: TemplateValues): string {
  return text.replace(placeholderPattern, (whole, key: string) => {
    const value = Object.hasOwn(values, key) ? values[key] : undefined;
    return value == null ? whole : String(value);
  });
}

/** Expose resolved terms under the `terms.` prefix used by authored placeholders. */
export function termPlaceholders(terms?: EditorialTerms): Record<string, string | number> {
  return Object.fromEntries([...(terms ?? [])].map(([name, term]) => [`terms.${name}`, term.value]));
}

/** Substitute destination fields using the same authored placeholders as prose. */
function substituteTarget(
  target: AuthoredVariant['links'][number]['target'],
  values: TemplateValues
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(target).map(([key, value]) =>
    [key, typeof value === 'string' ? substitute(value, values) : value]
  ));
}

/** Resolve a validated link for the publication. */
export function resolveLinkTarget(
  target: AuthoredVariant['links'][number]['target'],
  values: TemplateValues
): AuthoredVariant['links'][number]['target'] {
  return linkTargetSchema.parse(substituteTarget(target, values));
}

/** Check that every prose and link placeholder has a visible scalar value. */
export function printable(variant: AuthoredVariant, values: TemplateValues): boolean {
  const augmented = {
    ...values,
    ...Object.fromEntries(variant.links.map((link) => [link.placeholder, substitute(link.label, values)])),
  };
  if (variantText(variant).some((source) => substitute(source, augmented).match(placeholderPattern)))
    return false;
  return variant.links.every((link) => {
    const label = substitute(link.label, values);
    if (!label || label.match(placeholderPattern)) return false;
    const target = linkTargetSchema.safeParse(substituteTarget(link.target, values));
    return target.success && !JSON.stringify(target.data).match(placeholderPattern);
  });
}

/** List the prose fields checked for placeholders and their evidence. */
function variantText({ headline, subheadline, byline, body }: AuthoredVariant): string[] {
  return [headline, subheadline, byline, ...body].filter(value => value !== undefined);
}

/** Require every named rule and intersect their windows, whose lower bounds are exclusive. */
function supportingMatch(ids: readonly string[], rules: ReadonlyMap<string, RuleDevelopment>) {
  const parts: RuleDevelopment[] = [];
  let from = -Infinity;
  let to = Infinity;
  for (const id of ids) {
    const part = rules.get(id);
    if (!part) return undefined;
    from = Math.max(from, part.period.from);
    to = Math.min(to, part.period.to);
    if (from >= to) return undefined;
    parts.push(part);
  }
  return { parts, period: { from, to } };
}

/** Build candidate bindings and printable values without flattening members of a group. */
function templateFacts(
  parts: readonly RuleDevelopment[], period: Period, facts?: BatchFacts['facts'], terms?: EditorialTerms
) {
  const subject = storySubject(parts[0].subject, facts);
  const identity = storyIdentity(subject, facts);
  const triggerValues: Record<string, ExpressionBindings> = Object.create(null);
  const values: TemplateValues = Object.create(null);
  const qualified: TemplateValues = Object.create(null);
  const repeated = new Set<string>();
  const groups = [];
  for (const part of parts) {
    const { matches } = part.values;
    if (!Array.isArray(matches)) {
      const entries = Object.entries(part.values).filter((entry): entry is [string, RuleScalar] => !Array.isArray(entry[1]));
      triggerValues[part.definitionId] = Object.fromEntries(entries);
      for (const [name, value] of entries) {
        qualified[`triggerValues.${part.definitionId}.${name}`] = value;
        if (Object.hasOwn(values, name)) repeated.add(name);
        values[name] = value;
      }
      continue;
    }
    const group = {
      key: part.values.key as RuleScalar, count: matches.length,
      matches: matches.map((match) => {
        const member = storySubject(match.subject, facts);
        return {
          subject: match.subject, values: match.values,
          ...(member.ref ? { [member.kind]: member.ref } : {}),
        };
      }),
    };
    groups.push(group);
    triggerValues[part.definitionId] = group;
    qualified[`triggerValues.${part.definitionId}.key`] = group.key;
    qualified[`triggerValues.${part.definitionId}.count`] = group.count;
  }
  for (const name of repeated) delete values[name];
  const group = groups.length === 1 ? groups[0] : undefined;
  const bindings: ExpressionBindings = {
    ...values,
    ...(group ? { group, key: group.key, count: group.count } : {}),
    ...(subject.ref ? { [subject.kind]: subject.ref } : {}),
    subject: { $kind: 'subject', key: subject.key, kind: subject.kind, ...(subject.ref ? { ref: subject.ref } : {}) },
    period, values, triggerValues,
  };

  // Unqualified names are convenient only when their source is unambiguous.
  const identityValues = Object.fromEntries(Object.entries(identity)
    .filter(([key]) => !repeated.has(key))
    .map(([key, field]) => [key, field.value as RuleScalar]));
  const placeholders: TemplateValues = {
    ...termPlaceholders(terms),
    ...identityValues,
    ...values,
    ...qualified,
    ...Object.fromEntries(Object.entries(identityValues).filter(([key]) => key.includes('.') || key.endsWith('Id'))),
    'subject.key': subject.key, 'subject.kind': subject.kind,
    'period.from': period.from, 'period.to': period.to,
    ...(group ? {
      key: group.key, count: group.count,
      'group.key': group.key, 'group.count': group.count,
    } : {}),
  };
  return { bindings, placeholders, identity };
}

/** Find source rows for the visible identities actually printed by a variant. */
export function placeholderSources(
  variant: AuthoredVariant,
  choice: Pick<ReturnType<typeof templateFacts>, 'identity' | 'placeholders'>,
  terms?: EditorialTerms
): NewspaperSourceReference[] {
  const used = [
    ...variantText(variant),
    ...variant.links.flatMap((link) => [link.label, ...Object.values(link.target)]),
  ].flatMap((text) => [...text.matchAll(placeholderPattern)].map((match) => match[1]));
  return used.flatMap((key) => {
    if (key.startsWith('terms.')) return terms?.get(key.slice('terms.'.length))?.sources ?? [];
    const field = choice.identity[key];
    return field?.value === choice.placeholders[key] ? field?.sources ?? [] : [];
  });
}

/** Match every named trigger on the same subject and evaluate each choice with its evidence bindings. */
export async function matchTemplates(
  triggers: readonly RuleDevelopment[],
  config: EditorialConfig,
  compiled: CompiledEditorialExpressions,
  batch: BatchFacts,
  budget?: ExpressionCheckBudget,
  terms?: EditorialTerms
): Promise<EditorialCandidate[]> {
  const retainBindings = compiled.styleRules.length || config.templates.some(template => template.merge);
  const bySubject = new Map<string, Map<string, RuleDevelopment>>();
  for (const part of triggers) {
    const rules = bySubject.get(part.subject) ?? new Map<string, RuleDevelopment>();
    bySubject.set(part.subject, rules);
    rules.set(part.definitionId, part);
  }
  const plans = [];
  for (const template of config.templates) {
    if (template.mode === 'llmOnly') continue;
    const prepared = compiled.templates.get(template.id)!;
    for (const rules of bySubject.values()) {
      const match = supportingMatch(template.triggers, rules);
      if (!match) continue;
      const choice = templateFacts(match.parts, match.period, batch.facts, terms);
      const variants = template.variants.filter((variant) => printable(variant, choice.placeholders));
      if (variants.length || template.merge) plans.push({ template, prepared, ...match, choice, variants });
    }
  }
  const templateWeights = await evaluateChoices(compiled.runner, batch, plans.map((plan) => ({
    choice: plan.prepared, bindings: plan.choice.bindings, windowFromTurn: plan.period.from,
  })), budget);
  const active = plans.flatMap((plan, index) => templateWeights[index].weight > 0 ?
    [{ ...plan, rating: templateWeights[index] }] : []);
  const variantWeights = await evaluateChoices(compiled.runner, batch, active.flatMap((plan) =>
    plan.variants.map((variant) => ({
      choice: plan.prepared.variants.get(variant.id)!,
      bindings: plan.choice.bindings, windowFromTurn: plan.period.from,
    }))
  ), budget);
  let offset = 0;
  return active.flatMap(({ template, parts, period, choice, variants, rating }) => {
    const weights: Record<string, number> = Object.create(null);
    const sources: EditorialCandidate['variantSources'] = Object.create(null);
    const eligible = variants.filter((variant) => {
      const result = variantWeights[offset++];
      if (result.weight <= 0) return false;
      weights[variant.id] = result.weight;
      sources[variant.id] = uniqueSources([...result.sources, ...placeholderSources(variant, choice, terms)]);
      return true;
    });
    return eligible.length || template.merge ? [candidate(
      template, parts, period, choice.placeholders, rating, eligible, weights, sources,
      retainBindings ? choice.bindings : undefined,
      template.merge ? choice.identity : undefined,
    )] : [];
  });
}

/** Join the supporting developments while preserving their conflict and continuing-series keys. */
function candidate(
  template: EditorialTemplate, parts: readonly RuleDevelopment[], period: Period, values: TemplateValues,
  rating: { weight: number; sources: NewspaperSourceReference[] }, variants: AuthoredVariant[],
  variantWeights: EditorialCandidate['variantWeights'], variantSources: EditorialCandidate['variantSources'],
  variantBindings?: ExpressionBindings,
  mergeIdentity?: EditorialCandidate['mergeIdentity'],
): EditorialCandidate {
  return {
    id: `${template.id}/${parts.map((part) => part.id).join('+')}`,
    subject: parts[0].subject,
    period,
    triggerIds: parts.map((part) => part.id),
    ruleIds: [...new Set(parts.map((part) => part.definitionId))],
    templateIds: [template.id],
    seriesKeys: [...new Set(parts.flatMap((part) => part.seriesKeys))],
    conflictKeys: [...new Set(parts.flatMap((part) => part.conflictKeys ?? []))],
    tags: [...new Set([...template.tags, ...parts.flatMap((part) => part.tags)])],
    importance: Math.max(...parts.map((part) => part.importance)),
    urgent: parts.some((part) => part.urgent),
    short: template.short,
    weight: rating.weight,
    variants, variantWeights, variantSources, values,
    ...(variantBindings === undefined ? {} : { variantBindings }),
    ...(mergeIdentity === undefined ? {} : { mergeIdentity }),
    sources: uniqueSources([...parts.flatMap((part) => part.sources), ...rating.sources]),
    fingerprint: parts.map((part) => part.fingerprint).sort().join('+'),
  };
}
