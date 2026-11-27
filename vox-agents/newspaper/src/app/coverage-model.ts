/** Plain-language summaries, filters and groups for template coverage diagnostics. */
import type {
  CandidateOutcome,
  CoverageStage,
  RunCoverage,
  RunRuleCoverage,
  RuleStop,
  TemplateCoverage,
} from '../../../src/newspaper/contracts/coverage.js';

/** Stages from worst to best, which is the order unprinted templates are shown in. */
export const stagesWorstFirst: readonly CoverageStage[] = ['not-fired', 'not-together', 'unprintable', 'weighted-out', 'passed-over', 'printed'];

/** Short names for each stage. */
export const stageLabels: Record<CoverageStage, string> = {
  'not-fired': 'Rule never fired',
  'not-together': 'Rules not together',
  unprintable: 'Unprintable',
  'weighted-out': 'Blocked by when or weight',
  'passed-over': 'Passed over',
  printed: 'Printed',
};

/** Words that follow a template count, such as "3 never fired". */
export const stageCountLabels: Record<CoverageStage, string> = {
  'not-fired': 'never fired',
  'not-together': 'not together',
  unprintable: 'unprintable',
  'weighted-out': 'blocked by when or weight',
  'passed-over': 'passed over',
  printed: 'printed',
};

/** Short names for what the editor did with a candidate. */
export const outcomeLabels: Record<CandidateOutcome, string> = {
  printed: 'printed',
  merged: 'merged into another story',
  outranked: 'outranked',
  conflict: 'conflicted with a stronger story',
  'printed-before': 'already printed before',
  'not-positive': 'score not positive',
  'no-variants': 'no usable variant',
  unplaced: 'selected but found no slot',
  unpublished: 'check skipped',
};

export type Grouping = 'desk' | 'stage' | 'tag';

/** The viewer's chosen grouping and filters. */
export interface CoverageControls {
  grouping: Grouping;
  tag: string;
  stage: CoverageStage | '';
  search: string;
  hidePrinted: boolean;
}

export const defaultControls: CoverageControls = { grouping: 'desk', tag: '', stage: '', search: '', hidePrinted: false };

/** One level-one group of templates with its per-stage counts. */
export interface CoverageGroup {
  key: string;
  templates: TemplateCoverage[];
  counts: Record<CoverageStage, number>;
  unprinted: number;
}

/** Count how many templates sit at each stage. */
export function countStages(templates: readonly TemplateCoverage[]): Record<CoverageStage, number> {
  const counts = Object.fromEntries(stagesWorstFirst.map(stage => [stage, 0])) as Record<CoverageStage, number>;
  for (const template of templates) counts[template.stage] += 1;
  return counts;
}

/** List the tags present in the data, alphabetically. */
export function coverageTags(coverage: RunCoverage): string[] {
  return [...new Set(coverage.templates.flatMap(template => template.tags))].sort();
}

/** Keep templates that pass the stage, tag, printed and text filters. */
export function filterTemplates(coverage: RunCoverage, controls: CoverageControls): TemplateCoverage[] {
  const search = controls.search.trim().toLowerCase();
  return coverage.templates.filter(template =>
    (!controls.stage || template.stage === controls.stage)
    && (!controls.tag || template.tags.includes(controls.tag))
    && (!controls.hidePrinted || template.stage !== 'printed')
    && (!search || template.id.toLowerCase().includes(search) || template.rules.some(rule => rule.toLowerCase().includes(search))));
}

/** Rank a template so the furthest-from-print ones come first. */
function stageRank(stage: CoverageStage): number {
  return stagesWorstFirst.indexOf(stage);
}

/** Order templates worst stage first, then by id. */
export function sortTemplates(templates: TemplateCoverage[]): TemplateCoverage[] {
  return templates.sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || a.id.localeCompare(b.id));
}

