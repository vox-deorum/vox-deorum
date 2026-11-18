/** Match authored templates and explicit composites before heuristic scoring. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { linkTargetSchema } from '../../contracts/issue.js';
import type { EditorialConfig, EditorialTemplate, AuthoredVariant } from '../config/schema.js';
import { evaluateCondition, type ConditionContext } from '../shared/conditions.js';
import { uniqueSources } from '../shared/sources.js';
import { selectionWeight } from '../shared/weights.js';
import type { RuleDevelopment } from '../../contracts/triggers.js';

type TemplateValues = RuleDevelopment['values'];
export const placeholderPattern = /\{\{([^{}]+)\}\}/g;

/** A complete, evidence-supported authored choice available to an editor. */
export interface EditorialCandidate {
  id: string;
  subject: string;
  period: { from: number; to: number };
  triggerIds: string[];
  templateIds: string[];
  contributingIds: string[];
  seriesKeys: string[];
  conflictKeys?: string[];
  tags: string[];
  importance: number;
  urgent: boolean;
  short: boolean;
  weight: number;
  variants: AuthoredVariant[];
  values: TemplateValues;
  sources: NewspaperSourceReference[];
  fingerprint: string;
}

/** Substitute authored placeholders, preserving unresolved values for explicit validation. */
export function substitute(text: string, values: TemplateValues): string {
  return text.replace(placeholderPattern, (whole, key: string) => {
    const value = Object.hasOwn(values, key) ? values[key] : undefined;
    return value == null || typeof value === 'object' ? whole : String(value);
  });
}

/** Resolve typed link destinations using the same finite authored placeholders. */
export function resolveLinkTarget(
  target: AuthoredVariant['links'][number]['target'],
  values: TemplateValues
): AuthoredVariant['links'][number]['target'] {
  return linkTargetSchema.parse(
    Object.fromEntries(
      Object.entries(target).map(([key, value]) => [
        key,
        typeof value === 'string' ? substitute(value, values) : value,
      ])
    )
  );
}

/** Exclude variants whose conditions, weights or factual placeholders are unavailable. */
export function eligibleVariants(
  template: EditorialTemplate,
  context: ConditionContext,
  values: TemplateValues
): AuthoredVariant[] {
  return template.variants.filter((variant) => {
    if (
      evaluateCondition(variant.condition, context) !== true ||
      selectionWeight(variant.weight, context) <= 0
    )
      return false;
    const augmented = {
      ...values,
      ...Object.fromEntries(
        variant.links.map((link) => [link.placeholder, substitute(link.label, values)])
      ),
    };
    const rendered = [variant.headline, ...variant.body].map((text) => substitute(text, augmented));
    if (rendered.some((text) => text.match(placeholderPattern))) return false;
    return variant.links.every(
      (link) =>
        !JSON.stringify(resolveLinkTarget(link.target, values)).match(placeholderPattern) &&
        !substitute(link.label, values).match(placeholderPattern)
    );
  });
}

/** Establish shared subject and overlapping evidence periods before combining angles. */
function compatible(parts: { subject: string; period: { from: number; to: number } }[]): boolean {
  return (
    parts.every((part) => part.subject === parts[0]?.subject) &&
    Math.max(...parts.map((part) => part.period.from)) <=
      Math.min(...parts.map((part) => part.period.to))
  );
}

/** Enumerate bounded authored combinations in a stable order. */
function combinations<T>(groups: T[][]): T[][] {
  return groups.reduce<T[][]>(
    (partial, group) =>
      partial.flatMap((parts) => group.map((part) => [...parts, part])).slice(0, 100),
    [[]]
  );
}

