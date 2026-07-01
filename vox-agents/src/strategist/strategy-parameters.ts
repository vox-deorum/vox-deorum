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
  /**
   * The immutable per-turn event slice for this turn. Pacing and the event-window fallback must
   * never mutate it in place; a same-turn refresh may only replace it with a slice covering a
   * *wider* event range (or, at equal coverage, a larger serialized slice) for the same turn (see
   * {@link refreshGameState}). It is never repurposed as a multi-turn window — that is what
   * {@link GameState.mergedEvents} is for, except that a strategist fetch reaching across a dropped
   * turn legitimately folds that turn's events in here (nothing else fetches them). Slice readers
   * (pacing's importance check, {@link mergeCachedEvents}) read this field directly.
   */
  events?: EventsReport;
  /**
   * The exclusive lower event-ID bound the cached {@link GameState.events} slice was fetched with
   * (the `after` passed to `get-events`). A smaller value means a *wider* window. Recorded so
   * {@link ensureGameState} can detect when a cached entry does NOT cover a wider requested range:
   * the strategist fetches `after = its event cursor` (which can reach back across a dropped turn),
   * while a live chat refreshes only the current turn (`after = turn * 1_000_000`). Without this,
   * a chat-populated narrow entry would let the strategist short-circuit its wider fetch and lose
   * the dropped turn's events. `undefined` marks a hand-built/legacy entry whose coverage is
   * treated as sufficient, so existing callers are unaffected.
   */
  eventsAfter?: number;
  /**
   * The derived multi-turn pacing window for this state's strategist decision, assembled by
   * {@link withEventWindowFallback}/{@link mergeCachedEvents}. Kept separate from the immutable
   * per-turn `events` slice so the selected decision window stays available to the strategist and
   * its briefers without clobbering the slice. Window readers (strategist prompts, briefers) read
   * `mergedEvents ?? events`.
   */
  mergedEvents?: EventsReport;
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

  // Store the freshly-fetched snapshot. When an entry for this turn already exists (a concurrent
  // same-turn refresh), update its fields IN PLACE rather than replacing the object reference.
  // Briefing dedup (briefing-utils) and the strategist's selected pacing window close over the
  // specific GameState instance, so swapping the map entry for a fresh object would orphan any
  // in-flight briefing promise (its `finally` would no longer match the live entry) and drop the
  // derived `mergedEvents` decision window. The non-event fields take the newest fetch. For
  // `events` the WIDER-covering slice wins: a smaller `after` covers a wider range, and the
  // strategist's range (reaching back across a dropped turn) is a superset of a chat's narrow
  // current-turn range — it must never be clobbered by a later narrow same-turn refresh. At equal
  // coverage (same `after`, or legacy entries with unknown coverage) the larger serialized report
  // wins, because concurrent same-turn refreshes settle in any order and a fuller report must
  // survive a smaller late arrival. `reports`, `_pendingBriefings`, and `mergedEvents` are left
  // untouched.
  const existing = parameters.gameStates[parameters.turn];
  let currentState: GameState;
  if (existing) {
    existing.players = players;
    existing.cities = cities;
    existing.options = options;
    existing.military = military;
    existing.victory = victory;
    const prevAfter = existing.eventsAfter;
    let takeFetched: boolean;
    if (existing.events === undefined) {
      takeFetched = true;
    } else if (prevAfter === undefined || parameters.after === prevAfter) {
      // Unknown coverage or identical lower bound: keep the larger serialized slice.
      takeFetched = JSON.stringify(events).length > JSON.stringify(existing.events).length;
    } else {
      // Different coverage: the wider window (smaller `after`) wins regardless of serialized size.
      takeFetched = parameters.after < prevAfter;
    }
    if (takeFetched) {
      existing.events = events;
      existing.eventsAfter = parameters.after;
    }
    currentState = existing;
  } else {
    currentState = {
      players,
      events,
      cities,
      options,
      military,
      victory,
      reports: {},
      turn: parameters.turn,
      eventsAfter: parameters.after
    };
    parameters.gameStates[parameters.turn] = currentState;
  }

  // Cull old game states relative to the HIGHEST cached turn, not this run's turn, so a lagging
  // strategist refresh never deletes a newer chat snapshot — and never deletes an entry just for
  // being "later" than this run's turn. Keep only turns within cullLimit of the newest cached turn.
  const highestTurn = Math.max(...Object.keys(parameters.gameStates).map(Number));
  const oldestAllowedTurn = highestTurn - cullLimit;

  for (const turnStr of Object.keys(parameters.gameStates)) {
    const turn = Number(turnStr);
    if (turn < oldestAllowedTurn) {
      delete parameters.gameStates[turn];
    }
  }

  return currentState;
}

