/** Template coverage: record where each check's templates stopped and explain it across a run. */
import type {
  CandidateCoverage,
  CandidateOutcome,
  CheckCoverage,
  CoverageStage,
  RuleStop,
  RunCoverage,
  RunRuleCoverage,
  TemplateCoverage,
  TemplateFunnel,
} from '../contracts/coverage.js';
import type { TriggerRuleAudit } from '../contracts/triggers.js';
import type { EditorialConfig } from './config/schema.js';
import type { SelectionOutcome } from './selection/heuristic.js';
import type { EditorialCandidate } from './selection/templates.js';

export interface CheckCoverageInput {
  turn: number;
  status: 'published' | 'skipped';
  reason?: string;
  audit: readonly TriggerRuleAudit[];
  funnel: ReadonlyMap<string, TemplateFunnel>;
  candidates: readonly EditorialCandidate[];
  scores: ReadonlyMap<string, number>;
  outcomes: ReadonlyMap<string, SelectionOutcome>;
  /** Original candidate IDs printed on their own. */
  printed: ReadonlySet<string>;
  /** Original candidate IDs absorbed by a printed merged story, mapped to that story. */
  mergedInto: ReadonlyMap<string, string>;
  /** Printed roundup stories built by merge templates, each scored as its strongest member. */
  roundups?: readonly { story: EditorialCandidate; score: number }[];
}

/** Count why one rule's subjects and groups did not fire in a check. */
function ruleCoverage(audit: TriggerRuleAudit): CheckCoverage['rules'][string] {
  const stops: Record<string, number> = {};
  /** Add one stopped subject under its key. */
  const stop = (key: string, amount = 1) => { stops[key] = (stops[key] ?? 0) + amount; };
  let fired = 0;
  for (const subject of audit.subjects) {
    const { outcome, failedWhen } = subject;
    if (outcome === 'fired') fired++;
    else if (outcome === 'false') stop(`false:${failedWhen ?? 0}`);
    else if (outcome === 'hidden' || outcome === 'error') stop(failedWhen === undefined ? outcome : `${outcome}:${failedWhen}`);
    else if (outcome === 'repeat' || outcome === 'chance') stop(outcome);
  }
  // Group members pass their guards first; the group decides whether they fire.
  for (const group of audit.groups) {
    const members = group.matches.length;
    if (group.outcome === 'fired') fired += members;
    else stop(group.outcome === 'too-small' ? 'too-small' : `group-${group.outcome}`, members);
  }
  return { subjects: audit.subjectCount, fired, stops };
}

/** Resolve the editor's final outcome for one candidate after layout and merging. */
function candidateOutcome(id: string, input: CheckCoverageInput): CandidateOutcome {
  if (input.mergedInto.has(id)) return 'merged';
  if (input.printed.has(id)) return 'printed';
  const outcome = input.outcomes.get(id) ?? 'outranked';
  if (outcome !== 'selected') return outcome;
  // A selected story missing from the page found no slot, or its check skipped.
  return input.status === 'published' ? 'unplaced' : 'unpublished';
}

/** Describe one candidate for the check's coverage. */
function candidateEntry(
  candidate: EditorialCandidate, score: number, outcome: CandidateOutcome, mergedInto?: string,
): CandidateCoverage {
  return {
    id: candidate.id,
    template: candidate.templateIds[0],
    subject: candidate.subject,
    rules: candidate.ruleIds,
    importance: candidate.importance,
    score,
    outcome,
    ...(mergedInto === undefined ? {} : { mergedInto }),
  };
}

/** Summarize one completed check's trigger, template, and editor funnels. */
export function summarizeCheckCoverage(input: CheckCoverageInput): CheckCoverage {
  const rules: CheckCoverage['rules'] = {};
  for (const audit of input.audit)
    if (audit.subjectCount > 0 || audit.groups.length) rules[audit.rule] = ruleCoverage(audit);
  const candidates = [
    ...input.candidates.map(candidate => candidateEntry(candidate, input.scores.get(candidate.id) ?? 0,
      candidateOutcome(candidate.id, input), input.mergedInto.get(candidate.id))),
    // A roundup's first template is its merge anchor, which wrote the printed story.
    ...(input.roundups ?? []).map(({ story, score }) => candidateEntry(story, score, 'printed')),
  ];
  const printedScores = candidates.filter(candidate => candidate.outcome === 'printed').map(candidate => candidate.score);
  return {
    turn: input.turn,
    status: input.status,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    printedFloor: printedScores.length ? Math.min(...printedScores) : null,
    rules,
    templates: Object.fromEntries(input.funnel),
    candidates,
  };
}

/** Whether a candidate reached the page, alone or inside a merged story. */
function isPrinted(candidate: Pick<CandidateCoverage, 'outcome'>): boolean {
  return candidate.outcome === 'printed' || candidate.outcome === 'merged';
}

/** Order of the non-guard stops, matching the order trigger evaluation applies them after the guards. */
const laterStops: readonly string[] = ['repeat', 'chance', 'hidden', 'error', 'too-small', 'group-chance', 'group-hidden', 'group-error'];

/** Rank a stop by where the rule applies it: guards in order, then the later steps. */
function stopRank({ kind, guard }: Pick<RuleStop, 'kind' | 'guard'>): number {
  if (guard !== undefined) return guard * 3 + ['false', 'hidden', 'error'].indexOf(kind);
  return 1e6 + laterStops.indexOf(kind);
}

/** Parse a stop key into its kind and guard index. */
function parseStop(key: string): Pick<RuleStop, 'kind' | 'guard'> {
  const [kind, guard] = key.split(':');
  return { kind: kind as RuleStop['kind'], ...(guard === undefined ? {} : { guard: Number(guard) }) };
}

