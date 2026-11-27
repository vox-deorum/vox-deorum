/** Combine placed original stories into merged reports. */
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

/** Render one anchor's merged choices for members whose match already passed. */
async function mergeCandidate(
  anchor: EditorialCandidate,
  members: readonly EditorialCandidate[],
  matchSources: readonly NewspaperSourceReference[],
  anchorPlaced: boolean,
  definition: MergeDefinition,
  compiled: CompiledEditorialExpressions,
  batch: MergeBatch,
  budget: ExpressionCheckBudget,
  terms?: EditorialTerms,
): Promise<EditorialCandidate | undefined> {
  const prepared = compiled.templates.get(anchor.templateIds[0])!.merge!;
  const windowFromTurn = anchor.period.from;
  const sources = [...matchSources];
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
  const consumed = anchorPlaced ? support : members;
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

/** One cached match between a merge anchor and a placed story. */
interface MatchResult {
  value: boolean;
  failed: boolean;
  sources: NewspaperSourceReference[];
}

/** Merge pass over the placed original stories; `allow` can veto a merged story. */
export type StoryMerger = (
  placed: readonly EditorialCandidate[],
  allow: (merged: EditorialCandidate) => boolean,
) => Promise<EditorialCandidate[]>;

/**
 * Prepare merge passes for one check. Each pass applies anchors by priority to the placed
 * stories. Match results and merged stories are cached, so repeated passes evaluate each
 * anchor and story pair once.
 */
export function createStoryMerger(
  candidates: readonly EditorialCandidate[],
  config: EditorialConfig,
  compiled: CompiledEditorialExpressions,
  batch: MergeBatch,
  budget: ExpressionCheckBudget,
  published: ReadonlySet<string>,
  terms?: EditorialTerms,
): StoryMerger | undefined {
  const definitions = new Map(config.templates.flatMap(template => template.merge ? [[template.id, template.merge]] : []));
  if (!definitions.size) return undefined;
  const anchors = candidates.flatMap(anchor => {
    const definition = definitions.get(anchor.templateIds[0]);
    return definition && !published.has(anchor.fingerprint) ? [{ anchor, definition }] : [];
  }).sort((a, b) => (b.definition.priority ?? 0) - (a.definition.priority ?? 0) || a.anchor.id.localeCompare(b.anchor.id));
  if (!anchors.length) return undefined;
  const matches = new Map<string, MatchResult>();
  const built = new Map<string, Promise<EditorialCandidate | undefined>>();
  /** Key one anchor and member pair. */
  const pairKey = (anchor: EditorialCandidate, member: EditorialCandidate) => JSON.stringify([anchor.id, member.id]);

  /** Evaluate the anchor's match against stories it has not seen yet, then return every result. */
  const match = async (anchor: EditorialCandidate, eligible: readonly EditorialCandidate[]): Promise<MatchResult[]> => {
    const fresh = eligible.filter(member => !matches.has(pairKey(anchor, member)));
    if (fresh.length) {
      const prepared = compiled.templates.get(anchor.templateIds[0])!.merge!;
      const lead = memberBindings(anchor);
      const [results] = await compiled.runner.evaluate({
        ...batch,
        groups: [{
          expressions: [prepared.match], windowFromTurn: anchor.period.from,
          subjects: fresh.map(member => ({ lead, member: memberBindings(member) })),
        }],
      }, budget);
      for (const [index, [result]] of results.entries()) {
        recordChoiceError(result, prepared.match, budget);
        const value = 'value' in result && Boolean(result.value);
        matches.set(pairKey(anchor, fresh[index]), {
          value,
          failed: 'error' in result && result.error.hidden === undefined,
          sources: value ? result.sources ?? [] : [],
        });
      }
    }
    return eligible.map(member => matches.get(pairKey(anchor, member))!);
  };

  return async (placed, allow) => {
    const consumed = new Set<string>();
    const merged: EditorialCandidate[] = [];
    for (const { anchor, definition } of anchors) {
      if (consumed.has(anchor.id)) continue;
      const eligible = placed.filter(candidate => candidate !== anchor && !consumed.has(candidate.id));
      if (eligible.length < definition.min) continue;
      const results = await match(anchor, eligible);
      if (results.some(result => result.failed)) continue;
      const members = eligible.filter((_, index) => results[index].value);
      if (members.length < definition.min) continue;
      const anchorPlaced = placed.includes(anchor);
      const key = JSON.stringify([anchor.id, members.map(member => member.id), anchorPlaced]);
      if (!built.has(key)) {
        const sources = results.flatMap(result => result.sources);
        built.set(key, mergeCandidate(anchor, members, sources, anchorPlaced, definition, compiled, batch, budget, terms));
      }
      const story = await built.get(key)!;
      if (!story || !allow(story)) continue;
      merged.push(story);
      for (const id of story.mergedCandidateIds!) consumed.add(id);
    }
    return merged;
  };
}
