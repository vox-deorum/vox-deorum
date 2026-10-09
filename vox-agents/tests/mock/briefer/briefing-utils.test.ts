import { describe, expect, it } from "vitest";
import { getLastBriefingState, requestBriefing } from "../../../src/briefer/briefing-utils.js";
import { type GameState, type StrategistParameters } from "../../../src/strategist/strategy-parameters.js";

/** Build a minimal GameState for a turn with the given reports. */
function makeState(turn: number, reports: Record<string, string> = {}): GameState {
  return { turn, reports };
}

/** Build minimal StrategistParameters around a gameStates map and current turn. */
function makeParameters(
  turn: number,
  gameStates: Record<number, GameState>,
  lastDecisionTurn?: number
): StrategistParameters {
  return {
    playerID: 1,
    gameID: "test",
    turn,
    after: 0,
    before: 0,
    workingMemory: {},
    gameStates,
    mode: "Flavor",
    lastDecisionTurn,
  } as StrategistParameters;
}

describe("getLastBriefingState", () => {
  it("snaps to the closest prior decision point, skipping briefing-less turns", () => {
    // everyTurns=5: only turns 5 and 10 carry briefings; turns in between are skipped.
    const gameStates: Record<number, GameState> = {
      5: makeState(5, { briefing: "B5" }),
      6: makeState(6),
      7: makeState(7),
      8: makeState(8),
      9: makeState(9),
      10: makeState(10, { briefing: "B10" }),
      11: makeState(11),
      12: makeState(12),
    };
    const parameters = makeParameters(12, gameStates);

    // Target turn-5 = 7, which was skipped. Closest briefing-bearing past turn is 5 or 10;
    // distance(5->7)=2 == distance(10->7)=3? 2 < 3, so turn 5 wins.
    const result = getLastBriefingState(parameters, 7, ["briefing"]);
    expect(result?.turn).toBe(5);
  });

  it("returns undefined when no prior briefing exists yet", () => {
    const gameStates: Record<number, GameState> = {
      1: makeState(1),
      2: makeState(2),
      3: makeState(3),
    };
    const parameters = makeParameters(3, gameStates);
    expect(getLastBriefingState(parameters, -2, ["briefing"])).toBeUndefined();
  });

  it("never returns the current or future turns", () => {
    const gameStates: Record<number, GameState> = {
      8: makeState(8, { briefing: "B8" }),
      10: makeState(10, { briefing: "B10-current" }),
    };
    const parameters = makeParameters(10, gameStates);
    // Target is the current turn, but only strictly-past states are eligible.
    const result = getLastBriefingState(parameters, 10, ["briefing"]);
    expect(result?.turn).toBe(8);
  });

  it("matches any of the report keys (mode-specific or combined fallback)", () => {
    const gameStates: Record<number, GameState> = {
      4: makeState(4, { briefing: "combined-only" }),
      6: makeState(6, { "briefing-military": "mil" }),
    };
    const parameters = makeParameters(9, gameStates);

    // Closest to target 7 with a military OR combined briefing is turn 6.
    const result = getLastBriefingState(parameters, 7, ["briefing-military", "briefing"]);
    expect(result?.turn).toBe(6);

    // With only the combined key requested, the military-only turn is ignored.
    const combinedOnly = getLastBriefingState(parameters, 7, ["briefing"]);
    expect(combinedOnly?.turn).toBe(4);
  });
});

describe("requestBriefing event fallback", () => {
  it("should trim only the original failed snapshot without repeating its first attempt", async () => {
    const original = { "4": [{ Type: "TileRevealed" }, { Type: "DeclareWar" }] };
    const state = makeState(4, {}) as GameState & { events: Record<string, unknown> };
    state.events = original;
    const parameters = makeParameters(4, { 4: state });
    const seen: unknown[] = [];
    const context = {
      callAgent: async (_agent: string, _input: unknown, onError?: () => void) => {
        seen.push(structuredClone(state.mergedEvents ?? state.events));
        if (seen.length === 1) {
          onError?.();
          state.events = { "1": [{ Type: "DeclareWar" }], "4": [{ Type: "TileRevealed" }] };
        }
        return undefined;
      },
    } as never;

    await requestBriefing("combined", state, context, parameters);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(original);
    expect(seen[1]).toEqual({ "4": [{ Type: "DeclareWar" }] });
    expect(state.events).toEqual({ "1": [{ Type: "DeclareWar" }], "4": [{ Type: "TileRevealed" }] });
  });

  it("should not restore events already absent from the strategist's merged window", async () => {
    const state = makeState(4, {}) as GameState & { events: Record<string, unknown> };
    state.events = { "4": [{ Type: "TileRevealed" }, { Type: "CityTrained" }, { Type: "DeclareWar" }] };
    state.mergedEvents = { "4": [{ Type: "CityTrained" }, { Type: "DeclareWar" }] } as never;
    const parameters = makeParameters(4, { 4: state });
    const seen: unknown[] = [];
    const context = {
      callAgent: async (_agent: string, _input: unknown, onError?: () => void) => {
        seen.push(structuredClone(state.mergedEvents ?? state.events));
        onError?.();
        return undefined;
      },
    } as never;

    await requestBriefing("combined", state, context, parameters);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ "4": [{ Type: "CityTrained" }, { Type: "DeclareWar" }] });
    expect(seen[1]).toEqual({ "4": [{ Type: "DeclareWar" }] });
  });
});
