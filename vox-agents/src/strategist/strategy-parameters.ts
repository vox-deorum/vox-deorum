import { ModelMessage } from "ai";
import { AgentParameters } from "../infra/vox-agent.js";
import { VoxContext } from "../infra/vox-context.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import type { CitiesReport } from "../../../mcp-server/dist/tools/knowledge/get-cities.js";
import type { PlayersReport } from "../../../mcp-server/dist/tools/knowledge/get-players.js";
import type { EventsReport } from "../../../mcp-server/dist/tools/knowledge/get-events.js";
import type { MilitaryReport } from "../../../mcp-server/dist/tools/knowledge/get-military-report.js";
import type { OptionsReport } from "../../../mcp-server/dist/tools/knowledge/get-options.js";
import type { VictoryProgressReport } from "../../../mcp-server/dist/tools/knowledge/get-victory-progress.js";
import type { GameMetadata } from "../../../mcp-server/dist/tools/knowledge/get-game-settings.js"
import { StrategyDecisionType } from "../types/config.js";
import type { HumanDecisionBus } from "./human-decision-bus.js";

/**
 * Parameters for the strategist agent
 */
export interface StrategistParameters extends AgentParameters {
  /** Fetch events after this ID */
  after: number;
  /** Fetch events equals to or before this ID */
  before: number;
  /** Metadata of the game */
  metadata?: GameMetadata;
  /** A short-term working memory of the agent */
  workingMemory: Record<string, string>;
  /** Map of turn numbers to game states as a memory store */
  gameStates: Record<number, GameState>;
  /** Decision type the strategist is going to make. */
  mode: StrategyDecisionType;
  /** Last turn where this player completed strategic decision-making. */
  lastDecisionTurn?: number;
  /** Pre-defined sync random seed (RandomSeedsConfig.sync) configured in vox-agents, if fixed. */
  syncSeed?: number;
  /** Internal: in-flight game state refresh promise for deduplication (not serialized) */
  _pendingRefresh?: Promise<GameState>;
  /** Internal: the session's per-game human-decision bus (not serialized). Populated
   * for every seat by VoxPlayer, but only the human strategist reads it to block on
   * and receive the panel's submission. */
  _humanDecisionBus?: HumanDecisionBus;
}

/**
 * Game state snapshot containing all relevant game information at a specific turn
 */
export interface GameState {
  /** The turn number. */
  turn: number;
  /** Player information including civilizations, leaders, and diplomacy */
  players?: PlayersReport;
  /** Game events that occurred during this turn */
  events?: EventsReport;
  /** Cities data including population, production, and buildings */
  cities?: CitiesReport;
  /** Available strategic and tactical options */
  options?: OptionsReport;
  /** Military units, positions, and combat status */
  military?: MilitaryReport;
  /** Victory condition progress and standings */
  victory?: VictoryProgressReport;
  /** Additional reports (e.g. briefings) */
  reports: Record<string, string>;
  /** Internal: pending briefing generation promises for deduplication (not serialized) */
  _pendingBriefings?: Record<string, Promise<string | undefined>>;
}

/**
 * Checks if a tool call result is an error result
 * @param result - The result from a tool call
 * @returns True if the result indicates an error
 */
function isErrorResult(result: unknown): boolean {
  return result == null ||
    (typeof result === 'object' &&
      'isError' in result &&
      (result as Record<string, unknown>).isError === true);
}

/**
 * Extracts human-readable error text from an error result
 * @param result - The error result object
 * @returns A string description of the error
 */
function extractErrorText(result: unknown): string {
  if (result == null) return 'No result returned';
  if (result != null && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (obj.error) return String(obj.error);
    if (obj.message) return String(obj.message);
  }
  return 'Unknown error';
}

/**
 * Refreshes strategy parameters by fetching all required game state information
 * @param context - The VoxContext to use for calling tools
 * @param parameters - The strategy parameters to refresh
 * @param cullLimit - Number of past turns to keep (default: 10)
 * @returns The updated strategy parameters
 */
