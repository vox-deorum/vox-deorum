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
  getRecentGameState,
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
      it("culls relative to the highest cached turn and keeps newer (future) snapshots", async () => {
        registerReportTools(ctx);
        // A lagging strategist refreshing turn 30 while a concurrent chat already cached turn 35.
        const future = makeGameState(35);
        const params = makeStrategistParameters({
          turn: 30,
          gameStates: {
            18: makeGameState(18), // older than highest(35) - cullLimit(10) = 25 → culled
            28: makeGameState(28), // within window
            29: makeGameState(29), // within window
            35: future,            // newer chat snapshot → must survive
          },
        });

        await refreshGameState(ctx.asContext(), params, 10);

        const turns = Object.keys(params.gameStates).map(Number).sort((a, b) => a - b);
        expect(turns).toEqual([28, 29, 30, 35]);
        expect(params.gameStates[18]).toBeUndefined();
        // The newer snapshot is not deleted just for being later than this run's turn.
        expect(params.gameStates[35]).toBe(future);
        expect(params.gameStates[30]).toBeDefined();
      });
    });

    describe("same-turn in-place update", () => {
      it("updates the existing GameState in place, keeps the larger serialized events, and preserves reports/pending briefings", async () => {
        registerReportTools(ctx);
        ctx.respondWith("get-players", { "1": { Civilization: "Rome (fresh)" } });
        // Fetched events are a strictly larger serialized slice than the cached one.
        ctx.respondWith("get-events", { "5": [{ Type: "A" }, { Type: "B" }, { Type: "C" }] });

        const pending = Promise.resolve("briefing-result");
        const cached = makeGameState(5, {
          events: { "5": [{ Type: "A" }] },
          reports: { briefing: "keep-me" },
          _pendingBriefings: { briefing: pending },
        } as unknown as Parameters<typeof makeGameState>[1]);
        const params = makeStrategistParameters({ turn: 5, gameStates: { 5: cached } });

        const result = await refreshGameState(ctx.asContext(), params);

        // Same object reference — briefing dedup closures stay valid.
        expect(result).toBe(cached);
        expect(params.gameStates[5]).toBe(cached);
        // Non-event fields take the newest fetch.
        expect(cached.players).toEqual({ "1": { Civilization: "Rome (fresh)" } });
        // Larger serialized events win.
        expect(cached.events).toEqual({ "5": [{ Type: "A" }, { Type: "B" }, { Type: "C" }] });
        // reports and pending briefings are untouched.
        expect(cached.reports).toEqual({ briefing: "keep-me" });
        expect(cached._pendingBriefings?.briefing).toBe(pending);
      });

      it("keeps the existing events when the fetched slice is serialized-smaller", async () => {
        registerReportTools(ctx);
        ctx.respondWith("get-events", { "5": [{ Type: "A" }] }); // smaller than cached
        const cached = makeGameState(5, {
          events: { "5": [{ Type: "A" }, { Type: "B" }, { Type: "C" }] },
        } as unknown as Parameters<typeof makeGameState>[1]);
        const params = makeStrategistParameters({ turn: 5, gameStates: { 5: cached } });

        await refreshGameState(ctx.asContext(), params);

        // A smaller late arrival never clobbers the fuller report.
        expect(cached.events).toEqual({ "5": [{ Type: "A" }, { Type: "B" }, { Type: "C" }] });
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

    it("does NOT deduplicate concurrent misses, but converges on one cached entry", async () => {
      registerReportTools(ctx);
      const params = makeStrategistParameters({ turn: 5 });

      const [s1, s2] = await Promise.all([
        ensureGameState(ctx.asContext(), params),
        ensureGameState(ctx.asContext(), params),
      ]);

      // Each concurrent miss issued its own independent refresh (no dedup).
      expect(ctx.calls("get-players")).toHaveLength(2);
      // The second refresh updated the first's entry in place, so both converge on one object.
      expect(s1).toBe(s2);
      expect(params.gameStates[5]).toBe(s1);
    });
  });

  describe("getRecentGameState", () => {
    it("returns the most recent state at or before parameters.turn, ignoring newer snapshots", () => {
      const s3 = makeGameState(3), s5 = makeGameState(5), s8 = makeGameState(8);
      const params = makeStrategistParameters({ turn: 5, gameStates: { 3: s3, 5: s5, 8: s8 } });

      // turn 8 exists but is a newer (e.g. chat) snapshot the lagging caller must not read.
      expect(getRecentGameState(params)).toBe(s5);
    });

    it("falls back to the nearest earlier state when the exact turn is missing", () => {
      const s3 = makeGameState(3), s8 = makeGameState(8);
      const params = makeStrategistParameters({ turn: 5, gameStates: { 3: s3, 8: s8 } });

      expect(getRecentGameState(params)).toBe(s3);
    });

    it("honors an explicit maxTurn bound over parameters.turn", () => {
      const s3 = makeGameState(3), s8 = makeGameState(8);
      const params = makeStrategistParameters({ turn: 5, gameStates: { 3: s3, 8: s8 } });

      expect(getRecentGameState(params, Number.MAX_SAFE_INTEGER)).toBe(s8);
    });

    it("returns undefined when no state is at or before the bound", () => {
      const params = makeStrategistParameters({ turn: 2, gameStates: { 8: makeGameState(8) } });

      expect(getRecentGameState(params)).toBeUndefined();
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