/** Sum each catalogue rule's funnel over the run and attach guard source text. */
function summarizeRules(checks: readonly CheckCoverage[], config: EditorialConfig): RunRuleCoverage[] {
  return config.triggers.map((rule) => {
    const guards = typeof rule.when === 'string' ? [rule.when] : rule.when;
    const stops = new Map<string, number>();
    let checkCount = 0, subjects = 0, fired = 0, firedChecks = 0;
    for (const check of checks) {
      const entry = check.rules[rule.id];
      if (!entry) continue;
      checkCount++;
      subjects += entry.subjects;
      fired += entry.fired;
      if (entry.fired) firedChecks++;
      for (const [key, value] of Object.entries(entry.stops)) stops.set(key, (stops.get(key) ?? 0) + value);
    }
    const ordered = [...stops].map(([key, value]) => ({ key, ...parseStop(key), count: value }))
      .sort((left, right) => stopRank(left) - stopRank(right));
    // Every outcome of one guard shares the subjects that reached that guard.
    const step = (stop: { kind: string; guard?: number }) => stop.guard === undefined ? stop.kind : `guard:${stop.guard}`;
    const reachedBy = new Map<string, number>();
    let remaining = subjects;
    for (const stop of ordered) {
      if (!reachedBy.has(step(stop))) reachedBy.set(step(stop), remaining);
      remaining -= stop.count;
    }
    return {
      id: rule.id,
      subject: rule.subject,
      ...(rule.enabled === false ? { disabled: true } : {}),
      checks: checkCount, subjects, fired, firedChecks,
      stops: ordered.map((stop) => {
        const source = stop.guard === undefined ? undefined : guards[stop.guard];
        return { ...stop, ...(source === undefined ? {} : { source: String(source) }), reached: reachedBy.get(step(stop))! };
      }),
    };
  });
}

/** Pick the furthest stage a template failed to pass. */
function templateStage(
  printed: number, funnel: TemplateFunnel, rules: readonly string[], fired: ReadonlyMap<string, number>
): CoverageStage {
  if (printed) return 'printed';
  if (funnel.candidates) return 'passed-over';
  if (funnel.noVariants) return 'unprintable';
  if (funnel.zeroWeight || funnel.ineligible) return 'weighted-out';
  if (funnel.unprintable) return 'unprintable';
  return rules.every(id => (fired.get(id) ?? 0) > 0) ? 'not-together' : 'not-fired';
}

/** Prefer a published check with the smallest gap to its printed floor, then the higher score. */
function closerToPrint(
  next: { best: number; floor: number | null }, current: { best: number; floor: number | null },
): boolean {
  if ((next.floor === null) !== (current.floor === null)) return next.floor !== null;
  if (next.floor !== null && current.floor !== null) return next.floor - next.best < current.floor - current.best;
  return next.best > current.best;
}

/** Aggregate saved check coverage into one explanation per authored template. */
export function summarizeRunCoverage(
  checks: readonly CheckCoverage[],
  config: EditorialConfig,
  desks: ReadonlyMap<string, string> = new Map(),
  uncoveredIssues = 0,
): RunCoverage {
  const ordered = [...checks].sort((left, right) => left.turn - right.turn);
  const rules = summarizeRules(ordered, config);
  const fired = new Map(rules.map(rule => [rule.id, rule.fired]));
  // Index each check's candidates by template once instead of rescanning them per template.
  const byTemplate = ordered.map((check) => {
    const groups = new Map<string, CandidateCoverage[]>();
    for (const candidate of check.candidates) groups.set(candidate.template, [...(groups.get(candidate.template) ?? []), candidate]);
    return groups;
  });
  const templates = config.templates.filter(template => template.mode !== 'llmOnly').map((template): TemplateCoverage => {
    const funnel: TemplateFunnel = { partial: 0, matched: 0, unprintable: 0, ineligible: 0, zeroWeight: 0, noVariants: 0, candidates: 0 };
    const outcomes: TemplateCoverage['outcomes'] = {};
    const printedTurns: number[] = [];
    let closest: { turn: number; best: number; floor: number | null } | undefined;
    ordered.forEach((check, index) => {
      const counts = check.templates[template.id];
      if (counts) for (const key of Object.keys(funnel) as (keyof TemplateFunnel)[]) funnel[key] += counts[key] ?? 0;
      const own = byTemplate[index].get(template.id) ?? [];
      for (const candidate of own) outcomes[candidate.outcome] = (outcomes[candidate.outcome] ?? 0) + 1;
      if (own.some(isPrinted)) {
        printedTurns.push(check.turn);
        return;
      }
      if (!own.length) return;
      const entry = { turn: check.turn, best: Math.max(...own.map(candidate => candidate.score)), floor: check.printedFloor };
      if (!closest || closerToPrint(entry, closest)) closest = entry;
    });
    return {
      id: template.id,
      desk: desks.get(template.id) ?? 'other',
      tags: template.tags,
      rules: template.triggers,
      stage: templateStage(printedTurns.length, funnel, template.triggers, fired),
      printed: printedTurns.length,
      funnel, outcomes,
      scoreTurn: closest?.turn ?? null, bestScore: closest?.best ?? null, floor: closest?.floor ?? null,
      printedTurns: printedTurns.reverse().slice(0, 5),
    };
  });
  return {
    checks: ordered.length,
    published: ordered.filter(check => check.status === 'published').length,
    turns: ordered.length ? { from: ordered[0].turn, to: ordered.at(-1)!.turn } : null,
    uncoveredIssues,
    templates,
    rules,
  };
}