export async function refreshGameState(
  context: VoxContext<StrategistParameters>,
  parameters: StrategistParameters,
  cullLimit: number = 10
): Promise<GameState> {
  // Get the game metadata as a prerequisite
  parameters.metadata = parameters.metadata ??
    await context.callTool<GameMetadata>("get-game-settings", { PlayerID: parameters.playerID }, parameters);

  // Get the information
  const [players, events, cities, options, victory, military] = await Promise.all([
    context.callTool<PlayersReport>("get-players", {}, parameters),
    // Fetch every event since the last fetched ID (parameters.after is the cursor,
    // advanced one turn per processed turn by the strategist loop). A turn that was
    // dropped before it could be processed folds its events into this window, so
    // nothing is lost. Decision turns reassemble these per-turn slices via
    // mergeCachedEvents. We fetch the consolidated (optimized) format so strategists
    // and briefers get the compact turn-keyed report; pacing interruption checks
    // parse that same consolidated shape.
    context.callTool<EventsReport>("get-events", { After: parameters.after, Before: parameters.before }, parameters),
    context.callTool<CitiesReport>("get-cities", {}, parameters),
    context.callTool<OptionsReport>("get-options", { Mode: parameters.mode }, parameters),
    context.callTool<VictoryProgressReport>("get-victory-progress", {}, parameters),
    context.callTool<MilitaryReport>("get-military-report", {}, parameters),
  ]);

  // Validate all results are defined and not errors
  if (isErrorResult(players)) throw new Error(`Failed to fetch players: ${extractErrorText(players)}`);
  if (isErrorResult(events)) throw new Error(`Failed to fetch events: ${extractErrorText(events)}`);
  if (isErrorResult(cities)) throw new Error(`Failed to fetch cities: ${extractErrorText(cities)}`);
  if (isErrorResult(options)) throw new Error(`Failed to fetch options: ${extractErrorText(options)}`);
  if (isErrorResult(victory)) throw new Error(`Failed to fetch victory: ${extractErrorText(victory)}`);
  if (isErrorResult(military)) throw new Error(`Failed to fetch military: ${extractErrorText(military)}`);

  // Create the current game state snapshot
  const currentState: GameState = {
    players,
    events,
    cities,
    options,
    military,
    victory,
    reports: {},
    turn: parameters.turn
  };

  // Update and return parameters with the new game state stored by turn
  parameters.gameStates[parameters.turn] = currentState;

  // Cull old game states - keep only states within cullLimit turns before current turn
  // and remove any future states (after current turn)
  const currentTurn = parameters.turn;
  const oldestAllowedTurn = currentTurn - cullLimit;

  for (const turnStr of Object.keys(parameters.gameStates)) {
    const turn = Number(turnStr);
    // Remove states that are either in the future or too old
    if (turn > currentTurn || turn < oldestAllowedTurn) {
      delete parameters.gameStates[turn];
    }
  }

  return currentState;
}

/**
 * Returns the game state for the current turn, deduplicating concurrent refresh calls.
 * If the state is already cached, returns immediately. If a refresh is in-flight, awaits it.
 * Otherwise starts a new refresh and registers the promise for deduplication.
 * @param context - The VoxContext to use for calling tools
 * @param parameters - The strategy parameters to check/refresh
 * @param cullLimit - Number of past turns to keep (default: 10)
 * @returns The game state for the current turn
 */
export async function ensureGameState(
  context: VoxContext<StrategistParameters>,
  parameters: StrategistParameters,
  cullLimit: number = 10
): Promise<GameState> {
  // Return cached state if available
  if (parameters.gameStates[parameters.turn]) {
    return parameters.gameStates[parameters.turn];
  }

  // Await in-flight refresh if one exists
  if (parameters._pendingRefresh) {
    return parameters._pendingRefresh;
  }

  // Start a new refresh and track the promise
  const refreshPromise = refreshGameState(context, parameters, cullLimit)
    .finally(() => {
      if (parameters._pendingRefresh === refreshPromise) {
        parameters._pendingRefresh = undefined;
      }
    });

  parameters._pendingRefresh = refreshPromise;
  return refreshPromise;
}

