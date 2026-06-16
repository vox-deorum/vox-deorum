/**
 * Mock-tier unit tests for `src/strategist/strategy-parameters.ts`.
 *
 * Covers the game-state lifecycle helpers: `refreshGameState` (tool fan-out,
 * error handling, culling), `ensureGameState` (cache hit + concurrent dedupe),
 * `getGameState` (exact/closest/out-of-range lookup), and `buildGameContextMessages`
 * (metadata projection + dynamic sections). `mergeCachedEvents`/decision windows are
 * intentionally not retested here — see pacing.test.ts.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  refreshGameState,
  ensureGameState,
  getGameState,
  buildGameContextMessages,
} from "../../../src/strategist/strategy-parameters.js";
import {
  createFakeVoxContext,
  makeStrategistParameters,
  makeGameState,
  type FakeVoxContext,
} from "../../helpers/fake-vox-context.js";

/** Register all six per-turn report tools with minimal non-error results. */
function registerReportTools(ctx: FakeVoxContext): void {
  ctx.respondWith("get-players", { "1": { Civilization: "Rome" } });
  ctx.respondWith("get-events", {});
  ctx.respondWith("get-cities", {});
  ctx.respondWith("get-options", {});
  ctx.respondWith("get-victory-progress", {});
  ctx.respondWith("get-military-report", {});
}

