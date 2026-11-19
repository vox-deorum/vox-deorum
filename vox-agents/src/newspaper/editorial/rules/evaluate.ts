/** Evaluate catalogue rules on one permission-filtered check and return the next repeat state. */
import type {
  RuleDevelopment, RuleGroupMatch, RuleScalar, TriggerRepeatState, TriggerRuleAudit,
} from '../../contracts/triggers.js';
import { resolveEditorialSpan, scaleEditorialConstants, type EditorialConstants } from '../config/constants.js';
import type { CompiledTriggerExpressions, TriggerExpressionSlots } from '../config/expressions.js';
import type { EditorialTriggerRule } from '../config/schema.js';
import type { NewspaperFactModel } from '../facts/index.js';
import { stableDraw } from '../shared/determinism.js';
import type { ExpressionBatch, ExpressionCheckBudget, ExpressionResult } from '../shared/expressions.js';
import { uniqueSources } from '../shared/sources.js';
import { auditExpressions, expressionSources } from './audit.js';
import { canRepeat, repeatPolicy } from './repeat.js';
import { listRuleSubjects, ruleSubjectKey } from './subjects.js';

export type { RuleDevelopment, TriggerRepeatState, TriggerRuleAudit } from '../../contracts/triggers.js';

interface EvaluateRulesInput {
  rules: readonly EditorialTriggerRule[];
  compiled: CompiledTriggerExpressions;
  facts: NewspaperFactModel;
  constants: EditorialConstants;
  speedMultiplier: number;
  repeatState?: TriggerRepeatState;
  budget?: ExpressionCheckBudget;
  /** Check identity used by optional chance draws; omitted callers keep the previous shape. */
  identitySeed?: string;
}

type Group = ExpressionBatch['groups'][number];
type Sources = RuleDevelopment['sources'];
type AuditSubject = TriggerRuleAudit['subjects'][number];
type AuditGroup = TriggerRuleAudit['groups'][number];
type NamedStep = { slot: number | undefined; field: string; source: string; bind?: string; numeric?: true };

interface SubjectMatch extends RuleGroupMatch {
  sources: Sources;
}

interface SubjectGroup {
  key: RuleScalar;
  matches: SubjectMatch[];
}

/** Tell replay how much evidence to load beyond the reporting period. */
export function ruleHistoryTurns(
  rules: readonly EditorialTriggerRule[], constants: EditorialConstants, speedMultiplier: number,
): number {
  let longest = resolveEditorialSpan('long', constants, speedMultiplier);
  for (const rule of rules)
    if (rule.enabled !== false && rule.window !== undefined)
      longest = Math.max(longest, resolveEditorialSpan(rule.window, constants, speedMultiplier));
  return longest;
}

/** Map rating fields to compiled steps; numeric and absent importance need no sandbox work. */
function ratingSteps(rule: EditorialTriggerRule, slots: TriggerExpressionSlots): NamedStep[] {
  const steps: NamedStep[] = [];
  if (typeof rule.importance === 'string')
    steps.push({ slot: slots.importance, field: 'importance', source: rule.importance, numeric: true });
  if (rule.urgent !== undefined)
    steps.push({ slot: slots.urgent, field: 'urgent', source: rule.urgent });
  return steps;
}

/** Select compiled indices for the authored fields; catalogue and runner must match. */
function indices(steps: readonly NamedStep[]): number[] {
  return steps.map(({ slot, field }) => {
    if (slot === undefined) throw new Error(`Missing compiled expression for "${field}".`);
    return slot;
  });
}
/** Read a scalar runner result that already passed error handling. */
function scalar(result: ExpressionResult | undefined) {
  return result && 'value' in result ? result.value : undefined;
}

/** Reshape only successful evaluations for templates, discarding unavailable placeholders. */
function matchValues(results: readonly ExpressionResult[], steps: readonly NamedStep[]): RuleGroupMatch['values'] {
  return Object.fromEntries(steps.flatMap(({ bind }, index) => {
    const value = scalar(results[index]);
    return bind === undefined || value === undefined ? [] : [[bind, value]];
  }));
}

/** For known step fields, expose only source text and field name in the serialized audit. */
function auditSteps(steps: readonly NamedStep[], results: readonly ExpressionResult[]) {
  return auditExpressions(steps.map(({ field, source }) => ({ field, source })), results);
}