/**
 * Returns the game state for the current turn, refreshing it when not cached.
 *
 * There is intentionally NO cross-run deduplication: concurrent cache misses issue independent
 * MCP refreshes. Refresh cost is acceptable, and runs for different turns must never receive one
 * another's promise. A same-turn concurrent refresh updates the existing cached entry in place
 * (see {@link refreshGameState}), so both callers still converge on the same `GameState` object.
 *
 * The cache hit is COVERAGE-AWARE: a cached entry satisfies the request only when its events slice
 * covers the requested event range. A live chat refreshes the current turn narrowly
 * (`after = turn * 1_000_000`) while a lagging strategist refreshes a wider range
 * (`after = its event cursor`, which can reach back across a turn dropped while it was busy).
 * Keying the hit on turn alone would let a chat-populated narrow entry short-circuit the
 * strategist's wider fetch — the strategist would skip the fetch, advance its cursor past the
 * dropped turn, and those events would be lost forever. A smaller `after` is a wider window, so
 * the cache covers the request iff `eventsAfter <= parameters.after`. `eventsAfter === undefined`
 * marks a hand-built/legacy entry whose coverage is treated as sufficient (existing callers
 * unaffected). When coverage is insufficient we refresh, and the in-place merge keeps the wider
 * slice (see {@link refreshGameState}).
 *
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
  // Return the cached state only when it covers the requested event range (see above).
  const cached = parameters.gameStates[parameters.turn];
  if (cached && (cached.eventsAfter === undefined || cached.eventsAfter <= parameters.after)) {
    return cached;
  }

  return refreshGameState(context, parameters, cullLimit);
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
${jsonToMarkdown(YouAre)}`.trim(),
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } }
      }
    }, {
      role: "user",
      content: `
# Victory Progress
Victory Progress: current progress towards each type of victory.

${jsonToMarkdown(state.victory)}

# Players
Players: summary reports about visible players in the world.

${jsonToMarkdown(state.players)}

# Strategies
Strategies: existing strategic decisions from your leader.

${jsonToMarkdown(Strategy)}`.trim()
  }];
}

/**
 * Gets the most recent cached game state at or before a turn bound.
 *
 * The bound defaults to the active run's `parameters.turn` so a lagging strategist (or a briefer/
 * librarian helper running in its root) never reads a newer concurrent chat snapshot: "most
 * recent" must mean "most recent up to my turn", not "the newest entry on the seat". Callers that
 * deliberately want the newest snapshot regardless of turn (e.g. out-of-run display helpers) pass
 * an explicit larger `maxTurn`.
 *
 * @param parameters - The strategy parameters containing game states
 * @param maxTurn - Upper turn bound, inclusive (defaults to `parameters.turn`)
 * @returns The most recent game state at or before `maxTurn`, or undefined if none found
 */
export function getRecentGameState(
  parameters: StrategistParameters,
  maxTurn: number = parameters.turn,
): GameState | undefined {
  let bestTurn: number | undefined;

  for (const turnStr of Object.keys(parameters.gameStates)) {
    const turn = Number(turnStr);
    if (turn > maxTurn) continue;
    if (bestTurn === undefined || turn > bestTurn) {
      bestTurn = turn;
    }
  }

  return bestTurn !== undefined ? parameters.gameStates[bestTurn] : undefined;
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
 * each try, the candidate window is assigned to the DERIVED `state.mergedEvents` field.
 *
 * It never mutates the immutable per-turn `state.events` slice. {@link mergeCachedEvents} builds
 * each window from the per-turn slices in `gameStates`, so writing `state.mergedEvents` here does
 * not feed back into the next (narrower) merge — the old snapshot/restore workaround is gone.
 * Strategists and briefers read `state.mergedEvents ?? state.events`, so the selected window stays
 * available to nested/cached briefer consumption; on total failure the final attempted window
 * remains on the state for diagnostics without disturbing the slice.
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

  for (const window of windows) {
    state.mergedEvents = mergeCachedEvents(parameters, window.fromTurn, window.toTurn);
    if (await attempt(window)) return true;
  }

  return false;
}
