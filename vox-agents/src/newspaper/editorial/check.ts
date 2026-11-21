/** Editorial dispatch and validation boundary; orchestration owns atomic persistence. */
import type { NewspaperEvidence, NewspaperSourceReference } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { IssueDocument, IssueReceiver } from '../contracts/issue.js';
import type {
  PublicationState,
  ChoiceExpressionError,
  EditorialDecisionRecord,
  PublishedItemRecord,
} from '../contracts/publication.js';
import { minimumFrontSlots, type EditorialConfig } from './config/schema.js';
import type {
  CompiledTriggerExpressions,
  EditorialTerm,
  EditorialTerms,
} from './config/expressions.js';
import { getEditorialExpressions } from './config/load.js';
import { scaleEditorialConstants } from './config/constants.js';
import { resolveCivicVocabulary } from './facts/civic-terms.js';
import { addDiplomacyFacts, addPressFacts, type NewspaperFactModel } from './facts/index.js';
import { evaluateTriggerRules, ruleHistoryTurns } from './rules/evaluate.js';
import { buildPress } from './rules/press.js';
import { computeFeedback } from './selection/feedback.js';
import { publishedFingerprints, selectHeuristic } from './selection/heuristic.js';
import { mergeSelectedStories } from './selection/merge.js';
import { advanceSeries, decaySeries } from './selection/series.js';
import { matchTemplates } from './selection/templates.js';
import { applyStylePreferences } from './selection/styles.js';
import type { EditorialContext } from './shared/context.js';
import type { ExpressionBatch, ExpressionCheckBudget } from './shared/expressions.js';
import { recordChoiceError } from './shared/eligibility.js';
import { configurationHash, createProseDraw } from './shared/determinism.js';
import { summarizeSources, uniqueSources } from './shared/sources.js';
import { presentIssue } from './presentation/issue.js';
import { evaluatePresentation, fittingFrontLayouts, prepareFrontLayouts } from './presentation/eligibility.js';
import { selectMastheadRule } from './presentation/masthead-rules.js';
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
      ...(evidence.tacticalZones ?? []).flatMap(zone => zone.previousPosture ? [zone.previousPosture] : []),
      ...(evidence.culturalInfluence?.baseline ? [evidence.culturalInfluence.baseline] : []),
      ...(evidence.culturalInfluence?.observations ?? []),
      ...(evidence.congress?.baseline ? [evidence.congress.baseline] : []),
      ...(evidence.congress?.observations ?? []),
    ].some((record) => record.source.turn > turn)
  )
    throw new Error('Evidence includes observations after the cutoff.');
  if (input.state.lastCheckTurn !== null && turn <= input.state.lastCheckTurn)
    throw new Error('The editorial cutoff must follow the last completed check.');
  if (
    input.state.reportingThroughTurn !== null &&
    evidence.request.previousCheckTurn !== input.state.reportingThroughTurn
  )
    throw new Error('Evidence must start at the open reporting window.');
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
  const terms = new Map(await evaluateEditorialTerms(compiled, batch, budget));
  if (config.civicTerms)
    for (const [slot, term] of resolveCivicVocabulary(
      facts.players[input.receiver.playerId]?.current,
      config.civicTerms
    ))
      terms.set(`civic.${slot}`, term);
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
  /** Commit observed resets and spend repeats only for series that actually printed. */
  const commitRepeats = (published: readonly PublishedItemRecord[]) => {
    const printed = new Set(published.flatMap(item => item.seriesKeys.map(key => key.slice(scope.length + 1))));
    state.triggerRepeats = { ...input.state.triggerRepeats };
    for (const [key, current] of Object.entries(rules.repeatState))
      if (current.armed || printed.has(key)) state.triggerRepeats[key] = current;
  };
  /** Leave matches and diplomacy available for the next check. */
  const skip = (reason: string): EditorialCheckResult => {
    commitRepeats([]);
    decision.reason = budget.choiceEvaluationIncomplete ? `${reason} ${choiceLimitMessage}` : reason;
    recordChoiceErrors();
    return { status: 'skipped', reason: decision.reason, state, decision };
  };
  if (selection.selected.length < minimumFrontSlots)
    return skip(`Only ${selection.selected.length} of ${minimumFrontSlots} required front articles are ready.`);
  const weights = await evaluatePresentation(config, compiled, batch, budget);
  const fronts = prepareFrontLayouts(config, weights, terms);
  const merged = await mergeSelectedStories(
    selection.selected, candidates, config, compiled, batch, budget, publishedFingerprints(state),
    (count, urgent) => fittingFrontLayouts(fronts, count, urgent).size > 0, terms,
  );
  const urgent = merged.some(candidate => candidate.urgent);
  const fittingFronts = fittingFrontLayouts(fronts, merged.length, urgent);
  let styleSources = new Map<string, NewspaperSourceReference[]>();
  const presentation = await presentIssue({
    checkId,
    issueId: `${scope}/issue/${turn}`,
    campaignId: input.campaignId,
    timelineId: input.timelineId,
    receiver: input.receiver,
    turn,
    selected: merged,
    state,
    config,
    weights,
    proseRandom: createProseDraw(identitySeed, config),
    fittingFronts,
    prepareProse: async (candidates) => {
      const { selected, sources } = await applyStylePreferences(candidates, compiled, batch, budget);
      styleSources = sources;
      return selected;
    },
    recordDesignSelection: (audit) => { decision.designSelection = audit; },
    terms,
    selectMasthead: (design) => selectMastheadRule({
      campaignId: input.campaignId,
      receiverPlayerId: input.receiver.playerId,
      design,
      rules: config.mastheadRules ?? [],
      compiled,
      batch,
      budget,
      terms,
    }),
  });
  if (!presentation) {
    const slots = [...fronts.values()].flatMap(layouts => layouts
      .filter(layout => (layout.variant === 'breaking') === urgent)
      .map(layout => layout.frontSlots));
    const kind = urgent ? 'breaking' : 'regular';
    return slots.length
      ? skip(`Only ${merged.length} of ${Math.min(...slots)} required ${kind} front articles are ready.`)
      : skip(`No eligible ${kind} front layout for ${merged.length} ready articles.`);
  }
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
      ...(candidate.ruleSubjects ? { ruleSubjects: candidate.ruleSubjects } : {}),
      subject: candidate.subject,
      importance: candidate.importance,
      headline: item.headline,
      evidenceSummary: summarizeSources(candidate.sources),
      sources: candidate.sources,
      fingerprint: candidate.fingerprint,
      ...(candidate.coveredFingerprints ? { coveredFingerprints: candidate.coveredFingerprints } : {}),
    };
  });
  state.reportingThroughTurn = turn;
  state.diplomacy = diplomacy.memory;
  commitRepeats(records);
  state.series = advanceSeries(state.series, records, turn);
  state.issues.push({ issueId: issue.issueId, turn, items: records, designId: issue.publication.designId });
  decision.status = 'published';
  const displayedCandidates = new Set<string>();
  const mergedInto = new Map<string, string>();
  const originalScores = new Map(selection.scores.map(({ id, score }) => [id, score]));
  for (const candidate of presentation.itemCandidates.values()) {
    displayedCandidates.add(candidate.id);
    if (!candidate.mergedCandidateIds) continue;
    for (const id of candidate.mergedCandidateIds) mergedInto.set(id, candidate.id);
    // The merge is a presentation choice, so its audit score reports the strongest original.
    const score = Math.max(...candidate.mergedCandidateIds.map(id => originalScores.get(id)!));
    decision.candidateScores.push({ id: candidate.id, score, selected: true });
  }
  decision.candidateScores = decision.candidateScores.map((entry) => {
    const replacement = mergedInto.get(entry.id);
    return { ...entry, selected: displayedCandidates.has(entry.id), ...(replacement ? { mergedInto: replacement } : {}) };
  });
  decision.evidence = uniqueSources([
    ...records.flatMap((item) => item.sources),
    ...presentation.mastheadSources,
    ...[...styleSources.values()].flat(),
  ]);
  decision.selectedVariants = presentation.variants;
  decision.selectedStyles = presentation.styles;
  decision.designId = issue.publication.designId;
  if (presentation.mastheadRuleId !== undefined) decision.mastheadRuleId = presentation.mastheadRuleId;
  decision.layouts = presentation.layouts;
  recordChoiceErrors();
  return { status: 'published', issue, state, decision };
}
