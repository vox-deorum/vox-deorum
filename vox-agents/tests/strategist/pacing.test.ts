import { describe, expect, it } from "vitest";
import {
  isScheduledDecision,
  normalizePacing,
  shouldInterruptDecision,
} from "../../src/strategist/pacing.js";
import { pacingInterruptionRegistry } from "../../src/strategist/pacing/registry.js";
import { mergeCachedEvents, type StrategistParameters } from "../../src/strategist/strategy-parameters.js";

describe("strategist pacing", () => {
  it("normalizes missing config to every turn with no interruption", () => {
    expect(normalizePacing()).toEqual({ everyTurns: 1, interruption: "none" });
  });

  it("registers built-in interruption strategies", () => {
    expect(pacingInterruptionRegistry.getNames()).toContain("none");
    expect(pacingInterruptionRegistry.getNames()).toContain("warOrPeace");
  });

  it("falls back to none for unknown interruption config", () => {
    expect(normalizePacing({ interruption: "future-but-not-installed" })).toEqual({
      everyTurns: 1,
      interruption: "none"
    });
  });

  it("runs first turn and then on cadence", () => {
    const pacing = normalizePacing({ everyTurns: 5 });

    expect(isScheduledDecision(12, undefined, pacing)).toBe(true);
    expect(isScheduledDecision(14, 12, pacing)).toBe(false);
    expect(isScheduledDecision(17, 12, pacing)).toBe(true);
  });

  it("does not interrupt when interruption is none", () => {
    const pacing = normalizePacing({ interruption: "none" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true }
      } as any,
      events: {
        events: [{ Type: "DeclareWar", OriginatingPlayerID: 2, TargetTeamID: 1 }]
      } as any
    }, 1, pacing)).toBe(false);
  });

  it("interrupts for war or peace involving the player's team", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "warOrPeace" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        events: [{ Type: "MakePeace", OriginatingPlayerID: 2, TargetTeamID: 7 }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("ignores unrelated war or peace events", () => {
    const pacing = normalizePacing({ interruption: "warOrPeace" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        events: [{ Type: "DeclareWar", OriginatingPlayerID: 2, TargetTeamID: 3 }]
      } as any
    }, 1, pacing)).toBe(false);
  });

  it("delegates interruption checks through registered strategies", () => {
    const name = "test-always-interrupt";
    pacingInterruptionRegistry.register({
      name,
      label: "Test always interrupt",
      shouldInterrupt: () => true
    });

    try {
      const pacing = normalizePacing({ interruption: name });
      expect(shouldInterruptDecision({
        turn: 4,
        reports: {},
        players: {} as any,
        events: {} as any
      }, 1, pacing)).toBe(true);
    } finally {
      pacingInterruptionRegistry.unregister(name);
    }
  });
});

describe("mergeCachedEvents", () => {
  it("merges skipped-turn event reports into a decision window", () => {
    const parameters = {
      gameStates: {
        2: {
          turn: 2,
          reports: {},
          events: { events: [{ ID: 20, Turn: 2, Type: "BuildFinished" }] }
        },
        3: {
          turn: 3,
          reports: {},
          events: { events: [{ ID: 30, Turn: 3, Type: "DeclareWar" }] }
        }
      }
    } as unknown as StrategistParameters;

    expect(mergeCachedEvents(parameters, 2, 3)).toEqual({
      events: [
        { ID: 20, Turn: 2, Type: "BuildFinished" },
        { ID: 30, Turn: 3, Type: "DeclareWar" }
      ]
    });
  });
});
