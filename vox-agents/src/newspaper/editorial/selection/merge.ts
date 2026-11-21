/** Combine selected original stories while keeping a front page fillable. */
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import type { RuleScalar } from '../../contracts/triggers.js';
import type { CompiledEditorialExpressions, EditorialTerms } from '../config/expressions.js';
import type { EditorialConfig } from '../config/schema.js';
import { evaluateChoices, recordChoiceError } from '../shared/eligibility.js';
import type { ExpressionBatch, ExpressionBindings, ExpressionCheckBudget } from '../shared/expressions.js';
import { uniqueSources } from '../shared/sources.js';
import { placeholderSources, printable, type EditorialCandidate } from './templates.js';

type MergeBatch = Pick<ExpressionBatch, 'constants' | 'facts'>;
type MergeDefinition = NonNullable<EditorialConfig['templates'][number]['merge']>;

/** Expose a candidate's ordinary choice bindings and the templates it represents. */
function memberBindings(candidate: EditorialCandidate): ExpressionBindings {
  return { ...candidate.variantBindings, templateIds: candidate.templateIds };
}

/** Evaluate one anchor against the remaining original selections and render its merged choices. */
async function mergeCandidate(
  anchor: EditorialCandidate,
  remaining: readonly EditorialCandidate[],
  definition: MergeDefinition,
  compiled: CompiledEditorialExpressions,
  batch: MergeBatch,
  budget: ExpressionCheckBudget,
  terms?: EditorialTerms,
): Promise<EditorialCandidate | undefined> {
  const eligible = remaining.filter(member => member !== anchor);
  if (eligible.length < definition.min) return undefined;
  const prepared = compiled.templates.get(anchor.templateIds[0])!.merge!;
  const lead = memberBindings(anchor);
  const windowFromTurn = anchor.period.from;
  const [matching] = await compiled.runner.evaluate({
    ...batch,
    groups: [{
      expressions: [prepared.match], windowFromTurn,
      subjects: eligible.map(member => ({ lead, member: memberBindings(member) })),
    }],
  }, budget);
  const sources: NewspaperSourceReference[] = [];
  const members: EditorialCandidate[] = [];
  for (const [index, [result]] of matching.entries()) {
    recordChoiceError(result, prepared.match, budget);
    if ('value' in result && result.value) {
      members.push(eligible[index]);
      sources.push(...(result.sources ?? []));
    }
  }
  if (matching.some(([result]) => 'error' in result && result.error.hidden === undefined)) return undefined;
  if (members.length < definition.min) return undefined;

  const values: Record<string, RuleScalar> = Object.create(null);
  const merge = { members: members.map(memberBindings), count: members.length, values };
  const bindings = { ...anchor.variantBindings, merge };
  const entries = [...prepared.values];
  if (entries.length) {
    const [[results]] = await compiled.runner.evaluate({
      ...batch,
      groups: [{ expressions: entries.map(([, slot]) => slot), windowFromTurn, subjects: [bindings] }],
    }, budget);
    for (const [index, [name, slot]] of entries.entries()) {
      const result = results[index];
      recordChoiceError(result, slot, budget);
      if ('value' in result && result.value !== undefined) values[name] = result.value;
      sources.push(...(result.sources ?? []));
    }
    if (results.some(result => 'error' in result && result.error.hidden === undefined)) return undefined;
  }
  const placeholders = {
    ...anchor.values,
    ...Object.fromEntries(Object.entries(values).map(([name, value]) => [`merge.values.${name}`, value])),
  };
  const printableVariants = definition.variants.filter(variant => printable(variant, placeholders));
  const ratings = await evaluateChoices(compiled.runner, batch, printableVariants.map(variant => ({
    choice: prepared.variants.get(variant.id)!, bindings, windowFromTurn,
  })), budget);
  const variantWeights: EditorialCandidate['variantWeights'] = Object.create(null);
  const variantSources: EditorialCandidate['variantSources'] = Object.create(null);
  const variants = printableVariants.filter((variant, index) => {
    const rating = ratings[index];
    if (rating.weight <= 0) return false;
    variantWeights[variant.id] = rating.weight;
    variantSources[variant.id] = uniqueSources([
      ...rating.sources,
      ...placeholderSources(variant, { identity: anchor.mergeIdentity ?? {}, placeholders }, terms),
    ]);
    return true;
  });
  if (!variants.length) return undefined;

  const support = [anchor, ...members];
  const strongest = support.reduce((best, member) => member.importance > best.importance ? member : best);
  /** Retain each provenance key once, starting with the anchor's keys. */
  const union = (read: (candidate: EditorialCandidate) => readonly string[]) =>
    [...new Set(support.flatMap(read))];
  const consumed = remaining.includes(anchor) ? support : members;
  const mergedCandidateIds = consumed.map(member => member.id);
  const coveredFingerprints = [...new Set(support.map(member => member.fingerprint))].sort();
  const ruleSubjects = [...new Map(consumed.flatMap(member => member.ruleIds.map(ruleId => {
    const pair = { ruleId, subject: member.subject };
    return [JSON.stringify(pair), pair] as const;
  }))).values()];
  return {
    ...anchor,
    id: `merge/${JSON.stringify([anchor.id, [...mergedCandidateIds].sort()])}`,
    triggerIds: union(candidate => candidate.triggerIds),
    ruleIds: union(candidate => candidate.ruleIds),
    templateIds: union(candidate => candidate.templateIds),
    seriesKeys: [...new Set(consumed.flatMap(candidate => candidate.seriesKeys))],
    conflictKeys: [...new Set(consumed.flatMap(candidate => candidate.conflictKeys ?? []))],
    tags: union(candidate => candidate.tags),
    tier: strongest.tier,
    importance: strongest.importance,
    urgent: support.some(candidate => candidate.urgent),
    variants, variantWeights, variantSources, variantBindings: bindings, values: placeholders,
    sources: uniqueSources([...support.flatMap(candidate => candidate.sources), ...sources]),
    fingerprint: JSON.stringify([anchor.fingerprint, coveredFingerprints]),
    coveredFingerprints,
    mergedCandidateIds,
    ruleSubjects,
  };
}

