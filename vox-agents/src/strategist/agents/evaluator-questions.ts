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
import { renderStrategistReports, type GameState, type StrategistParameters } from "../strategy-parameters.js";
import type { StrategistDecision } from "../../types/evaluation.js";

/** Share of the model's input limit the state may use, leaving room for the token estimate's error. */
const stateBudgetShare = 0.95;

/**
 * Flavor and relationship moves of this many points or fewer are sampling noise, so they keep the
 * in-game value. Persona values are whole numbers on a 1 to 10 scale and compare exactly.
 */
export const scoreDeadband = 2;

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

/** The in-game values a decision starts from, read from the `get-options` report. */
export interface StrategistCurrentValues {
  grandStrategy?: string;
  flavors: Record<string, number>;
  persona: Record<string, number>;
  /** The technology being researched next, or "None". */
  technology?: string;
  /** The next policy as `get-options` names it, such as "Sovereignty (Policy)" or "Tradition (New Branch)". */
  policy?: string;
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
  /** The in-game values the answers are compared against. */
  current: StrategistCurrentValues;
}

/** One action tool call chosen from the answers. */
export interface StrategistAction {
  name: string;
  args: Record<string, unknown>;
}

/** The calls a decision makes, with the outcome of each question and the calls it dropped. */
export interface StrategistPlan {
  actions: StrategistAction[];
  /** The decision record, listing only the dropped calls; the caller adds the actions as it runs them. */
  decision: StrategistDecision;
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

/** Read the in-game values a decision starts from out of the `get-options` report. */
function currentValues(state: GameState): StrategistCurrentValues {
  const report = state.options;
  const persona = Object.entries(report?.Persona ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return {
    grandStrategy: report?.Strategy?.GrandStrategy,
    flavors: { ...report?.Strategy?.Flavors },
    persona: Object.fromEntries(persona),
    technology: report?.Technology?.Next,
    policy: report?.Policy?.Next,
  };
}

/** Major civilizations other than the player that the player has met, by player ID. */
function metMajors(state: GameState, playerID: number | undefined): Array<[number, { Civilization: string }]> {
  return Object.entries(state.players ?? {})
    .filter(([id, player]) => typeof player !== "string" && player.IsMajor && Number(id) !== playerID)
    .map(([id, player]) => [Number(id), player as { Civilization: string }]);
}

/**
 * Build the evaluation state as markdown: the system prompt, then the reports the simple
 * strategist reads, rendered the same way (situation, the player's civilization, options, current
 * strategies, victory progress, players, cities, military, events since the last decision, and the
 * turn context). With `maxTokens`, the least important events are dropped until the whole text
 * fits, and a closing note tells the model the history is partial.
 *
 * @param system - The system prompt, since evaluation calls have no separate slot for one
 * @param parameters - The strategist parameters for this decision
 * @param state - The game state for this turn
 * @param maxTokens - The model's input limit, if it has one
 * @returns The state text for `context.evaluate`
 */
export function buildStrategistEvaluationState(
  system: string,
  parameters: StrategistParameters,
  state: GameState,
  maxTokens?: number,
): string {
  /** Render the full state with one version of the events report. */
  const render = (events: unknown) => [system, ...renderStrategistReports(parameters, state, events)].join("\n\n");

  const events = state.mergedEvents ?? state.events;
  if (!events || maxTokens === undefined) return render(events);

  const budget = Math.floor(maxTokens * stateBudgetShare);
  const trimmed = trimEventsToFit(events, candidate => countTokens(render(candidate)) <= budget);
  const text = render(trimmed.events);
  if (trimmed.droppedEvents === 0) return text;
  return `${text}\n\nNote: ${trimmed.droppedEvents} less important events were left out of # Events to fit the input limit.`;
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
  const set: StrategistQuestionSet = {
    questions: {}, flavors: [], flavorScale: scale, persona: [], relationships: [], current: currentValues(state),
  };

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

/** Whether a score moved past the deadband from its in-game value; a missing value always counts. */
function movedPastDeadband(proposed: number, current: number | undefined): boolean {
  return current === undefined || Math.abs(proposed - current) > scoreDeadband;
}

/**
 * The policy name without its trailing kind, so `get-options` and option names compare: the
 * current "Sovereignty (Policy)" and the option "Sovereignty (Continuing Tradition Branch)" share a base.
 */
function policyBase(name: string | undefined): string | undefined {
  return name?.replace(/\s*\([^)]*\)$/, "");
}

/**
 * Turn the evaluator's answers into the action tool calls that change something, in order:
 *
 * 1. `set-flavors` with the flavors that moved past the deadband, plus the grand strategy when it
 *    changed. When neither changed, `keep-status-quo` instead, which re-applies the current flavors.
 * 2. `set-persona` with the axes that changed.
 * 3. `set-relationship` for each civilization with a side past the deadband, holding the other side.
 * 4. `set-research` and `set-policy` when the choice differs from the game's.
 *
 * Score answers become the probability-weighted average of the level values. The decision records,
 * for each question, the current and proposed values and whether the proposed value was sent, and
 * lists the dropped calls.
 *
 * @param answers - The evaluator's answers, keyed by question id
 * @param set - The question set the answers belong to
 * @param parameters - The strategist parameters (for the player ID)
 * @returns The tool calls to make and the decision record so far
 */
export function strategistActionsFromAnswers(
  answers: Record<string, StrategistAnswer | undefined>,
  set: StrategistQuestionSet,
  parameters: StrategistParameters,
): StrategistPlan {
  const PlayerID = parameters.playerID;
  const Rationale = evaluatorRationale;
  const { current } = set;
  const actions: StrategistAction[] = [];
  const decision: StrategistDecision = { questions: {}, calls: [] };
  /** Record one question's outcome, leaving out values that are not known. */
  const record = (id: string, proposed: number | string | undefined, now: number | string | undefined, sent: boolean) => {
    decision.questions[id] = { ...(now === undefined ? {} : { current: now }), ...(proposed === undefined ? {} : { proposed }), sent };
  };
  /** Plan a call, or record it as dropped when there is nothing to send. */
  const plan = (name: string, args: Record<string, unknown> | undefined, target?: number) => {
    if (args) actions.push({ name, args: { PlayerID, ...args, Rationale } });
    else decision.calls.push({ tool: name, status: "dropped", ...(target === undefined ? {} : { target }) });
  };

  const grand = answers.grand_strategy?.choice;
  const grandChanged = grand !== undefined && grand !== current.grandStrategy;
  if ("grand_strategy" in set.questions) record("grand_strategy", grand, current.grandStrategy, grandChanged);
  const Flavors: Record<string, number> = {};
  for (const [id, name] of set.flavors) {
    const value = weightedValue(answers[id], set.flavorScale);
    const sent = movedPastDeadband(value, current.flavors[name]);
    if (sent) Flavors[name] = value;
    record(id, value, current.flavors[name], sent);
  }
  if (grandChanged || Object.keys(Flavors).length > 0) {
    actions.push({ name: "set-flavors", args: { PlayerID, ...(grandChanged ? { GrandStrategy: grand } : {}), Flavors, Rationale } });
  } else {
    actions.push({ name: "keep-status-quo", args: { PlayerID, Mode: "Flavor", Rationale } });
  }

  const persona: Record<string, number> = {};
  for (const [id, axis] of set.persona) {
    const value = weightedValue(answers[id], personaScale);
    const sent = value !== current.persona[axis];
    if (sent) persona[axis] = value;
    record(id, value, current.persona[axis], sent);
  }
  plan("set-persona", Object.keys(persona).length > 0 ? persona : undefined);

  for (const [TargetID, modifiers] of set.relationships) {
    // A side inside the deadband keeps its current modifier, since the call sets both.
    const args: Record<string, number> = { TargetID };
    let changed = false;
    for (const side of ["Public", "Private"] as const) {
      const id = relationshipId(side, TargetID);
      const value = weightedValue(answers[id], relationshipScales[side]);
      const now = modifiers?.[side] ?? 0;
      const sent = movedPastDeadband(value, now);
      record(id, value, now, sent);
      args[side] = sent ? value : now;
      changed ||= sent;
    }
    plan("set-relationship", changed ? args : undefined, TargetID);
  }

  const technology = answers.research?.choice;
  if ("research" in set.questions) {
    const sent = technology !== undefined && technology !== current.technology;
    record("research", technology, current.technology, sent);
    if (technology !== undefined) plan("set-research", sent ? { Technology: technology } : undefined);
  }
  const policy = answers.policy?.choice;
  if ("policy" in set.questions) {
    const sent = policy !== undefined && policyBase(policy) !== policyBase(current.policy);
    record("policy", policy, current.policy, sent);
    if (policy !== undefined) plan("set-policy", sent ? { Policy: policy } : undefined);
  }

  return { actions, decision };
}
