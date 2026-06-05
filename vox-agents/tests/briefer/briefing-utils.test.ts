import { describe, expect, it } from "vitest";
import { getLastBriefingState } from "../../src/briefer/briefing-utils.js";
import {
  withEventWindowFallback,
  type GameState,
  type StrategistParameters,
} from "../../src/strategist/strategy-parameters.js";

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

describe("withEventWindowFallback", () => {
  function eventsParameters(turn: number, fromTurn: number): {
    parameters: StrategistParameters;
    state: GameState;
  } {
    const gameStates: Record<number, GameState> = {};
    for (let t = fromTurn; t <= turn; t++) {
      gameStates[t] = { turn: t, reports: {}, events: { events: [{ Type: `E${t}` }] } as any };
    }
    const state = gameStates[turn];
    return { parameters: makeParameters(turn, gameStates), state };
  }

  it("narrows from the widest window until an attempt succeeds", async () => {
    const { parameters, state } = eventsParameters(12, 10); // windows: 10-12, 11-12, 12-12
    const seen: Array<{ fromTurn: number; toTurn: number }> = [];

    const ok = await withEventWindowFallback(parameters, state, 10, async (window) => {
      seen.push(window);
      // Succeed only once the window has narrowed to a single turn.
      return window.fromTurn === window.toTurn;
    });

    expect(ok).toBe(true);
    expect(seen).toEqual([
      { fromTurn: 10, toTurn: 12 },
      { fromTurn: 11, toTurn: 12 },
      { fromTurn: 12, toTurn: 12 },
    ]);
    // state.events reflects the final (successful) single-turn window.
    expect((state.events as any).events.map((e: any) => e.Type)).toEqual(["E12"]);
  });

  it("returns false when every window fails, after trying them all", async () => {
    const { parameters, state } = eventsParameters(11, 10); // windows: 10-11, 11-11
    let attempts = 0;

    const ok = await withEventWindowFallback(parameters, state, 10, async () => {
      attempts++;
      return false;
    });

    expect(ok).toBe(false);
    expect(attempts).toBe(2);
  });

  it("returns false without calling attempt when the window is empty", async () => {
    const { parameters, state } = eventsParameters(10, 10);
    let attempts = 0;

    // eventFromTurn ahead of the current turn => no windows.
    const ok = await withEventWindowFallback(parameters, state, 11, async () => {
      attempts++;
      return true;
    });

    expect(ok).toBe(false);
    expect(attempts).toBe(0);
  });
});
