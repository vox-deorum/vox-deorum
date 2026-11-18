/** Editorial dispatch and validation boundary; orchestration owns atomic persistence. */
import type { NewspaperEvidence } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { IssueDocument, IssueReceiver } from '../contracts/issue.js';
import type {
  PublicationState,
  EditorialDecisionRecord,
  PublishedItemRecord,
} from '../contracts/publication.js';
import type { EditorialConfig } from './config/schema.js';
import { getEditorialTriggerExpressions } from './config/load.js';
import { addDiplomacyFacts, type NewspaperFactModel } from './facts/index.js';
import { evaluateTriggerRules, ruleHistoryTurns } from './rules/evaluate.js';
import { computeFeedback } from './selection/feedback.js';
import { selectHeuristic } from './selection/heuristic.js';
import { advanceSeries, decaySeries } from './selection/series.js';
import { matchTemplates } from './selection/templates.js';
import { evidenceConditionContext, type EditorialContext } from './shared/context.js';
import { configurationHash, createEditorialStreams } from './shared/determinism.js';
import { summarizeSources, uniqueSources } from './shared/sources.js';
import { presentIssue } from './presentation/issue.js';
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
  const context = evidenceConditionContext(evidence, input.context ?? {});
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
  const rules = await evaluateTriggerRules({
    rules: config.triggers,
    compiled: await getEditorialTriggerExpressions(config),
    facts: addDiplomacyFacts(facts, diplomacy),
    constants: config.constants,
    speedMultiplier: input.speedMultiplier,
    repeatState: input.state.triggerRepeats,
  });
  state.triggerRepeats = rules.repeatState;
  const triggers = rules.developments;
  const candidates = matchTemplates(triggers, config, context).map((candidate) => ({
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
    merges: selection.selected
      .filter((candidate) => candidate.contributingIds.length)
      .map((candidate) => ({
        candidateId: candidate.id,
        contributingIds: candidate.contributingIds,
      })),
    selectedVariants: {},
    designId: null,
    layouts: {},
    evidence: uniqueSources(selection.selected.flatMap((candidate) => candidate.sources)),
    feedback,
    diplomacyInference: diplomacy.audit,
    triggerAudit: rules.audit,
    evidenceRequest: { ...evidence.request },
  };
  /** Complete a skipped check with the same cursor and decay guarantees as a publication. */
  const skip = (reason: string): EditorialCheckResult => {
    decision.reason = reason;
    return { status: 'skipped', reason, state, decision };
  };
  if (!selection.selected.length) return skip('No eligible new authored stories.');
  const streams = createEditorialStreams(identitySeed, config);
  const presentation = presentIssue({
    issueId: `${scope}/issue/${turn}`,
    campaignId: input.campaignId,
    timelineId: input.timelineId,
    receiver: input.receiver,
    turn,
    selected: selection.selected,
    state,
    config,
    context,
    proseRandom: streams.prose,
    presentationRandom: streams.presentation,
  });
  if (!presentation) return skip('No eligible design or visible authored content.');
  const issue = validateEditorialIssue(
    presentation.issue,
    presentation.itemCandidates,
    config,
    context
  );
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
  const displayedCandidates = new Set(presentation.itemCandidates.values());
  decision.candidateScores = decision.candidateScores.map((entry) => ({
    ...entry,
    selected: [...displayedCandidates].some((candidate) => candidate.id === entry.id),
  }));
  decision.merges = [...displayedCandidates]
    .filter((candidate) => candidate.contributingIds.length)
    .map((candidate) => ({
      candidateId: candidate.id,
      contributingIds: candidate.contributingIds,
    }));
  decision.evidence = uniqueSources(
    [...displayedCandidates].flatMap((candidate) => candidate.sources)
  );
  decision.selectedVariants = presentation.variants;
  decision.designId = issue.publication.designId;
  decision.layouts = presentation.layouts;
  return { status: 'published', issue, state, decision };
}