/** Group templates by desk, stage or tag; a template with several tags appears under each. */
export function groupTemplates(templates: readonly TemplateCoverage[], grouping: Grouping): CoverageGroup[] {
  const byKey = new Map<string, TemplateCoverage[]>();
  for (const template of templates) {
    const keys = grouping === 'desk' ? [template.desk]
      : grouping === 'stage' ? [template.stage]
      : template.tags.length ? template.tags : ['untagged'];
    for (const key of keys) {
      const list = byKey.get(key) ?? [];
      list.push(template);
      byKey.set(key, list);
    }
  }
  const groups = [...byKey].map(([key, list]): CoverageGroup => {
    const counts = countStages(list);
    return { key, templates: sortTemplates(list), counts, unprinted: list.length - counts.printed };
  });
  if (grouping === 'stage') return groups.sort((a, b) => stageRank(a.key as CoverageStage) - stageRank(b.key as CoverageStage));
  return groups.sort((a, b) => b.unprinted - a.unprinted || b.templates.length - a.templates.length || a.key.localeCompare(b.key));
}

/** Name a group key for display. */
export function groupLabel(key: string, grouping: Grouping): string {
  return grouping === 'stage' ? stageLabels[key as CoverageStage] ?? key : key;
}

/** Say in a few words what happened to the subjects a step stopped. */
export function stopReason(stop: RuleStop): string {
  switch (stop.kind) {
    case 'false': return 'false';
    case 'hidden': case 'group-hidden': return 'evidence not visible';
    case 'error': case 'group-error': return 'failed with an error';
    case 'repeat': return 'already reported recently';
    case 'chance': case 'group-chance': return 'lost the roll';
    case 'too-small': return 'change too small';
  }
}

/** Name the step where a stop happened, such as "guard 4" or "the chance roll". */
export function stopStep(stop: RuleStop): string {
  if (stop.guard !== undefined) return `guard ${stop.guard + 1}`;
  switch (stop.kind) {
    case 'false': return 'a guard';
    case 'hidden': return 'the visibility check';
    case 'error': return 'evaluation';
    case 'repeat': return 'the repeat check';
    case 'chance': return 'the chance roll';
    case 'too-small': return 'the size threshold';
    case 'group-chance': return 'the group chance roll';
    case 'group-hidden': return 'the group visibility check';
    case 'group-error': return 'group evaluation';
  }
}

/** Pluralize a count of times. */
function times(count: number): string {
  return `${count} ${count === 1 ? 'time' : 'times'}`;
}

/** Name the subject kind a rule iterates, for sentences like "820 city subjects". */
function subjectNoun(rule: RunRuleCoverage): string {
  return rule.subject ? `${rule.subject} subjects` : 'subjects';
}

/**
 * Summarize why a rule that never fired stopped, or why it never ran. Names the deepest step any subject
 * reached, since early filters (such as "is this my city") stop most subjects by design.
 */
export function ruleNeverFired(id: string, rule: RunRuleCoverage | undefined): string {
  if (!rule) return `Rule ${id} never fired.`;
  if (rule.disabled) return `Rule ${id} is turned off in the catalogue, so it never runs.`;
  if (!rule.subjects) return `Rule ${id} never had visible ${subjectNoun(rule)}.`;
  const last = rule.stops.at(-1);
  if (!last) return `Rule ${id} checked ${rule.subjects} ${subjectNoun(rule)} and never fired.`;
  // A guard can stop subjects for more than one reason (false, hidden, error); count them together.
  const step = rule.stops.filter(stop => last.guard === undefined ? stop === last : stop.guard === last.guard);
  const stopped = step.reduce((sum, stop) => sum + stop.count, 0);
  const reached = Math.max(...step.map(stop => stop.reached));
  const source = last.source ? ` (${last.source})` : '';
  const head = `Rule ${id} never fired: ${reached} of ${rule.subjects} ${subjectNoun(rule)} reached ${stopStep(last)}${source}`;
  return stopped >= reached ? `${head} and all stopped there.`
    : `${head}; ${stopped} stopped there and ${reached - stopped} went on without firing.`;
}

