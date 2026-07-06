/**
 * @module briefer/briefing-utils
 *
 * Shared utilities for briefing assembly, report key management, and on-demand briefing retrieval.
 * Provides promise-based deduplication so concurrent callers share in-flight briefing generation.
 * Used by strategist agents (for pre-turn briefings) and envoy/analyst agents (for on-demand briefings).
 */

import { z } from "zod";
import { Tool } from "ai";
import type { BriefingMode, SpecializedBrieferInput } from "./specialized-briefer.js";
import type { StrategistParameters, GameState } from "../strategist/strategy-parameters.js";
import { getGameState, withEventWindowFallback } from "../strategist/strategy-parameters.js";
import type { VoxContext } from "../infra/vox-context.js";
import { createSimpleTool } from "../utils/tools/simple-tools.js";

/**
 * Maps each briefing mode to its report storage key in GameState.reports
 */
export const briefingReportKeys: Record<BriefingMode, string> = {
  Military: "briefing-military",
  Economy: "briefing-economy",
  Diplomacy: "briefing-diplomacy"
};

/**
 * Instruction keys in workingMemory for each briefing mode.
 * Strategists set these via the focus-briefer tool.
 */
export const briefingInstructionKeys: Record<BriefingMode | "combined", string> = {
  combined: "briefer-instruction",
  Military: "briefer-instruction-military",
  Economy: "briefer-instruction-economy",
  Diplomacy: "briefer-instruction-diplomacy"
};

/**
 * Fold the three per-mode focus instructions (set by the focus-briefer tool) into a single
 * instruction for the combined/simple briefer, persisting it under
 * briefingInstructionKeys.combined so requestBriefing("combined", …) can read it back.
 *
 * @param parameters - Strategy parameters holding workingMemory
 * @returns The combined instruction string (also stored in workingMemory)
 */
export function buildCombinedInstruction(parameters: StrategistParameters): string {
  const instruction = [
    `- Military: ${parameters.workingMemory[briefingInstructionKeys.Military] ?? "a general report."}`,
    `- Economy: ${parameters.workingMemory[briefingInstructionKeys.Economy] ?? "a general report."}`,
    `- Diplomacy: ${parameters.workingMemory[briefingInstructionKeys.Diplomacy] ?? "a general report."}`
  ].join("\n\n");
  parameters.workingMemory[briefingInstructionKeys.combined] = instruction;
  return instruction;
}

/**
 * Clear all briefer focus instructions from working memory once a briefing has been generated,
 * so one turn's focus does not leak into the next.
 */
export function clearBrieferInstructions(parameters: StrategistParameters): void {
  for (const key of Object.values(briefingInstructionKeys)) {
    delete parameters.workingMemory[key];
  }
}

/**
 * Find the briefing-bearing game state closest to a target turn — i.e. the nearest past
 * decision point. Only turns strictly before the current turn whose `reports` contain one of
 * `reportKeys` are considered; the one minimizing `|turn - targetTurn|` is returned.
 *
 * This replaces a fixed `turn - 5` lookback that, under pacing, lands on skipped turns with no
 * briefing (rendering `undefined` into prompts and silently dropping the comparison). By
 * snapping to the closest turn that actually has a briefing, it works for any pacing cadence
 * and is still ≈ `turn - 5` when a briefing exists every turn.
 *
 * @param parameters - Strategy parameters holding the per-turn game states
 * @param targetTurn - The ideal lookback turn (e.g. game-speed adjusted `turn - 5`)
 * @param reportKeys - Report keys to look for, in precedence order (e.g. `["briefing-military", "briefing"]`)
 * @returns The closest matching past state, or undefined when no prior briefing exists yet
 */
export function getLastBriefingState(
  parameters: StrategistParameters,
  targetTurn: number,
  reportKeys: string[]
): GameState | undefined {
  let best: GameState | undefined;
  let bestDistance = Infinity;

  for (const turnStr of Object.keys(parameters.gameStates)) {
    const turn = Number(turnStr);
    if (turn >= parameters.turn) continue;

    const state = parameters.gameStates[turn];
    if (!reportKeys.some((key) => state.reports[key])) continue;

    const distance = Math.abs(turn - targetTurn);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = state;
    }
  }

  return best;
}

/**
 * Requests a single briefing with promise-based deduplication.
 * Returns cached results, awaits in-flight generation, or starts new generation.
 * If a combined ("briefing") result exists or is pending, it serves as fallback for any specific mode.
 * Instructions are read from parameters.workingMemory automatically (set by the strategist's focus-briefer tool).
 *
 * @param mode - The briefing mode: "Military", "Economy", "Diplomacy", or "combined"
 * @param state - The game state containing cached reports and pending promises
 * @param context - VoxContext for calling briefer agents
 * @param parameters - Agent parameters passed to the briefer agents
 * @param agent - Override the default briefer agent ("simple-briefer" for combined, "specialized-briefer" for modes)
 * @returns The briefing content, or undefined if generation fails
 */