/** Apply merge anchors by priority, leaving originals intact unless the replacement keeps the front fillable. */
export async function mergeSelectedStories(
  selected: EditorialCandidate[],
  candidates: readonly EditorialCandidate[],
  config: EditorialConfig,
  compiled: CompiledEditorialExpressions,
  batch: MergeBatch,
  budget: ExpressionCheckBudget,
  published: ReadonlySet<string>,
  frontFits: (readyCount: number, urgent: boolean) => boolean,
  terms?: EditorialTerms,
): Promise<EditorialCandidate[]> {
  const definitions = new Map(config.templates.flatMap(template => template.merge ? [[template.id, template.merge]] : []));
  if (!definitions.size) return selected;
  const anchors = candidates.flatMap(anchor => {
    const definition = definitions.get(anchor.templateIds[0]);
    return definition && !published.has(anchor.fingerprint) ? [{ anchor, definition }] : [];
  }).sort((a, b) => (b.definition.priority ?? 0) - (a.definition.priority ?? 0) || a.anchor.id.localeCompare(b.anchor.id));
  const consumed = new Map<string, EditorialCandidate>();
  let readyCount = selected.length;
  let urgent = selected.some(candidate => candidate.urgent);
  for (const { anchor, definition } of anchors) {
    if (consumed.has(anchor.id)) continue;
    const merged = await mergeCandidate(
      anchor, selected.filter(candidate => !consumed.has(candidate.id)), definition, compiled, batch, budget, terms,
    );
    if (!merged) continue;
    const members = merged.mergedCandidateIds!;
    const resultingCount = readyCount - members.length + 1;
    // Every merged article inherits urgency from its members and can gain it from the anchor.
    const resultingUrgency = urgent || merged.urgent;
    if (!frontFits(resultingCount, resultingUrgency)) continue;
    for (const id of members) consumed.set(id, merged);
    readyCount = resultingCount;
    urgent = resultingUrgency;
  }
  return [...new Set(selected.map(candidate => consumed.get(candidate.id) ?? candidate))];
}