/** Build a fresh repeat state, evaluating eligible subjects together before rating grouped matches. */
export async function evaluateTriggerRules({
  rules, compiled, facts, constants, speedMultiplier, repeatState = {}, budget = { interruptedSlots: new Set() },
  identitySeed = '',
}: EvaluateRulesInput): Promise<{
  developments: RuleDevelopment[]; audit: TriggerRuleAudit[]; repeatState: TriggerRepeatState;
}> {
  const nextState: TriggerRepeatState = { ...repeatState };
  const scaled = scaleEditorialConstants(constants, speedMultiplier);
  const plans = rules.filter(rule => rule.enabled !== false).map(rule => {
    const slots = compiled.slots.get(rule.id);
    if (!slots) throw new Error(`Missing compiled rule "${rule.id}".`);
    const subjects = listRuleSubjects(rule, facts);
    const conflictBySubject = new Map(subjects.map(subject => [subject.key, subject.conflictKey]));
    const policy = repeatPolicy(rule, constants, speedMultiplier);
    const limit = rule.window === undefined ? facts.previous : Math.max(-1,
      facts.turn - resolveEditorialSpan(rule.window, constants, speedMultiplier));
    const keys = subjects.map(subject => ruleSubjectKey(rule.id, subject.key));
    const allowed = keys.map(key => canRepeat(repeatState[key], policy, facts.turn));
    // Ungrouped chance is known before the batch, so a failed draw stops rating and value steps.
    const chanceFailed = subjects.map(subject =>
      rule.group === undefined && rule.chance !== undefined &&
      stableDraw(identitySeed, rule.id, subject.key) >= rule.chance);
    const when = typeof rule.when === 'string' ? [rule.when] : rule.when;
    const guards = when.map((source, index) => ({
      slot: slots.when[index], field: typeof rule.when === 'string' ? 'when' : `when[${index}]`, source,
    }));
    const values = Object.entries(rule.values ?? {}).map(([name, source]) => ({
      slot: slots.values.get(name), field: `values.${name}`, bind: name, source,
    }));
    const rate = ratingSteps(rule, slots);
    const tail = rule.group ? [{ slot: slots.groupBy, field: 'group.by', source: rule.group.by }] : rate;
    const steps: NamedStep[] = [...guards, ...values, ...tail];
    const batch: Group = {
      windowFromTurn: limit, expressions: indices(steps),
      subjects: subjects.map(subject => subject.bindings),
      ordered: {
        guardCount: guards.length,
        bind: Object.fromEntries(steps.flatMap((step, index) => step.bind === undefined ? [] : [[index, step.bind]])),
        limits: subjects.map((_, index) => allowed[index] && !chanceFailed[index] ? steps.length : guards.length),
        numeric: steps.flatMap((step, index) => step.numeric ? [index] : []),
      },
    };
    return {
      rule, subjects, conflictBySubject, policy, limit, keys, allowed, chanceFailed,
      guards, values, rate, steps, batch,
    };
  });
  const checks = await compiled.runner.evaluate({ constants: scaled, facts, groups: plans.map(plan => plan.batch) }, budget);
  const pending: { batch: Group; complete(results: ExpressionResult[]): void }[] = [];
  const outcomes = plans.map((plan, planIndex) => {
    const { rule, subjects, conflictBySubject, policy, limit, keys, allowed, chanceFailed,
      guards, values, rate, steps } = plan;
    const developments: RuleDevelopment[] = [];
    const audit: TriggerRuleAudit = {
      rule: rule.id, windowFromTurn: limit, subjectCount: subjects.length, subjects: [], groups: [],
    };
    const partitions = new Map<RuleScalar, SubjectGroup>();

    /** Create one development and remember only subjects that actually contributed to it. */
    function emit(subject: string, memberSubjects: string[], placeholders: RuleDevelopment['values'], sources: Sources,
      rating: readonly ExpressionResult[], record: AuditSubject | AuditGroup) {
      const importanceStep = rate.findIndex(step => step.field === 'importance');
      const urgentStep = rate.findIndex(step => step.field === 'urgent');
      const importance = typeof rule.importance === 'number' ? rule.importance : scalar(rating[importanceStep]);
      const periodSubject = rule.subject === 'event' || rule.subject === 'incident';
      const fingerprint = JSON.stringify([rule.id, subject, ...(periodSubject ? memberSubjects : [facts.turn])]);
      record.importance = typeof importance === 'number' ? Math.min(100, Math.max(0, importance)) : 50;
      record.urgent = !!scalar(rating[urgentStep]);
      const seriesKeys = memberSubjects.map(member => ruleSubjectKey(rule.id, member));
      const conflictKeys = memberSubjects.flatMap(member => {
        const key = conflictBySubject.get(member);
        return key === undefined ? [] : [key];
      });
      developments.push({
        id: fingerprint, fingerprint, definitionId: rule.id, subject, seriesKeys,
        ...(conflictKeys.length ? { conflictKeys } : {}),
        period: { from: limit, to: facts.turn }, importance: record.importance,
        urgent: record.urgent, tags: [...(rule.tags ?? [])],
        values: placeholders, sources,
      });
      if (!periodSubject)
        for (const key of seriesKeys) nextState[key] = { lastTurn: facts.turn, armed: false };
    }

    for (const [index, subject] of subjects.entries()) {
      const results = checks[planIndex][index];
      const expressions = auditSteps(steps, results);
      const sources = uniqueSources([...(subject.sources ?? []), ...expressionSources(expressions)]);
      const record: AuditSubject = { subject: subject.key, outcome: 'matched', expressions, sources };
      audit.subjects.push(record);
      const previous = repeatState[keys[index]];
      if (previous) record.repeat = previous;
      const guardFailure = results.slice(0, guards.length).findIndex(result => !scalar(result));
      if (guardFailure >= 0) {
        const result = results[guardFailure];
        record.failedWhen = guardFailure;
        record.outcome = 'error' in result ? result.error.hidden ? 'hidden' : 'error' : 'false';
        if (record.outcome === 'false' && policy === 'rearm' && previous)
          nextState[keys[index]] = record.repeat = { ...previous, armed: true };
        continue;
      }
      if (!allowed[index]) {
        record.outcome = 'repeat';
        continue;
      }
      if (chanceFailed[index]) {
        record.outcome = 'chance';
        continue;
      }
      const failure = results.find(result => 'error' in result);
      if (failure && 'error' in failure) {
        record.outcome = failure.error.hidden ? 'hidden' : 'error';
        continue;
      }
      const placeholders = matchValues(results.slice(guards.length), values);
      const tail = results.slice(guards.length + values.length);
      if (!rule.group) {
        emit(subject.key, [subject.key], placeholders, sources, tail, record);
        record.outcome = 'fired';
        if (nextState[keys[index]]) record.repeat = nextState[keys[index]];
        continue;
      }
      const key = scalar(tail[0]);
      if (key === undefined) {
        record.outcome = 'error';
        expressions[expressions.length - 1].error = 'Expected a grouping key.';
        continue;
      }
      let partition = partitions.get(key);
      if (!partition) {
        partition = { key, matches: [] };
        partitions.set(key, partition);
      }
      partition.matches.push({ subject: subject.key, values: placeholders, sources });
    }

    for (const { key, matches } of partitions.values()) {
      const subject = `group/${rule.subject}/${JSON.stringify(key)}`;
      const entries: RuleGroupMatch[] = matches.map(({ subject, values: matchValues }) => ({ subject, values: matchValues }));
      const record: AuditGroup = {
        subject, key, matches: entries, outcome: 'too-small', expressions: [],
        sources: uniqueSources(matches.flatMap(match => match.sources)),
      };
      audit.groups.push(record);
      if (matches.length < (rule.group?.min ?? 2)) continue;
      // A grouped chance draw happens once per group, before rating or repeat memory.
      if (rule.chance !== undefined &&
          stableDraw(identitySeed, rule.id, subject) >= rule.chance) {
        record.outcome = 'chance';
        continue;
      }
      const placeholders = { count: matches.length, key, matches: entries };
      /** Combine both evaluation phases' evidence before emitting the group. */
      const complete = (results: ExpressionResult[]) => {
        record.expressions = auditSteps(rate, results);
        record.sources = uniqueSources([...record.sources, ...expressionSources(record.expressions)]);
        const error = results.find(result => 'error' in result);
        if (error && 'error' in error) {
          record.outcome = error.error.hidden ? 'hidden' : 'error';
          return;
        }
        emit(subject, entries.map(entry => entry.subject), placeholders, record.sources, results, record);
        record.outcome = 'fired';
      };
      if (rate.length) pending.push({
        batch: {
          windowFromTurn: limit, expressions: indices(rate), subjects: [placeholders],
          ordered: { guardCount: 0, numeric: rate.flatMap((step, index) => step.numeric ? [index] : []) },
        },
        complete,
      });
      else complete([]);
    }
    return { audit, developments };
  });
  if (pending.length) {
    const ratings = await compiled.runner.evaluate({ constants: scaled, facts, groups: pending.map(task => task.batch) }, budget);
    pending.forEach(({ complete }, index) => complete(ratings[index][0]));
  }
  return {
    audit: outcomes.map(outcome => outcome.audit),
    developments: outcomes.flatMap(outcome => outcome.developments),
    repeatState: nextState,
  };
}
