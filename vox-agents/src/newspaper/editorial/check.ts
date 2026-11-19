/** Editorial dispatch and validation boundary; orchestration owns atomic persistence. */
import type { NewspaperEvidence } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { IssueDocument, IssueReceiver } from '../contracts/issue.js';
import type {
  PublicationState,
  ChoiceExpressionError,
  EditorialDecisionRecord,
  PublishedItemRecord,
} from '../contracts/publication.js';
import type { EditorialConfig } from './config/schema.js';
import type {
  CompiledTriggerExpressions,
  EditorialTerm,
  EditorialTerms,
} from './config/expressions.js';
import { getEditorialExpressions } from './config/load.js';
import { scaleEditorialConstants } from './config/constants.js';
import { addDiplomacyFacts, addPressFacts, type NewspaperFactModel } from './facts/index.js';
import { evaluateTriggerRules, ruleHistoryTurns } from './rules/evaluate.js';
import { buildPress } from './rules/press.js';
import { computeFeedback } from './selection/feedback.js';
import { selectHeuristic } from './selection/heuristic.js';
import { advanceSeries, decaySeries } from './selection/series.js';
import { matchTemplates } from './selection/templates.js';
import { applyStylePreferences } from './selection/styles.js';
import type { EditorialContext } from './shared/context.js';
import type { ExpressionBatch, ExpressionCheckBudget } from './shared/expressions.js';
import { recordChoiceError } from './shared/eligibility.js';
import { configurationHash, createEditorialStreams } from './shared/determinism.js';
import { summarizeSources, uniqueSources } from './shared/sources.js';
import { presentIssue } from './presentation/issue.js';
import { evaluatePresentation } from './presentation/eligibility.js';
import { validateEditorialIssue } from './presentation/validation.js';
import { inferWarAndPeace } from './diplomacy/war-peace.js';

export interface EditorialCheckInput {
  campaignId: string;
  timelineId: string;
  receiver: IssueReceiver;
  evidence: NewspaperEvidence;
  facts: NewspaperFactModel;
  speedMultiplier: number;
  state: PublicationState;
  config: EditorialConfig;
  configurationId?: string;
  context?: EditorialContext;
}
export type EditorialCheckResult =
  | {
      status: 'published';
      issue: IssueDocument;
      state: PublicationState;
      decision: EditorialDecisionRecord;
    }
  | {
      status: 'skipped';
      reason: string;
      state: PublicationState;
      decision: EditorialDecisionRecord;
    };

/** Evaluate configured terms once per check and keep only printable values with their evidence. */
export async function evaluateEditorialTerms(
  compiled: CompiledTriggerExpressions,
  batch: Pick<ExpressionBatch, 'facts' | 'constants'>,
  budget?: ExpressionCheckBudget
): Promise<EditorialTerms> {
  const entries = [...compiled.terms.entries()];
  if (!entries.length) return new Map();
  const [[results]] = await compiled.runner.evaluate({
    ...batch,
    groups: [{ expressions: entries.map(([, slot]) => slot), subjects: [{}] }],
  }, budget);
  const terms = new Map<string, EditorialTerm>();
  entries.forEach(([name, slot], index) => {
    const result = results[index];
    if ('error' in result) {
      recordChoiceError(result, slot, budget);
      return;
    }
    const value = result.value;
    if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) return;
    terms.set(name, { value, sources: result.sources ?? [] });
  });
  return terms;
}

