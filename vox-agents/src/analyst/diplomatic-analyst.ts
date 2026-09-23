/**
 * @module analyst/diplomatic-analyst
 *
 * Evaluates field reports once, then relays reports selected by the evaluator.
 */

import type { Experimental_EvaluationQuestion as EvaluationQuestion } from "ai";
import type { Model, EnvoyThread } from "../types/index.js";
import { audienceID, identityOf } from "../utils/diplomacy/transcript/transcript-utils.js";
import type { PreparedAgentState } from "../infra/vox-agent.js";
import { Analyst, AnalystInput } from "./analyst.js";
import { VoxContext } from "../infra/vox-context.js";
import { getGameState, StrategistParameters } from "../strategist/strategy-parameters.js";

const reportCategories = ["Diplomacy", "Military", "Economy", "Others"] as const;

const evaluationQuestions = {
  relay: {
    type: "boolean",
    instructions: "Should this report be relayed to the leader because it is actionable, significant, or changes diplomatic posture?",
  },
  type: {
    type: "choice",
    instructions: "Classify the report.",
    criteria: { 
      Diplomatic: "Official communication, proposal, declaration, threat, or agreement", 
      Intelligence: "Gathered information or observation",
      Rumor: "Gathered rumor, potentially useful information, or insight"
    },
  },
  Diplomacy: {
    type: "boolean",
    instructions: "Does this report concern diplomacy, relationships, agreements, or foreign policy? Assess independently of the other categories.",
  },
  Military: {
    type: "boolean",
    instructions: "Does this report concern military forces, war plans, security, or combat? Assess independently of the other categories.",
  },
  Economy: {
    type: "boolean",
    instructions: "Does this report concern the economy, trade, resources, growth, or production? Assess independently of the other categories.",
  },
  Others: {
    type: "boolean",
    instructions: "Does this report contain strategically relevant information outside diplomacy, military, and economy? It may also belong to those categories.",
  },
  confidence: {
    type: "score",
    instructions: "Score the report's reliability from 0 to 9, preserving fractional scores.",
    criteria: ["0: unsupported", "1: very weak", "2: weak", "3: limited", "4: below moderate", "5: moderate", "6: fairly strong", "7: strong", "8: very strong", "9: authoritative"],
  },
  importance: {
    type: "score",
    instructions: "Score strategic urgency from 0 to 9, preserving fractional scores.",
    criteria: ["0: negligible", "1: minimal", "2: very low", "3: low", "4: limited", "5: moderate", "6: notable", "7: important", "8: urgent", "9: critical"],
  },
} satisfies Record<string, EvaluationQuestion>;

/** Normalize civilization and leader names for exact matching and mention extraction. */
function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Resolve source and subject IDs from the visible player snapshot and calling conversation. */
function resolvePlayers(input: AnalystInput, parameters: StrategistParameters, callerInput?: unknown): NonNullable<AnalystInput["_playerIDs"]> {
  const players = new Map<number, string[]>();
  for (const [id, player] of Object.entries(getGameState(parameters, parameters.turn)?.players ?? {})) {
    if (typeof player !== "string" && player.IsMajor) {
      players.set(Number(id), [player.Civilization, player.Leader].filter(Boolean).map(normalizeName));
    }
  }
  const thread = callerInput as EnvoyThread | undefined;
  if (thread?.diplomacy) {
    for (const id of [thread.player1ID, thread.player2ID]) {
      const identity = identityOf(thread, id);
      if (identity) players.set(id, [...(players.get(id) ?? []), ...[identity.name, identity.leader].filter(Boolean).map(normalizeName)]);
    }
  }
  /** Resolve an explicit name without silently selecting an ambiguous civilization. */
  const resolveName = (name: string): number => {
    const matches = [...players].filter(([, names]) => names.includes(normalizeName(name)));
    if (matches.length !== 1) throw new Error(`Report player "${name}" is unknown or ambiguous.`);
    return matches[0][0];
  };
  const fromPlayerID = input.FromPlayer?.trim()
    ? resolveName(input.FromPlayer)
    : thread?.diplomacy ? audienceID(thread) : undefined;
  if (fromPlayerID === undefined) throw new Error("FromPlayer is required outside a civilization diplomacy conversation.");
  const text = ` ${normalizeName(input.Content)} ${normalizeName(input.Memo)} `;
  const aboutPlayerIDs = input.AboutPlayers === undefined
    ? [...players].filter(([, names]) => names.some(name => name && text.includes(` ${name} `))).map(([id]) => id)
    : input.AboutPlayers.map(resolveName);
  return { FromPlayerID: fromPlayerID, AboutPlayerIDs: [...new Set(aboutPlayerIDs)] };
}