/** Materialize supported base and composite templates with canonical evidence and importance. */
export function matchTemplates(
  triggers: RuleDevelopment[],
  config: EditorialConfig,
  context: ConditionContext
): EditorialCandidate[] {
  const candidates: EditorialCandidate[] = [];
  for (const template of config.templates.filter((entry) => !entry.compositeOf.length)) {
    if (template.mode === 'llmOnly' || evaluateCondition(template.condition, context) !== true)
      continue;
    const weight = selectionWeight(template.weight, context);
    if (weight <= 0) continue;
    const groups = template.triggerIds.map((id) =>
      triggers.filter((trigger) => trigger.definitionId === id)
    );
    for (const parts of combinations(groups)) {
      if (!parts.length || !compatible(parts)) continue;
      const values = parts.reduce<TemplateValues>((merged, part) => ({ ...merged, ...part.values }), {});
      const variants = eligibleVariants(
        template,
        { ...context, values: { ...context.values, ...values } },
        values
      );
      if (!variants.length) continue;
      candidates.push({
        id: `${template.id}/${parts.map((part) => part.id).join('+')}`,
        subject: parts[0].subject,
        period: {
          from: Math.min(...parts.map((part) => part.period.from)),
          to: Math.max(...parts.map((part) => part.period.to)),
        },
        triggerIds: parts.map((part) => part.id),
        templateIds: [template.id],
        contributingIds: [],
        seriesKeys: [...new Set(parts.flatMap((part) => part.seriesKeys))],
        conflictKeys: [...new Set(parts.flatMap((part) => part.conflictKeys ?? []))],
        tags: [...new Set([...template.tags, ...parts.flatMap((part) => part.tags)])],
        importance: Math.max(...parts.map((part) => part.importance)),
        urgent: parts.some((part) => part.urgent),
        short: template.short,
        weight,
        variants,
        values,
        sources: uniqueSources(parts.flatMap((part) => part.sources)),
        fingerprint: parts
          .map((part) => part.fingerprint)
          .sort()
          .join('+'),
      });
    }
  }
  for (const template of config.templates.filter((entry) => entry.compositeOf.length)) {
    if (template.mode === 'llmOnly' || evaluateCondition(template.condition, context) !== true)
      continue;
    const weight = selectionWeight(template.weight, context);
    if (weight <= 0) continue;
    const groups = template.compositeOf.map((id) =>
      candidates.filter(
        (candidate) => candidate.templateIds.includes(id) && !candidate.contributingIds.length
      )
    );
    for (const parts of combinations(groups)) {
      if (
        parts.length < 2 ||
        !compatible(parts) ||
        new Set(parts.map((part) => part.id)).size !== parts.length
      )
        continue;
      const supportingIds = new Set(parts.flatMap((part) => part.triggerIds));
      if (
        !template.triggerIds.every((id) =>
          triggers.some((trigger) => trigger.definitionId === id && supportingIds.has(trigger.id))
        )
      )
        continue;
      const values = parts.reduce<TemplateValues>((merged, part) => ({ ...merged, ...part.values }), {});
      const variants = eligibleVariants(
        template,
        { ...context, values: { ...context.values, ...values } },
        values
      );
      if (!variants.length) continue;
      candidates.push({
        id: `${template.id}/${parts.map((part) => part.id).join('+')}`,
        subject: parts[0].subject,
        period: {
          from: Math.min(...parts.map((part) => part.period.from)),
          to: Math.max(...parts.map((part) => part.period.to)),
        },
        triggerIds: [...new Set(parts.flatMap((part) => part.triggerIds))],
        templateIds: [...new Set([template.id, ...parts.flatMap((part) => part.templateIds)])],
        contributingIds: parts.map((part) => part.id),
        seriesKeys: [...new Set(parts.flatMap((part) => part.seriesKeys))],
        conflictKeys: [...new Set(parts.flatMap((part) => part.conflictKeys ?? []))],
        tags: [...new Set([...template.tags, ...parts.flatMap((part) => part.tags)])],
        importance: Math.max(...parts.map((part) => part.importance)),
        urgent: parts.some((part) => part.urgent),
        short: template.short,
        weight,
        variants,
        values,
        sources: uniqueSources(parts.flatMap((part) => part.sources)),
        fingerprint: parts
          .map((part) => part.fingerprint)
          .sort()
          .join('+'),
      });
    }
  }
  return candidates;
}