/** Run one immutable, deterministic check and return its complete transactional checkpoint. */
export async function runEditorialCheck(input: EditorialCheckInput): Promise<EditorialCheckResult> {
  const { config, evidence, facts } = input;
  const turn = evidence.request.cutoffTurn;
  if (evidence.request.receiverPlayerID !== input.receiver.playerId)
    throw new Error('Evidence and receiver do not match.');
  if (facts.turn !== turn || facts.previous !== evidence.request.previousCheckTurn ||
      facts.receiverId !== input.receiver.playerId)
    throw new Error('Facts must use the same cutoff, reporting period and receiver as the evidence.');
  if (
    [
      ...evidence.players,
      ...evidence.cities,
      ...evidence.comparisons.players,
      ...evidence.comparisons.cities,
      ...evidence.events,
      ...(evidence.history?.baseline.players ?? []),
      ...(evidence.history?.baseline.cities ?? []),
      ...(evidence.history?.snapshots.players ?? []),
      ...(evidence.history?.snapshots.cities ?? []),
      ...(evidence.history?.events ?? []),
      ...(evidence.diplomacy?.baseline ?? []),
      ...(evidence.diplomacy?.history ?? []),
      ...(evidence.diplomacy?.gaps ?? []),
      ...(evidence.tacticalZones ?? []),
    ].some((record) => record.source.turn > turn)
  )
    throw new Error('Evidence includes observations after the cutoff.');
  if (input.state.lastCheckTurn !== null && turn <= input.state.lastCheckTurn)
    throw new Error('The editorial cutoff must follow the last completed check.');
  if (
    input.state.lastCheckTurn !== null &&
    evidence.request.previousCheckTurn !== input.state.lastCheckTurn
  )
    throw new Error('Evidence must start after the last completed check.');
  const scope = `${encodeURIComponent(input.campaignId)}/${encodeURIComponent(input.timelineId)}/receiver/${input.receiver.playerId}`;
  const checkId = `${scope}/check/${turn}`;
  const identitySeed = `${encodeURIComponent(input.campaignId)}/receiver/${input.receiver.playerId}/${turn}`;
  const state: PublicationState = {
    ...input.state,
    lastCheckTurn: turn,
    series: decaySeries(input.state.series, turn, config.defaults.decayPerTurn),
    issues: [...input.state.issues],
    votes: { ...input.state.votes },
    preferences: { ...input.state.preferences },
  };
  const feedback = computeFeedback(state, config);
  const diplomacy = inferWarAndPeace(evidence, {
    ...input.context,
    standardTurnsPerGameTurn: 1 / input.speedMultiplier,
  }, input.state.diplomacy, ruleHistoryTurns(config.triggers, config.constants, input.speedMultiplier));
  state.diplomacy = diplomacy.memory;
  const compiled = await getEditorialExpressions(config);
  const choiceErrors = new Map<number, ChoiceExpressionError>();
  const budget: ExpressionCheckBudget = { interruptedSlots: new Set(), choiceErrors };
  const batch = {
    facts: addPressFacts(addDiplomacyFacts(facts, diplomacy), buildPress(input.state)),
    constants: scaleEditorialConstants(config.constants, input.speedMultiplier),
  };
  const rules = await evaluateTriggerRules({
    rules: config.triggers,
    compiled,
    facts: batch.facts,
    constants: config.constants,
    speedMultiplier: input.speedMultiplier,
    repeatState: input.state.triggerRepeats,
    budget,
    identitySeed,
  });
  state.triggerRepeats = rules.repeatState;
  const terms = await evaluateEditorialTerms(compiled, batch, budget);
  const triggers = rules.developments;
  const candidates = (await matchTemplates(triggers, config, compiled, batch, budget, terms)).map((candidate) => ({
    ...candidate,
    seriesKeys: candidate.seriesKeys.map((key) => `${scope}/${key}`),
  }));
  const selection = selectHeuristic(candidates, state, config, feedback);
  const decision: EditorialDecisionRecord = {
    checkId,
    cutoffTurn: turn,
    configurationId: input.configurationId ?? configurationHash(config),
    configurationSnapshot: structuredClone(config),
    seed: identitySeed,
    editor: 'heuristic',
    ...(state.preferences.llmEnabled
      ? { fallbackReason: 'LLM editor is unavailable; used authored heuristic editing.' }
      : {}),
    status: 'skipped',
    candidateScores: selection.scores,
    selectedVariants: {},
    designId: null,
    layouts: {},
    evidence: uniqueSources(selection.selected.flatMap((candidate) => candidate.sources)),
    feedback,
    diplomacyInference: diplomacy.audit,
    triggerAudit: rules.audit,
    evidenceRequest: { ...evidence.request },
  };
  const choiceLimitMessage = 'Some editorial choices could not run because the check reached its expression interruption limit.';
  /** Archive choice failures only when authoring diagnostics exist. */
  const recordChoiceErrors = () => {
    const errors = [...choiceErrors.values()];
    if (budget.choiceEvaluationIncomplete)
      errors.push({ choice: 'editorial choices', field: 'evaluation', message: choiceLimitMessage });
    if (errors.length) decision.choiceErrors = errors;
  };
  /** Complete a skipped check with the same cursor and decay guarantees as a publication. */
  const skip = (reason: string): EditorialCheckResult => {
    decision.reason = budget.choiceEvaluationIncomplete ? `${reason} ${choiceLimitMessage}` : reason;
    recordChoiceErrors();
    return { status: 'skipped', reason: decision.reason, state, decision };
  };
  if (!selection.selected.length) return skip('No eligible new authored stories.');
  const streams = createEditorialStreams(identitySeed, config);
  const weights = await evaluatePresentation(config, compiled, batch, budget);
  const { selected, sources: styleSources } = await applyStylePreferences(selection.selected, compiled, batch, budget);
  const presentation = presentIssue({
    issueId: `${scope}/issue/${turn}`,
    campaignId: input.campaignId,
    timelineId: input.timelineId,
    receiver: input.receiver,
    turn,
    selected,
    state,
    config,
    weights,
    proseRandom: streams.prose,
    presentationRandom: streams.presentation,
    terms,
  });
  if (!presentation) return skip('No eligible design or visible authored content.');
  const issue = validateEditorialIssue(presentation, config, weights);
  const records: PublishedItemRecord[] = issue.items.map((item) => {
    const candidate = presentation.itemCandidates.get(item.id)!;
    return {
      id: item.id,
      issueId: issue.issueId,
      turn,
      tags: item.tags,
      seriesKeys: item.seriesKeys,
      templateIds: candidate.templateIds,
      triggerIds: candidate.triggerIds,
      ruleIds: candidate.ruleIds,
      subject: candidate.subject,
      importance: candidate.importance,
      headline: item.headline,
      evidenceSummary: summarizeSources(candidate.sources),
      sources: candidate.sources,
      fingerprint: candidate.fingerprint,
    };
  });
  state.series = advanceSeries(state.series, records, turn);
  state.issues.push({ issueId: issue.issueId, turn, items: records });
  state.previousDesignId = issue.publication.designId;
  decision.status = 'published';
  const displayedCandidates = new Set(records.map((item) => presentation.itemCandidates.get(item.id)!.id));
  decision.candidateScores = decision.candidateScores.map((entry) => ({
    ...entry,
    selected: displayedCandidates.has(entry.id),
  }));
  decision.evidence = uniqueSources([
    ...records.flatMap((item) => item.sources),
    ...presentation.mastheadSources,
    ...[...displayedCandidates].flatMap(id => styleSources.get(id) ?? []),
  ]);
  decision.selectedVariants = presentation.variants;
  decision.selectedStyles = presentation.styles;
  decision.designId = issue.publication.designId;
  decision.layouts = presentation.layouts;
  recordChoiceErrors();
  return { status: 'published', issue, state, decision };
}
