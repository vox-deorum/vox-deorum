/** Browser-safe template coverage: where each authored template stops on its way to print. */
import { z } from 'zod';

const count = z.number().int().nonnegative();

/**
 * Why a trigger subject or group did not fire. Keys are `false:<guard>` (the guard at that
 * index was false), `hidden:<guard>` or `error:<guard>` (the guard could not read visible evidence),
 * or one of `hidden`, `error`, `repeat`, `chance`, `too-small`, `group-chance`, `group-hidden`, `group-error`.
 */
export const coverageStopsSchema = z.record(z.string(), count);

/** One rule's trigger funnel in one check. */
export const checkRuleCoverageSchema = z.object({ subjects: count, fired: count, stops: coverageStopsSchema });

/** How far one template's matches got before candidate selection, in one check. */
export const templateFunnelSchema = z.object({
  /** Subjects where some, but not all, of a multi-trigger template's rules fired with overlapping periods. */
  partial: count,
  /** Subjects where every named rule fired with overlapping periods. */
  matched: count,
  /** Matches where no variant could fill all of its placeholders. */
  unprintable: count,
  /** Printable matches whose template weight was zero or less. */
  zeroWeight: count,
  /** Weighted matches whose every printable variant weighed zero or less. */
  noVariants: count,
  /** Candidates handed to the editor. */
  candidates: count,
});
export type TemplateFunnel = z.infer<typeof templateFunnelSchema>;

/** What the editor did with a candidate. */
export const candidateOutcomeSchema = z.enum([
  'printed', 'merged', 'outranked', 'conflict', 'printed-before', 'not-positive', 'no-variants', 'unpublished',
]);
export type CandidateOutcome = z.infer<typeof candidateOutcomeSchema>;

export const candidateCoverageSchema = z.object({
  id: z.string(), template: z.string(), subject: z.string(), rules: z.array(z.string()),
  importance: z.number().finite(), score: z.number().finite(), outcome: candidateOutcomeSchema,
  /** The printed story that absorbed this candidate. */
  mergedInto: z.string().optional(),
});
export type CandidateCoverage = z.infer<typeof candidateCoverageSchema>;

/** Compact coverage of one completed check, published or skipped. */
export const checkCoverageSchema = z.object({
  turn: z.number().int(),
  status: z.enum(['published', 'skipped']),
  reason: z.string().optional(),
  /** Lowest editor score among printed stories, or null when nothing printed. */
  printedFloor: z.number().finite().nullable(),
  rules: z.record(z.string(), checkRuleCoverageSchema),
  templates: z.record(z.string(), templateFunnelSchema),
  candidates: z.array(candidateCoverageSchema),
});
export type CheckCoverage = z.infer<typeof checkCoverageSchema>;

/**
 * The furthest stage a template failed to pass across the run, from best to worst:
 * printed; passed-over (reached the editor, never printed); weighted-out (template weight zero);
 * unprintable (no variant could print); not-together (its rules fired, never on one subject);
 * not-fired (at least one of its rules never fired).
 */
export const coverageStageSchema = z.enum(['printed', 'passed-over', 'weighted-out', 'unprintable', 'not-together', 'not-fired']);
export type CoverageStage = z.infer<typeof coverageStageSchema>;

/** One reason a rule's subjects stopped, summed across the run. */
export const ruleStopSchema = z.object({
  /** The stop key, as in `coverageStopsSchema`. */
  key: z.string(),
  kind: z.enum(['false', 'hidden', 'error', 'repeat', 'chance', 'too-small', 'group-chance', 'group-hidden', 'group-error']),
  /** Guard index in the rule's `when` list, when the stop is a guard. */
  guard: z.number().int().nonnegative().optional(),
  /** The guard's authored expression. */
  source: z.string().optional(),
  count,
});
export type RuleStop = z.infer<typeof ruleStopSchema>;

/** One rule's funnel across the run. */
export const runRuleCoverageSchema = z.object({
  id: z.string(),
  /** Subject kind the rule iterates, such as `city` or `player`. */
  subject: z.string().optional(),
  /** The catalogue turned this rule off with `enabled: false`, so it never runs. */
  disabled: z.boolean().optional(),
  /** Checks in which the rule had at least one subject. */
  checks: count,
  subjects: count,
  fired: count,
  /** Checks in which the rule fired at least once. */
  firedChecks: count,
  /** Stops, most frequent first. */
  stops: z.array(ruleStopSchema),
});
export type RunRuleCoverage = z.infer<typeof runRuleCoverageSchema>;

/** One authored template's coverage across the run. */
export const templateCoverageSchema = z.object({
  id: z.string(),
  /** Catalogue file the template came from, such as `cities-conflict`, or `other`. */
  desk: z.string(),
  tags: z.array(z.string()),
  rules: z.array(z.string()),
  stage: coverageStageSchema,
  /** Checks in which the template printed, alone or merged into a roundup story. */
  printed: count,
  /** Per-check funnel counts summed across the run. */
  funnel: templateFunnelSchema,
  /** Editor outcomes summed across the run. */
  outcomes: z.partialRecord(candidateOutcomeSchema, count),
  /** Best editor score among its unprinted candidates, or null. */
  bestScore: z.number().finite().nullable(),
  /** Lowest printed floor among published checks where it was an unprinted candidate, or null. */
  floor: z.number().finite().nullable(),
  /** Turns of the last checks where it printed, newest first, at most five. */
  printedTurns: z.array(z.number().int()),
});
export type TemplateCoverage = z.infer<typeof templateCoverageSchema>;

/** Template coverage for one replay run and receiver. */
export const runCoverageSchema = z.object({
  /** Checks with saved coverage. */
  checks: count,
  published: count,
  /** Earliest and latest covered cutoffs, or null when nothing is covered yet. */
  turns: z.object({ from: z.number().int(), to: z.number().int() }).nullable(),
  /** Editions printed before coverage was recorded for this run. */
  uncoveredIssues: count,
  templates: z.array(templateCoverageSchema),
  rules: z.array(runRuleCoverageSchema),
});
export type RunCoverage = z.infer<typeof runCoverageSchema>;