export async function requestBriefing(
  mode: BriefingMode | "combined",
  state: GameState,
  context: VoxContext<StrategistParameters>,
  parameters: StrategistParameters,
  agent?: string
): Promise<string | undefined> {
  const reportKey = mode === "combined" ? "briefing" : briefingReportKeys[mode as BriefingMode];

  // 1. Return cached mode-specific result
  if (state.reports[reportKey]) {
    return state.reports[reportKey];
  }

  // 2. For specific modes, check combined result as fallback
  if (mode !== "combined" && state.reports["briefing"]) {
    return state.reports["briefing"];
  }

  // Initialize pending registry if needed
  state._pendingBriefings = state._pendingBriefings || {};

  // 3. Await in-flight mode-specific generation
  if (reportKey in state._pendingBriefings) {
    return state._pendingBriefings[reportKey];
  }

  // 4. For specific modes, await in-flight combined generation as fallback
  if (mode !== "combined" && "briefing" in state._pendingBriefings) {
    return state._pendingBriefings["briefing"];
  }

  // 5. Start new generation with the specified or default briefer agent
  const defaultAgent = mode === "combined" ? "simple-briefer" : "specialized-briefer";
  const agentName = agent ?? defaultAgent;

  // Read instruction from working memory (set by strategist's focus-briefer tool)
  const instruction = parameters.workingMemory[briefingInstructionKeys[mode]] ?? "";

  const input = agentName === "simple-briefer"
    ? instruction
    : { mode, instruction } as SpecializedBrieferInput;

  const promise = generateBriefing(agentName, input, state, context, parameters);

  // Track and clean up the promise
  const tracked = promise.finally(() => {
    if (state._pendingBriefings?.[reportKey] === tracked) {
      delete state._pendingBriefings[reportKey];
    }
  });

  state._pendingBriefings[reportKey] = tracked;
  return tracked;
}

/**
 * Invoke a briefer agent, narrowing the event window on context-length overflow.
 *
 * The first attempt reads the state as the caller left it — the briefer consumes
 * `state.mergedEvents ?? state.events`, so a strategist that already established a decision window
 * gets the full window, while an on-demand envoy/analyst caller (no window) gets the immutable
 * per-turn slice. Only when the briefer overflows the model context does it retry against
 * progressively narrower windows via {@link withEventWindowFallback}, which rewrites
 * `state.mergedEvents` (never the slice) — mirroring the strategist's own
 * `executeDecisionWithEventFallback` so pacing's large multi-turn windows no longer lose a turn.
 */
async function generateBriefing(
  agentName: string,
  input: unknown,
  state: GameState,
  context: VoxContext<StrategistParameters>,
  parameters: StrategistParameters
): Promise<string | undefined> {
  let result: string | undefined;
  let contextLengthExceeded = false;

  const attempt = async (): Promise<boolean> => {
    contextLengthExceeded = false;
    const output = await context.callAgent<string>(agentName, input, () => {
      contextLengthExceeded = true;
    });
    if (output) {
      result = output;
      return true;
    }
    return false;
  };

  // First attempt with the caller-populated event window.
  if (await attempt()) return result;

  // Only narrow on a genuine context-length overflow; other failures won't be helped by it.
  if (!contextLengthExceeded) return result;

  const eventFromTurn = parameters.lastDecisionTurn === undefined
    ? parameters.turn
    : parameters.lastDecisionTurn + 1;
  await withEventWindowFallback(parameters, state, eventFromTurn, attempt);
  return result;
}

/**
 * Creates the get-briefing internal tool for on-demand briefing retrieval.
 * Shared by LiveEnvoy and Analyst base classes.
 * Uses requestBriefing() for deduplication — concurrent callers share in-flight generation.
 *
 * @param context - VoxContext for calling briefer agents when briefings are missing
 * @returns A Tool instance for the get-briefing tool
 */
export function createBriefingTool(context: VoxContext<StrategistParameters>): Tool {
  return createSimpleTool({
    name: "get-briefing",
    description: "Retrieve strategic briefings for one or more categories. Returns existing briefings or generates new ones if unavailable.",
    inputSchema: z.object({
      Categories: z.array(z.enum(['Military', 'Economy', 'Diplomacy']))
        .min(1)
        .describe("The briefing categories to retrieve")
    }),
    execute: async (input, parameters) => {
      const state = getGameState(parameters, parameters.turn);
      if (!state) {
        return "No game state available for briefing retrieval.";
      }
      const sections = await Promise.all(
        input.Categories.map(async (cat: BriefingMode) => ({
          title: `${cat} Briefing`,
          content: (await requestBriefing(cat, state, context, parameters)) ?? "(Briefing unavailable for this category)"
        }))
      );
      return assembleBriefings(sections);
    }
  }, context);
}

/**
 * Assembles briefing content with optional instructions.
 * Can handle both single briefings and multiple briefing sections.
 *
 * @param briefings - Either a single briefing content string, or an array of briefing sections with titles
 * @param instruction - Optional instruction for single briefing mode
 * @returns Formatted briefing markdown
 */
export function assembleBriefings(
  briefings: string | Array<{ title: string; content: string; instruction?: string }>,
  instruction?: string
): string {
  // Single briefing mode (simple-strategist-briefed)
  if (typeof briefings === "string") {
    if (instruction) {
      return `Produced with your instruction: \n\n${instruction}\n\n${briefings}`;
    }
    return briefings;
  }

  // Multiple briefing sections mode (staffed strategist)
  return briefings
    .map((b) => {
      if (b.instruction) {
        return `## ${b.title}\n(Produced with your instruction: ${b.instruction})\n\n${b.content}`;
      }
      return `## ${b.title}\n${b.content}`;
    })
    .join("\n\n");
}