/**
 * Retrieves the game state at a specific turn, or the closest available state within the offset range
 * @param parameters - The strategy parameters containing game states
 * @param targetTurn - The desired turn number to retrieve
 * @param maxOffset - Maximum number of turns to search forward/backward for a state (default: 5)
 * @returns The game state at the target turn or closest available, or undefined if none found
 */
export function getGameState(
  parameters: StrategistParameters,
  targetTurn: number,
  maxOffset: number = 5
): GameState | undefined {
  // Check if we have the exact turn
  if (parameters.gameStates[targetTurn]) {
    return parameters.gameStates[targetTurn];
  }

  // If no offset allowed, return undefined
  if (maxOffset <= 0) {
    return undefined;
  }

  // Search for closest available state within offset range
  let closestTurn: number | undefined;
  let closestDistance = Infinity;

  const availableTurns = Object.keys(parameters.gameStates).map(Number);

  for (const turn of availableTurns) {
    const distance = Math.abs(turn - targetTurn);

    // Check if this turn is within our offset range and closer than previous best
    if (distance <= maxOffset && distance < closestDistance) {
      closestDistance = distance;
      closestTurn = turn;
    }
  }

  return closestTurn !== undefined ? parameters.gameStates[closestTurn] : undefined;
}

/**
 * Builds the shared game context system message: situation, civilization identity,
 * visible players, and current strategies. Used by LiveEnvoy and Analyst subclasses
 * so both have the same baseline information access.
 * @param parameters - The strategy parameters containing metadata and game states
 * @returns A single system message with the assembled game context
 */
export function buildGameContextMessages(parameters: StrategistParameters): ModelMessage[] {
  const state = getGameState(parameters, parameters.turn);
  if (!state) {
    throw new Error(`No game state available near turn ${parameters.turn}`);
  }
  const { YouAre, ...SituationData } = parameters.metadata || {};
  const { Options, ...Strategy } = state.options || {};

  return [{
    role: "system",
    content: `
# Situation
${jsonToMarkdown(SituationData)}

# Your Civilization
${jsonToMarkdown(YouAre)}

# Players
Players: summary reports about visible players in the world.

${jsonToMarkdown(state.players)}

# Strategies
Strategies: existing strategic decisions from your leader.

${jsonToMarkdown(Strategy)}`.trim()
  }];
}

/**
 * Gets the most recent game state before or at a specific turn
 * @param parameters - The strategy parameters containing game states
 * @param maxTurn - The maximum turn number to consider
 * @returns The most recent game state at or before maxTurn, or undefined if none found
 */
export function getRecentGameState(
  parameters: StrategistParameters,
): GameState | undefined {
  let mostRecentTurn: number | undefined;

  for (const turnStr of Object.keys(parameters.gameStates)) {
    const turn = Number(turnStr);
    // Update if this is the most recent turn we've seen
    if (mostRecentTurn === undefined || turn > mostRecentTurn) {
      mostRecentTurn = turn;
    }
  }

  return mostRecentTurn !== undefined ? parameters.gameStates[mostRecentTurn] : undefined;
}

/**
 * Build the turn-context sentence for a strategist decision prompt.
 */
export function getDecisionTurnContext(parameters: StrategistParameters): string {
  const lastDecisionClause = parameters.lastDecisionTurn !== undefined && parameters.lastDecisionTurn !== parameters.turn - 1
    ? ` (last decision made at turn ${parameters.lastDecisionTurn})`
    : "";

  return `You, ${parameters.metadata?.YouAre!.Leader} (leader of ${parameters.metadata?.YouAre!.Name}, Player ${parameters.playerID ?? 0}), are making strategic decisions after turn ${parameters.turn}${lastDecisionClause}.`;
}

