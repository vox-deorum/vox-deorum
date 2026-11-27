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
  // A selected story that did not reach the page was dropped by a skip or by the layout.
  return outcome === 'selected' ? 'unpublished' : outcome;
}

/** Summarize one completed check's trigger, template, and editor funnels. */
export function summarizeCheckCoverage(input: CheckCoverageInput): CheckCoverage {
  const rules: CheckCoverage['rules'] = {};
  for (const audit of input.audit)
    if (audit.subjectCount > 0 || audit.groups.length) rules[audit.rule] = ruleCoverage(audit);
  const candidates = input.candidates.map((candidate): CandidateCoverage => {
    const merged = input.mergedInto.get(candidate.id);
    return {
      id: candidate.id,
      template: candidate.templateIds[0],
      subject: candidate.subject,
      rules: candidate.ruleIds,
      importance: candidate.importance,
      score: input.scores.get(candidate.id) ?? 0,
      outcome: candidateOutcome(candidate.id, input),
      ...(merged === undefined ? {} : { mergedInto: merged }),
    };
  });
  const printedScores = candidates.filter(isPrinted).map(candidate => candidate.score);
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
    return {
      id: rule.id,
      subject: rule.subject,
      ...(rule.enabled === false ? { disabled: true } : {}),
      checks: checkCount, subjects, fired, firedChecks,
      stops: [...stops].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([key, value]) => {
          const parsed = parseStop(key);
          const source = parsed.guard === undefined ? undefined : guards[parsed.guard];
          return { key, ...parsed, ...(source === undefined ? {} : { source: String(source) }), count: value };
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
  if (funnel.zeroWeight) return 'weighted-out';
  if (funnel.unprintable) return 'unprintable';
  return rules.every(id => (fired.get(id) ?? 0) > 0) ? 'not-together' : 'not-fired';
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
  const templates = config.templates.filter(template => template.mode !== 'llmOnly').map((template): TemplateCoverage => {
    const funnel: TemplateFunnel = { partial: 0, matched: 0, unprintable: 0, zeroWeight: 0, noVariants: 0, candidates: 0 };
    const outcomes: TemplateCoverage['outcomes'] = {};
    const printedTurns: number[] = [];
    let bestScore: number | null = null;
    let floor: number | null = null;
    for (const check of ordered) {
      const counts = check.templates[template.id];
      if (counts) for (const key of Object.keys(funnel) as (keyof TemplateFunnel)[]) funnel[key] += counts[key];
      const own = check.candidates.filter(candidate => candidate.template === template.id);
      for (const candidate of own) outcomes[candidate.outcome] = (outcomes[candidate.outcome] ?? 0) + 1;
      if (own.some(isPrinted)) {
        printedTurns.push(check.turn);
        continue;
      }
      if (!own.length) continue;
      const best = Math.max(...own.map(candidate => candidate.score));
      bestScore = bestScore === null ? best : Math.max(bestScore, best);
      if (check.printedFloor !== null) floor = floor === null ? check.printedFloor : Math.min(floor, check.printedFloor);
    }
    return {
      id: template.id,
      desk: desks.get(template.id) ?? 'other',
      tags: template.tags,
      rules: template.triggers,
      stage: templateStage(printedTurns.length, funnel, template.triggers, fired),
      printed: printedTurns.length,
      funnel, outcomes, bestScore, floor,
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