/** Diplomatic analyst that evaluates a report in one structured model call. */
export class DiplomaticAnalyst extends Analyst {
  readonly name = "diplomatic-analyst";
  readonly description = "An intelligence analyst who evaluates diplomatic reports and relays important information to the leader";
  public override toolDescription = "Report information to the intelligence analyst for assessment and relay to the leader. Returns immediately.";

  /** Resolve report identities while the caller's conversation is still available. */
  public override resolveHandoffInput(callerArgs: unknown, context: VoxContext<StrategistParameters>): AnalystInput {
    const args = callerArgs as AnalystInput;
    return { ...args, _playerIDs: resolvePlayers(args, context.currentParameters!, context.currentInput) };
  }

  /** Build the analyst identity prompt. */
  public async getSystem(parameters: StrategistParameters): Promise<string> {
    const leader = parameters.metadata?.YouAre?.Leader ?? "your leader";
    const civName = parameters.metadata?.YouAre?.Name ?? "your civilization";
    return `You are an intelligence analyst serving ${civName}, under ${leader}. Evaluate whether the report warrants relay, classify its type and all relevant subject categories, and score confidence and importance from 0 to 9.`;
  }

  /** Prepare report, game context, and diplomatic history once for both evaluation and traces. */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: AnalystInput,
    context: VoxContext<StrategistParameters>,
  ): Promise<PreparedAgentState["messages"]> {
    input._playerIDs ??= resolvePlayers(input, parameters, context.currentInput);
    const { FromPlayerID, AboutPlayerIDs } = input._playerIDs;
    const history = await Promise.all([...new Set([FromPlayerID, ...AboutPlayerIDs])].map(async playerID => {
      const events = await context.callTool("get-diplomatic-events", {
        PlayerID: parameters.playerID,
        OtherPlayerID: playerID,
        FromTurn: Math.max(0, parameters.turn - 15),
        ToTurn: parameters.turn,
        Formatted: true,
      }, parameters);
      return events == null || (typeof events === "object" && "isError" in events && events.isError === true)
        ? { PlayerID: playerID, status: "unavailable" }
        : { PlayerID: playerID, status: "available", events };
    }));
    const reportMessage = {
      role: "user" as const,
      content: JSON.stringify({
        context: input.Context,
        content: input.Content,
        memo: input.Memo,
        ...input._playerIDs,
        diplomaticHistory: history,
      }),
    };
    return [...this.getContextMessages(parameters), reportMessage];
  }

  /** Score the prepared report once and relay it only when the evaluator selects it. */
  public override async executeEvaluation(
    parameters: StrategistParameters,
    input: AnalystInput,
    context: VoxContext<StrategistParameters>,
    prepared: PreparedAgentState,
    model: Model,
    tokenOutput?: import("../infra/vox-run.js").ExecuteTokenOutput,
  ): Promise<string | undefined> {
    const result = await context.evaluate(model, prepared, { questions: evaluationQuestions, tokenOutput });
    const answers = result.answers;
    if (answers.relay.probability < 0.5) return undefined;
    context.currentSignal().throwIfAborted();
    const relay = await context.callTool("relay-message", {
      PlayerID: parameters.playerID,
      ...(input._playerIDs ?? resolvePlayers(input, parameters)),
      Message: answers.type.choice,
      Content: input.Content.slice(0, 4000),
      Confidence: answers.confidence.score,
      Importance: answers.importance.score,
      Categories: reportCategories.filter(category => answers[category].probability >= 0.5),
      Memo: input.Memo.slice(0, 500),
    }, parameters);
    if (relay == null || (typeof relay === "object" && (
      ("isError" in relay && relay.isError === true) ||
      ("Success" in relay && relay.Success === false)
    ))) {
      throw new Error("Diplomatic analyst relay-message tool failed.");
    }
    return "Report relayed to the leader.";
  }
}