/**
 * Merge cached turn-local event reports into the current decision window.
 * Each per-turn slice is the consolidated (optimized) turn-keyed `get-events`
 * report, so merging is a union of the turn keys. The result keeps that
 * consolidated shape so strategist prompts, briefers (`filterEventsByCategory`),
 * and pacing interruption checks all see the optimized format.
 */
export function mergeCachedEvents(
  parameters: StrategistParameters,
  fromTurn: number,
  toTurn: number
): EventsReport {
  const merged: Record<string, unknown> = {};

  const appendTurn = (key: string, items: unknown[]) => {
    const existing = merged[key];
    if (Array.isArray(existing)) existing.push(...items);
    else merged[key] = [...items];
  };

  for (let turn = fromTurn; turn <= toTurn; turn++) {
    const report = parameters.gameStates[turn]?.events as Record<string, unknown> | undefined;
    if (!report || typeof report !== "object") continue;

    // Carry over the get-events `_markdownConfig` (attached by callTool from the tool's
    // markdownConfig metadata) so jsonToMarkdown renders the merged report with the same
    // "Turn {key}" heading guidance as a direct tool call. It is identical across slices,
    // so the first one wins.
    if (merged._markdownConfig === undefined && report._markdownConfig !== undefined) {
      merged._markdownConfig = report._markdownConfig;
    }

    // Defensive: tolerate a legacy flat `{ events: [...] }` slice by keying it
    // under its loop turn so it still merges cleanly.
    if (Array.isArray(report.events)) {
      appendTurn(String(turn), report.events as unknown[]);
      continue;
    }

    for (const [key, value] of Object.entries(report)) {
      if (key === "_markdownConfig") continue;
      if (Array.isArray(value)) appendTurn(key, value);
    }
  }

  return merged as EventsReport;
}

/**
 * Return progressively narrower event windows for context-length retries.
 * Each retry drops the oldest remaining turn while keeping the current turn.
 */
export function getDecisionEventWindows(fromTurn: number, toTurn: number): Array<{ fromTurn: number; toTurn: number }> {
  if (fromTurn > toTurn) return [];

  const windows: Array<{ fromTurn: number; toTurn: number }> = [];
  for (let turn = fromTurn; turn <= toTurn; turn++) {
    windows.push({ fromTurn: turn, toTurn });
  }
  return windows;
}

/**
 * Run `attempt` against progressively narrower event windows (from `eventFromTurn`
 * through `parameters.turn`), dropping the oldest remaining turn on each retry. Before
 * each try, `state.events` is set to the merged window via {@link mergeCachedEvents}.
 *
 * Stops and returns `true` at the first window where `attempt` resolves `true` (success).
 * Returns `false` if every window was exhausted without success — including the case where
 * the window is empty (`eventFromTurn > parameters.turn`), in which case `attempt` is never
 * called and the caller should fall back to whatever it does when no decision is produced.
 *
 * Shared by the strategist decision loop (raw-event strategists) and the briefer
 * (`requestBriefing`), both of which need to shrink an oversized paced event window.
 */
export async function withEventWindowFallback(
  parameters: StrategistParameters,
  state: GameState,
  eventFromTurn: number,
  attempt: (window: { fromTurn: number; toTurn: number }) => Promise<boolean>
): Promise<boolean> {
  const windows = getDecisionEventWindows(eventFromTurn, parameters.turn);

  // `state` is normally the current turn's cached entry (gameStates[parameters.turn]), so
  // assigning `state.events = mergeCachedEvents(...)` clobbers that turn's cached per-turn slice.
  // Each window ends at parameters.turn, so without restoring the slice the next (narrower)
  // merge would re-read the already-merged events and grow instead of shrink. Snapshot the
  // current-turn slice and restore it before every merge so narrowing genuinely narrows.
  const currentEntry = parameters.gameStates[parameters.turn];
  const cachedCurrentEvents = currentEntry?.events;

  for (const window of windows) {
    if (currentEntry) currentEntry.events = cachedCurrentEvents;
    state.events = mergeCachedEvents(parameters, window.fromTurn, window.toTurn);
    if (await attempt(window)) return true;
  }

  return false;
}