/** Summarize a rule's run-wide funnel in one sentence. */
export function ruleFunnelLine(rule: RunRuleCoverage): string {
  if (rule.disabled) return 'Turned off in the catalogue, so it never runs.';
  if (!rule.subjects) return `No visible ${subjectNoun(rule)} in any check.`;
  return `Checked ${rule.subjects} ${subjectNoun(rule)} over ${rule.checks} ${rule.checks === 1 ? 'check' : 'checks'}; fired ${rule.fired} ${rule.fired === 1 ? 'time' : 'times'} in ${rule.firedChecks} ${rule.firedChecks === 1 ? 'check' : 'checks'}.`;
}

/** List a template's editor outcomes, most frequent first, leaving out printing. */
export function unprintedOutcomes(template: TemplateCoverage): [CandidateOutcome, number][] {
  return (Object.entries(template.outcomes) as [CandidateOutcome, number][])
    .filter(([outcome, count]) => outcome !== 'printed' && count > 0)
    .sort((a, b) => b[1] - a[1]);
}

/** Compare a template's best unprinted score with the weakest printed story in the check where it came closest. */
export function scoreVersusFloor(template: TemplateCoverage): string | undefined {
  if (template.bestScore === null || template.scoreTurn === null) return undefined;
  const best = `Closest at turn ${template.scoreTurn}: scored ${formatScore(template.bestScore)}`;
  return template.floor === null ? `${best}; that check skipped, so nothing printed.`
    : `${best}; the lowest printed score that check was ${formatScore(template.floor)}.`;
}

/** Show an editor score with at most one decimal place. */
export function formatScore(score: number): string {
  return String(Math.round(score * 10) / 10);
}

/** Build the one-line reason shown beside a template. */
export function templateReason(template: TemplateCoverage, rules: ReadonlyMap<string, RunRuleCoverage>): string {
  const { funnel } = template;
  switch (template.stage) {
    case 'printed': {
      const latest = template.printedTurns[0];
      return `Printed in ${template.printed} ${template.printed === 1 ? 'check' : 'checks'}${latest === undefined ? '' : `, latest at turn ${latest}`}.`;
    }
    case 'passed-over': {
      const top = unprintedOutcomes(template)[0];
      const reached = `Reached the editor ${funnel.candidates} ${funnel.candidates === 1 ? 'time' : 'times'}`;
      const score = scoreVersusFloor(template);
      return `${reached}${top ? `, mostly ${outcomeLabels[top[0]]}` : ''}.${score ? ` ${score}` : ''}`;
    }
    case 'weighted-out': {
      const parts = [
        funnel.ineligible && `the template's when was false ${times(funnel.ineligible)}`,
        funnel.zeroWeight && `its weight was zero ${times(funnel.zeroWeight)}`,
      ].filter(Boolean);
      return `Matched ${times(funnel.matched)}; ${parts.length ? parts.join(' and ') : 'its when or weight blocked every match'}.`;
    }
    case 'unprintable':
      return funnel.unprintable >= funnel.noVariants
        ? `Matched ${times(funnel.matched)}, but no variant could fill its placeholders.`
        : `Matched ${times(funnel.matched)}, but every printable variant was ineligible or weighed zero.`;
    case 'not-together':
      return `Each rule fired, but never on the same subject in overlapping periods (${funnel.partial} partial ${funnel.partial === 1 ? 'match' : 'matches'}).`;
    case 'not-fired': {
      const silent = template.rules.find(id => rules.get(id)?.disabled)
        ?? template.rules.find(id => !rules.get(id)?.fired) ?? template.rules[0];
      return silent ? ruleNeverFired(silent, rules.get(silent)) : 'The template names no rules.';
    }
  }
}