describe("strategy-parameters", () => {
  let ctx: FakeVoxContext;

  beforeEach(() => {
    ctx = createFakeVoxContext();
  });

  describe("refreshGameState", () => {
    it("fans out to all per-turn report tools and stores the state by turn", async () => {
      registerReportTools(ctx);
      const params = makeStrategistParameters({ turn: 5 });

      const state = await refreshGameState(ctx.asContext(), params);

      // All six report tools were invoked.
      expect(ctx.calls("get-players")).toHaveLength(1);
      expect(ctx.calls("get-events")).toHaveLength(1);
      expect(ctx.calls("get-cities")).toHaveLength(1);
      expect(ctx.calls("get-options")).toHaveLength(1);
      expect(ctx.calls("get-victory-progress")).toHaveLength(1);
      expect(ctx.calls("get-military-report")).toHaveLength(1);

      // The returned state is cached under the current turn.
      expect(params.gameStates[5]).toBe(state);
      expect(state.turn).toBe(5);
      expect(state.players).toEqual({ "1": { Civilization: "Rome" } });
    });

    it("passes through cursor and mode args to the relevant tools", async () => {
      registerReportTools(ctx);
      const params = makeStrategistParameters({ turn: 5, after: 12, before: 34, mode: "Flavor" });

      await refreshGameState(ctx.asContext(), params);

      expect(ctx.calls("get-events")[0].args).toEqual({ After: 12, Before: 34 });
      expect(ctx.calls("get-options")[0].args).toEqual({ Mode: "Flavor" });
    });

    it("does NOT call get-game-settings when metadata is already present", async () => {
      registerReportTools(ctx);
      ctx.respondWith("get-game-settings", { YouAre: { Name: "Egypt", Leader: "Cleopatra" } });
      const params = makeStrategistParameters({ turn: 5 }); // builder presets metadata

      await refreshGameState(ctx.asContext(), params);

      expect(ctx.calls("get-game-settings")).toHaveLength(0);
      // Preset metadata is untouched.
      expect(params.metadata?.YouAre).toEqual({ Name: "Rome", Leader: "Caesar" });
    });

    it("fetches game metadata via get-game-settings when unset", async () => {
      registerReportTools(ctx);
      ctx.respondWith("get-game-settings", { YouAre: { Name: "Egypt", Leader: "Cleopatra" } });
      const params = makeStrategistParameters({ turn: 5, metadata: undefined });

      await refreshGameState(ctx.asContext(), params);

      expect(ctx.calls("get-game-settings")).toHaveLength(1);
      expect(ctx.calls("get-game-settings")[0].args).toEqual({ PlayerID: 1 });
      expect(params.metadata?.YouAre).toEqual({ Name: "Egypt", Leader: "Cleopatra" });
    });

    describe("error handling", () => {
      it("throws when a tool resolves undefined (failWith)", async () => {
        registerReportTools(ctx);
        ctx.failWith("get-cities", "boom");
        const params = makeStrategistParameters({ turn: 5 });

        await expect(refreshGameState(ctx.asContext(), params)).rejects.toThrow(
          /Failed to fetch cities/
        );
        // State was not cached on failure.
        expect(params.gameStates[5]).toBeUndefined();
      });

      it("throws when a tool returns an error envelope (isError)", async () => {
        registerReportTools(ctx);
        ctx.respondWith("get-players", { isError: true, error: "no players" });
        const params = makeStrategistParameters({ turn: 5 });

        await expect(refreshGameState(ctx.asContext(), params)).rejects.toThrow(
          /Failed to fetch players: no players/
        );
      });
    });

    describe("culling", () => {
      it("prunes states older than cullLimit and any future turns, keeping in-window turns", async () => {
        registerReportTools(ctx);
        const params = makeStrategistParameters({
          turn: 30,
          gameStates: {
            10: makeGameState(10), // too old (30 - cullLimit 5 = 25)
            28: makeGameState(28), // in window
            29: makeGameState(29), // in window
            35: makeGameState(35), // future
          },
        });

        await refreshGameState(ctx.asContext(), params, 5);

        const turns = Object.keys(params.gameStates).map(Number).sort((a, b) => a - b);
        expect(turns).toEqual([28, 29, 30]);
        expect(params.gameStates[10]).toBeUndefined();
        expect(params.gameStates[35]).toBeUndefined();
        expect(params.gameStates[30]).toBeDefined();
      });
    });
  });

  describe("ensureGameState", () => {
    it("returns the cached state without making any tool calls", async () => {
      registerReportTools(ctx);
      const cached = makeGameState(5, { reports: { brief: "x" } });
      const params = makeStrategistParameters({ turn: 5, gameStates: { 5: cached } });

      const result = await ensureGameState(ctx.asContext(), params);

      expect(result).toBe(cached);
      expect(ctx.calls()).toHaveLength(0);
    });

    it("dedupes concurrent in-flight refreshes into a single fetch", async () => {
      // Controlled handler so both calls observe the same in-flight promise.
      let releasePlayers!: (value: unknown) => void;
      const playersPending = new Promise((resolve) => {
        releasePlayers = resolve;
      });
      ctx.onTool("get-players", () => playersPending);
      ctx.respondWith("get-events", {});
      ctx.respondWith("get-cities", {});
      ctx.respondWith("get-options", {});
      ctx.respondWith("get-victory-progress", {});
      ctx.respondWith("get-military-report", {});
      const params = makeStrategistParameters({ turn: 5 });

      const p1 = ensureGameState(ctx.asContext(), params);
      const p2 = ensureGameState(ctx.asContext(), params);

      releasePlayers({ "1": { Civilization: "Rome" } });
      const [s1, s2] = await Promise.all([p1, p2]);

      // Both resolve to the same single refresh result.
      expect(s1).toBe(s2);
      expect(ctx.calls("get-players")).toHaveLength(1);
      // In-flight marker cleared after settle.
      expect(params._pendingRefresh).toBeUndefined();
    });
  });

  describe("getGameState", () => {
    it("returns the exact-turn state when present", () => {
      const state = makeGameState(5);
      const params = makeStrategistParameters({ turn: 5, gameStates: { 5: state } });

      expect(getGameState(params, 5)).toBe(state);
    });

    it("returns the closest available state within maxOffset", () => {
      const near = makeGameState(7);
      const far = makeGameState(2);
      const params = makeStrategistParameters({ gameStates: { 7: near, 2: far } });

      // Target 8: turn 7 is distance 1, turn 2 is distance 6 — both default offset 5 picks 7.
      expect(getGameState(params, 8)).toBe(near);
    });

    it("returns undefined when no state is within maxOffset", () => {
      const params = makeStrategistParameters({ gameStates: { 1: makeGameState(1) } });

      expect(getGameState(params, 20, 5)).toBeUndefined();
    });

    it("returns undefined for a missing exact turn when maxOffset <= 0", () => {
      const params = makeStrategistParameters({ gameStates: { 4: makeGameState(4) } });

      expect(getGameState(params, 5, 0)).toBeUndefined();
    });
  });

  describe("buildGameContextMessages", () => {
    it("throws when no game state is available near the turn", () => {
      const params = makeStrategistParameters({ turn: 5, gameStates: {} });

      expect(() => buildGameContextMessages(params)).toThrow(/No game state available near turn 5/);
    });

    it("renders section headers and projects metadata and dynamic state", () => {
      const params = makeStrategistParameters({
        turn: 5,
        metadata: {
          YouAre: { Name: "Rome", Leader: "Caesar" },
          Difficulty: "Prince",
        } as StrategistParametersMetadata,
        gameStates: {
          5: makeGameState(5, {
            players: { "2": { Civilization: "Egypt", Leader: "Cleopatra" } },
            options: {
              Options: ["expand"],
              CurrentStrategy: "Conquest",
            },
          } as unknown as Parameters<typeof makeGameState>[1]),
        },
      });

      const [message] = buildGameContextMessages(params);
      const content = message.content as string;

      // Key section headers present.
      expect(content).toContain("# Situation");
      expect(content).toContain("# Your Civilization");
      expect(content).toContain("# Players");
      expect(content).toContain("# Strategies");

      // YouAre split into "Your Civilization".
      expect(content).toContain("Rome");
      expect(content).toContain("Caesar");
      // Rest of metadata in "Situation".
      expect(content).toContain("Prince");
      // Dynamic player + strategy values rendered.
      expect(content).toContain("Egypt");
      expect(content).toContain("Cleopatra");
      expect(content).toContain("Conquest");

      // "Your Civilization" precedes "Players" in the assembled message.
      expect(content.indexOf("# Your Civilization")).toBeLessThan(content.indexOf("# Players"));
    });
  });
});

/** Local alias so metadata-shaped overrides cast cleanly without importing source types. */
type StrategistParametersMetadata = NonNullable<
  ReturnType<typeof makeStrategistParameters>["metadata"]
>;
