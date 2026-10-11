import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLastBriefingState, requestBriefing } from "../../../src/briefer/briefing-utils.js";
import { SeatRecords } from "../../../src/knowledge/records.js";
import { type GameState, type StrategistParameters } from "../../../src/strategist/strategy-parameters.js";
import { WorkspaceStore } from "../../../src/utils/workspace/workspace-store.js";

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

describe("requestBriefing publication", () => {
  let dir: string;
  let store: WorkspaceStore;
  let records: SeatRecords;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vox-briefing-"));
    store = WorkspaceStore.open(path.join(dir, "seat.db"));
    records = new SeatRecords(store);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A stored briefing archive as text. */
  function archived(turn: number, kind: string): string | undefined {
    const bytes = store.readFile(`records/turn-${turn}/briefings/${kind}.md`);
    return bytes === undefined ? undefined : Buffer.from(bytes).toString("utf8");
  }

  /** A fake context whose briefer resolves when released, with an optional records writer. */
  function fakeContext(options: { records?: () => SeatRecords | undefined; signal?: AbortSignal; outputs?: string[] } = {}) {
    const calls: string[] = [];
    const outputs = options.outputs ?? ["briefing text"];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const context = {
      callAgent: async (agent: string) => {
        calls.push(agent);
        await gate;
        return outputs[Math.min(calls.length, outputs.length) - 1];
      },
      records: options.records ?? (() => records),
      currentSignal: () => options.signal ?? new AbortController().signal,
    };
    return { context: context as never, calls, release };
  }

  it("should make a concurrent caller wait until the briefing is archived and published", async () => {
    const state = makeState(4);
    const parameters = makeParameters(4, { 4: state });
    const { context, calls, release } = fakeContext();

    const first = requestBriefing("Military", state, context, parameters);
    const second = requestBriefing("Military", state, context, parameters);
    let secondDone = false;
    void second.then(() => { secondDone = true; });
    await Promise.resolve();
    expect(secondDone).toBe(false);
    expect(state.reports["briefing-military"]).toBeUndefined();

    release();
    expect(await second).toBe("briefing text");
    expect(archived(4, "military")).toBe("briefing text\n");
    expect(state.reports["briefing-military"]).toBe("briefing text");
    expect(await first).toBe("briefing text");
    expect(calls).toEqual(["specialized-briefer"]);
  });

  it("should publish to the requested state and archive under that state's turn", async () => {
    const requested = makeState(4);
    const current = makeState(9);
    const parameters = makeParameters(9, { 4: requested, 9: current });
    const { context, release } = fakeContext();
    release();

    const text = await requestBriefing("combined", requested, context, parameters);
    expect(requested.reports["briefing"]).toBe(text);
    expect(current.reports).toEqual({});
    expect(archived(4, "combined")).toBe(`${text}\n`);
    expect(archived(9, "combined")).toBeUndefined();
  });

  it("should publish nothing when archiving fails, and regenerate on the next request", async () => {
    const state = makeState(4);
    const parameters = makeParameters(4, { 4: state });
    let failures = 1;
    const failing = {
      recordBriefing: (...args: Parameters<SeatRecords["recordBriefing"]>) => {
        if (failures-- > 0) throw new Error("disk full");
        return records.recordBriefing(...args);
      },
    } as SeatRecords;
    const { context, calls, release } = fakeContext({ records: () => failing, outputs: ["first", "second"] });
    release();

    const waiter = requestBriefing("Economy", state, context, parameters);
    const concurrent = requestBriefing("Economy", state, context, parameters);
    await expect(waiter).rejects.toThrow("disk full");
    await expect(concurrent).rejects.toThrow("disk full");
    expect(state.reports["briefing-economy"]).toBeUndefined();
    expect(state._pendingBriefings?.["briefing-economy"]).toBeUndefined();
    expect(archived(4, "economy")).toBeUndefined();

    expect(await requestBriefing("Economy", state, context, parameters)).toBe("second");
    expect(calls).toHaveLength(2);
    expect(state.reports["briefing-economy"]).toBe("second");
    expect(archived(4, "economy")).toBe("second\n");
  });

  it("should publish nothing when the requesting run was cancelled before archiving", async () => {
    const state = makeState(4);
    const parameters = makeParameters(4, { 4: state });
    const controller = new AbortController();
    const { context, release } = fakeContext({ signal: controller.signal });
    const pending = requestBriefing("Diplomacy", state, context, parameters);
    controller.abort();
    release();

    await expect(pending).rejects.toBeDefined();
    expect(state.reports["briefing-diplomacy"]).toBeUndefined();
    expect(archived(4, "diplomacy")).toBeUndefined();
  });

  it("should publish without archiving when files are off", async () => {
    const state = makeState(4);
    const parameters = makeParameters(4, { 4: state });
    const { context, release } = fakeContext({ records: () => undefined });
    release();

    expect(await requestBriefing("combined", state, context, parameters)).toBe("briefing text");
    expect(state.reports["briefing"]).toBe("briefing text");
    expect(store.history().map((commit) => commit.kind)).toEqual(["init"]);
  });
});
