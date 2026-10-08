/**
 * @module strategist/agents/evaluator-questions
 *
 * Pure helpers for the evaluator strategist: build the evaluation state, ask one question per
 * decision in the Flavor-mode action space, and turn the answers into action tool calls. Persona
 * axes, the flavor scale, and the relationship descriptions come from the MCP tool schemas.
 */

import type { Experimental_EvaluationQuestion as EvaluationQuestion } from "ai";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { countTokens } from "../../utils/models/token-counter.js";
import { trimEventsToFit } from "../../utils/prompts/event-importance.js";
import { getDecisionTurnContext, type GameState, type StrategistParameters } from "../strategy-parameters.js";

/** Share of the model's input limit the state may use, leaving room for the token estimate's error. */
const stateBudgetShare = 0.95;

/** Tool arguments the caller fills in rather than the evaluator. */
const fixedArguments = new Set(["PlayerID", "Rationale", "Turn"]);

/** One level of a score scale: the tool value and what it means. */
interface ScaleLevel {
  value: number;
  label: string;
}

/** Persona score levels, within the 1 to 10 range of `set-persona`. */
const personaScale: ScaleLevel[] = [
  { value: 1, label: "minimal" },
  { value: 3, label: "low" },
  { value: 5, label: "balanced" },
  { value: 7, label: "high" },
  { value: 10, label: "extreme" },
];

/** Relationship score levels per side, within the -100 to 100 range of `set-relationship`. */
const relationshipScales: Record<"Public" | "Private", ScaleLevel[]> = {
  Public: [
    { value: -100, label: "coldest" },
    { value: -50, label: "cold" },
    { value: 0, label: "neutral" },
    { value: 50, label: "warm" },
    { value: 100, label: "warmest" },
  ],
  Private: [
    { value: -100, label: "deep enmity" },
    { value: -50, label: "enmity" },
    { value: 0, label: "indifferent" },
    { value: 50, label: "goodwill" },
    { value: 100, label: "a lot of goodwill" },
  ],
};

/** One answer as the evaluator returns it, loose enough for a question map built at runtime. */
export interface StrategistAnswer {
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
}

/** The questions for one decision, plus the game names behind each generated question id. */
export interface StrategistQuestionSet {
  questions: Record<string, EvaluationQuestion>;
  /** Flavor question ids and flavor names. */
  flavors: Array<[id: string, name: string]>;
  /** The flavor score levels, from the `set-flavors` scale. */
  flavorScale: ScaleLevel[];
  /** Persona question ids and axis names. */
  persona: Array<[id: string, axis: string]>;
  /** Target player IDs and their current modifiers, if any. */
  relationships: Array<[targetID: number, current: { Public: number; Private: number } | undefined]>;
}

/** One action tool call chosen from the answers. */
export interface StrategistAction {
  name: string;
  args: Record<string, unknown>;
}

/** Read the evaluator-facing arguments of an MCP tool, as argument name to schema description. */
function toolArguments(tools: Map<string, MCPTool>, name: string): Record<string, string> {
  const properties = tools.get(name)?.inputSchema.properties as Record<string, { description?: string }> | undefined;
  if (!properties) throw new Error(`The evaluator strategist needs the ${name} tool schema from the MCP server.`);
  return Object.fromEntries(Object.entries(properties)
    .filter(([argument]) => !fixedArguments.has(argument))
    .map(([argument, schema]) => [argument, schema.description ?? argument]));
}

/** Parse the "value = label" levels from the `set-flavors` scale description. */
function flavorScale(description: string | undefined): ScaleLevel[] {
  const levels = [...(description ?? "").matchAll(/(-?\d+)\s*=\s*([^,.]+)/g)]
    .map(([, value, label]) => ({ value: Number(value), label: label.trim() }));
  if (levels.length < 2) throw new Error(`Could not read the flavor scale from the set-flavors schema: ${description}`);
  return levels;
}

/** List option names from a `get-options` entry, which is a name-to-description map or a name list. */
function optionNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value && typeof value === "object" ? Object.keys(value) : [];
}

/** Build a score question whose criteria name each level's value and meaning. */
function scoreQuestion(instructions: string, levels: ScaleLevel[]): EvaluationQuestion {
  return { type: "score", instructions, criteria: levels.map(level => `${level.value}: ${level.label}`) };
}

/** Build a choice question over option names, or undefined when there is nothing to choose. */
function choiceQuestion(instructions: string, names: string[]): EvaluationQuestion | undefined {
  if (names.length === 0) return undefined;
  return { type: "choice", instructions, criteria: Object.fromEntries(names.map(name => [name, name])) };
}

/** The question id for one side of a relationship. */
function relationshipId(side: "Public" | "Private", targetID: number): string {
  return `relationship_${side.toLowerCase()}_${targetID}`;
}

/** Major civilizations other than the player that the player has met, by player ID. */
function metMajors(state: GameState, playerID: number | undefined): Array<[number, { Civilization: string }]> {
  return Object.entries(state.players ?? {})
    .filter(([id, player]) => typeof player !== "string" && player.IsMajor && Number(id) !== playerID)
    .map(([id, player]) => [Number(id), player as { Civilization: string }]);
}

/**
 * Build the evaluation state from the same reports the simple strategist reads: situation, the
 * player's civilization, options, current strategies, victory progress, players, cities,
 * military, events since the last decision, and the turn context. With `maxTokens`, the least
 * important events are dropped until they fit the budget the other sections leave, and
 * `EventsTrimmed` tells the model the history is partial.
 *
 * @param parameters - The strategist parameters for this decision
 * @param state - The game state for this turn
 * @param maxTokens - The model's input limit, if it has one
 * @returns A plain object for `context.evaluate`
 */
export function buildStrategistEvaluationState(
  parameters: StrategistParameters,
  state: GameState,
  maxTokens?: number,
): Record<string, unknown> {
  const { YouAre, ...Situation } = parameters.metadata || {};
  const { Options, ...Strategies } = state.options || {};
  const sections = {
    Situation,
    YouAre,
    Options,
    Strategies,
    VictoryProgress: state.victory,
    Players: state.players,
    Cities: state.cities,
    Military: state.military,
  };
  const Context = getDecisionTurnContext(parameters);

  const report = (state.mergedEvents ?? state.events) as Record<string, unknown> | undefined;
  if (!report) return { ...sections, Context };
  const { _markdownConfig: _markdown, ...events } = report;
  if (maxTokens === undefined) return { ...sections, Events: events, Context };

  const budget = Math.floor(maxTokens * stateBudgetShare) - countTokens(JSON.stringify({ ...sections, Context }));
  const trimmed = trimEventsToFit(events, candidate => countTokens(JSON.stringify(candidate)) <= budget);
  return {
    ...sections,
    Events: trimmed.events,
    ...(trimmed.droppedEvents > 0
      ? { EventsTrimmed: { DroppedTiers: trimmed.droppedTiers, DroppedEvents: trimmed.droppedEvents, Note: "Less important events were left out to fit the input limit." } }
      : {}),
    Context,
  };
}

/**
 * Build the question set for one decision: the grand strategy, one score per flavor, research,
 * policy, one score per persona axis, and public and private stance scores per met major civilization.
 *
 * @param state - The game state for this turn (its `options` report drives the action space)
 * @param playerID - The deciding player, left out of the relationship questions
 * @param tools - The MCP tool definitions, for the persona axes, flavor scale, and relationship descriptions
 * @returns The questions and the game names behind each question id
 */
export function buildStrategistQuestions(
  state: GameState,
  playerID: number | undefined,
  tools: Map<string, MCPTool>,
): StrategistQuestionSet {
  const options = state.options?.Options;
  const scale = flavorScale(toolArguments(tools, "set-flavors").Flavors);
  const set: StrategistQuestionSet = { questions: {}, flavors: [], flavorScale: scale, persona: [], relationships: [] };

  const grand = choiceQuestion("Which grand strategy should the civilization pursue now?", optionNames(options?.GrandStrategies));
  if (grand) set.questions.grand_strategy = grand;

  for (const name of optionNames(options?.Flavors)) {
    const id = `flavor_${name}`;
    set.questions[id] = scoreQuestion(`How much priority should the flavor ${name} get?`, scale);
    set.flavors.push([id, name]);
  }

  const research = choiceQuestion("Which technology should be researched next?", optionNames(options?.Technologies));
  if (research) set.questions.research = research;
  const policy = choiceQuestion("Which policy or policy branch should be adopted next?", optionNames(options?.Policies));
  if (policy) set.questions.policy = policy;

  for (const [axis, description] of Object.entries(toolArguments(tools, "set-persona"))) {
    const id = `persona_${axis}`;
    set.questions[id] = scoreQuestion(`Rate the persona trait ${axis}: ${description}`, personaScale);
    set.persona.push([id, axis]);
  }

  const relationship = toolArguments(tools, "set-relationship");
  const relationships = state.options?.Relationships ?? {};
  for (const [targetID, player] of metMajors(state, playerID)) {
    for (const side of ["Public", "Private"] as const) {
      set.questions[relationshipId(side, targetID)] = scoreQuestion(
        `${side} stance toward ${player.Civilization} (player ${targetID}): ${relationship[side]}`,
        relationshipScales[side],
      );
    }
    const current = relationships[player.Civilization];
    set.relationships.push([targetID, current && { Public: current.Public, Private: current.Private }]);
  }

  return set;
}

/**
 * The rationale for every evaluator action. It carries no probabilities: `get-options` feeds
 * rationales back into later decisions, and a likely level printed next to a weighted value misleads.
 */
export const evaluatorRationale = "Set by the evaluator.";

/**
 * Map a score answer onto the scale as the probability-weighted average of the level values.
 * An answer without probabilities takes the middle level's value.
 */
function weightedValue(answer: StrategistAnswer | undefined, levels: ScaleLevel[]): number {
  const probabilities = answer?.probabilities;
  if (!probabilities) return levels[Math.floor((levels.length - 1) / 2)].value;
  return Math.round(levels.reduce((sum, level, index) => sum + (probabilities[String(index)] ?? 0) * level.value, 0));
}

/** Format a probability as a percentage, keeping one decimal place when it has one. */
function percent(probability: number): string {
  return `${Math.round(probability * 1000) / 10}%`;
}

/**
 * Turn the evaluator's answers into action tool calls: always the flavors (with the grand strategy
 * when one was chosen) and the persona, a relationship call for each civilization whose stance
 * changed, and research and policy whenever they were answered. Score answers become the
 * probability-weighted average of the level values.
 *
 * @param answers - The evaluator's answers, keyed by question id
 * @param set - The question set the answers belong to
 * @param parameters - The strategist parameters (for the player ID)
 * @returns The tool calls to make, in order
 */
export function strategistActionsFromAnswers(
  answers: Record<string, StrategistAnswer | undefined>,
  set: StrategistQuestionSet,
  parameters: StrategistParameters,
): StrategistAction[] {
  const PlayerID = parameters.playerID;
  const grand = answers.grand_strategy?.choice;
  const Rationale = evaluatorRationale;
  const Flavors = Object.fromEntries(set.flavors.map(([id, name]) => [name, weightedValue(answers[id], set.flavorScale)]));
  const actions: StrategistAction[] = [{
    name: "set-flavors",
    args: { PlayerID, ...(grand ? { GrandStrategy: grand } : {}), Flavors, Rationale },
  }];

  const persona = Object.fromEntries(set.persona.map(([id, axis]) => [axis, weightedValue(answers[id], personaScale)]));
  actions.push({ name: "set-persona", args: { PlayerID, ...persona, Rationale } });

  for (const [TargetID, current] of set.relationships) {
    const Public = weightedValue(answers[relationshipId("Public", TargetID)], relationshipScales.Public);
    const Private = weightedValue(answers[relationshipId("Private", TargetID)], relationshipScales.Private);
    if (Public === (current?.Public ?? 0) && Private === (current?.Private ?? 0)) continue;
    actions.push({ name: "set-relationship", args: { PlayerID, TargetID, Public, Private, Rationale } });
  }

  const technology = answers.research?.choice;
  if (technology) actions.push({ name: "set-research", args: { PlayerID, Technology: technology, Rationale } });
  const policy = answers.policy?.choice;
  if (policy) actions.push({ name: "set-policy", args: { PlayerID, Policy: policy, Rationale } });

  return actions;
}

/**
 * Describe the raw answers as the evaluator's response text: one line per question with its full
 * distribution, led by the value a score maps to or the option a choice picked. Score levels are
 * named by their question criteria; choice options are listed by descending probability, without
 * zero-probability options.
 *
 * @param answers - The evaluator's answers, keyed by question id
 * @param set - The question set the answers belong to
 * @returns The response text, one line per question
 */
export function describeAnswers(
  answers: Record<string, StrategistAnswer | undefined>,
  set: StrategistQuestionSet,
): string {
  const scales = new Map<string, ScaleLevel[]>([
    ...set.flavors.map(([id]) => [id, set.flavorScale] as [string, ScaleLevel[]]),
    ...set.persona.map(([id]) => [id, personaScale] as [string, ScaleLevel[]]),
    ...set.relationships.flatMap(([targetID]) => (["Public", "Private"] as const)
      .map(side => [relationshipId(side, targetID), relationshipScales[side]] as [string, ScaleLevel[]])),
  ]);

  return Object.entries(set.questions).map(([id, question]) => {
    const answer = answers[id];
    const probabilities = answer?.probabilities;
    if (!probabilities) return `${id}: unanswered`;
    const levels = scales.get(id);
    if (question.type === "score" && levels) {
      const distribution = question.criteria.map((criterion, index) => `${String(criterion)} ${percent(probabilities[String(index)] ?? 0)}`);
      return `${id} -> ${weightedValue(answer, levels)}: ${distribution.join(", ")}`;
    }
    const distribution = Object.entries(probabilities)
      .filter(([, probability]) => probability > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([option, probability]) => `${option} ${percent(probability)}`);
    return `${id} -> ${answer?.choice ?? "none"}: ${distribution.join(", ")}`;
  }).join("\n");
}
