import { describe, expect, it } from "vitest";
import {
  isScheduledDecision,
  normalizePacing,
  shouldInterruptDecision,
} from "../../src/strategist/pacing.js";
import { pacingInterruptionRegistry } from "../../src/strategist/pacing/registry.js";
import { getDecisionEventWindows, getDecisionTurnContext, mergeCachedEvents, type StrategistParameters } from "../../src/strategist/strategy-parameters.js";

describe("strategist pacing", () => {
  it("normalizes missing config to every turn with no interruption", () => {
    expect(normalizePacing()).toEqual({ everyTurns: 1, interruption: "none" });
  });

  it("registers built-in interruption strategies", () => {
    expect(pacingInterruptionRegistry.getNames()).toContain("none");
    expect(pacingInterruptionRegistry.getNames()).toContain("importantEvents");
  });

  it("throws for an unknown interruption config", () => {
    expect(() => normalizePacing({ interruption: "future-but-not-installed" }))
      .toThrow(/Unknown pacing interruption/);
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
        "4": [{ Type: "DeclareWar", OriginatingPlayer: 2, TargetTeam: 1 }]
      } as any
    }, 1, pacing)).toBe(false);
  });

  it("interrupts for war or peace involving the player's team", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        // Consolidated shape: OriginatingPlayer is a "<id>: <Civ>" string, TargetTeam
        // is an object carrying an embedded numeric .ID.
        "4": [{ Type: "MakePeace", OriginatingPlayer: "2: Babylon", TargetTeam: { Player_3: "Oda Nobunaga", ID: 7 } }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("interrupts when the player itself declares war", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        // Player 1 (team 7) is the originator; target team is someone else.
        "4": [{ Type: "DeclareWar", OriginatingPlayer: "1: Rome", TargetTeam: { ID: 3 } }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("interrupts when a teammate declares war on the player's behalf", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 },
        "5": { Civilization: "Greece", Leader: "Alexander", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        // Player 5 shares team 7 with player 1, so this counts for player 1.
        "4": [{ Type: "DeclareWar", OriginatingPlayer: "5: Greece", TargetTeam: { ID: 3 } }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("interrupts when the player's team completes research", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        // Consolidated shape: Team is an object carrying an embedded numeric .ID,
        // Tech is a localized string.
        "4": [{ Type: "TeamTechResearched", Team: { Player_1: "Caesar", ID: 7 }, Tech: "Writing", ChangeAmount: 1 }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("interrupts when a team with no resolved members (numeric Team) completes research", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        // When the team object is empty, cleanEventData leaves Team as a bare number.
        "4": [{ Type: "TeamTechResearched", Team: 7, Tech: "Writing", ChangeAmount: 1 }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("interrupts when the player's team gains a technology", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        "4": [{ Type: "TeamSetHasTech", Team: { Player_1: "Caesar", ID: 7 }, Tech: "Writing", HasTech: true }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("ignores technology loss events", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        // A tech loss has HasTech=false, which cleanEventData drops entirely.
        "4": [{ Type: "TeamSetHasTech", Team: { Player_1: "Caesar", ID: 7 }, Tech: "Writing" }]
      } as any
    }, 1, pacing)).toBe(false);
  });

  it("interrupts when the player adopts culture", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        // Consolidated shape: Player is a "<id>: <Civ>" string, Policy is a localized name.
        "4": [{ Type: "PlayerAdoptPolicy", Player: "1: Rome", Policy: "Organization" }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("interrupts when an important relayed message targets the player", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        "4": [{ Type: "RelayedMessage", ToPlayerID: 1, FromPlayerID: 2, Importance: 7 }]
      } as any
    }, 1, pacing)).toBe(true);
  });

  it("ignores relayed messages below the important-event threshold", () => {
    const pacing = normalizePacing({ everyTurns: 10, interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        "4": [{ Type: "RelayedMessage", ToPlayerID: 1, FromPlayerID: 2, Importance: 6 }]
      } as any
    }, 1, pacing)).toBe(false);
  });

  it("ignores unrelated important events", () => {
    const pacing = normalizePacing({ interruption: "importantEvents" });

    expect(shouldInterruptDecision({
      turn: 4,
      reports: {},
      players: {
        "1": { Civilization: "Rome", Leader: "Caesar", IsMajor: true, TeamID: 7 }
      } as any,
      events: {
        "4": [
          { Type: "DeclareWar", OriginatingPlayer: "2: Babylon", TargetTeam: { ID: 3 } },
          { Type: "TeamTechResearched", Team: { Player_2: "Hammurabi", ID: 3 }, Tech: "Writing", ChangeAmount: 1 },
          { Type: "PlayerAdoptPolicyBranch", Player: "2: Babylon", Branch: "Authority" }
        ]
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
          events: { "2": [{ Type: "BuildFinished" }] }
        },
        3: {
          turn: 3,
          reports: {},
          events: { "3": [{ Type: "DeclareWar" }] }
        }
      }
    } as unknown as StrategistParameters;

    expect(mergeCachedEvents(parameters, 2, 3)).toEqual({
      "2": [{ Type: "BuildFinished" }],
      "3": [{ Type: "DeclareWar" }]
    });
  });

  it("carries over the get-events markdown config so the merge renders with headings", () => {
    const markdownConfig = { configs: [{ format: "Turn {key}" }, { format: "{key}" }] };
    const parameters = {
      gameStates: {
        2: {
          turn: 2,
          reports: {},
          events: { "2": [{ Type: "BuildFinished" }], _markdownConfig: markdownConfig }
        },
        3: {
          turn: 3,
          reports: {},
          events: { "3": [{ Type: "DeclareWar" }], _markdownConfig: markdownConfig }
        }
      }
    } as unknown as StrategistParameters;

    expect(mergeCachedEvents(parameters, 2, 3)).toEqual({
      _markdownConfig: markdownConfig,
      "2": [{ Type: "BuildFinished" }],
      "3": [{ Type: "DeclareWar" }]
    });
  });
});

describe("getDecisionEventWindows", () => {
  it("drops the oldest event turn on each retry", () => {
    expect(getDecisionEventWindows(1, 3)).toEqual([
      { fromTurn: 1, toTurn: 3 },
      { fromTurn: 2, toTurn: 3 },
      { fromTurn: 3, toTurn: 3 }
    ]);
  });
});

describe("getDecisionTurnContext", () => {
  const baseParameters = {
    playerID: 2,
    turn: 37,
    metadata: {
      YouAre: {
        Leader: "Wu Zetian",
        Name: "China"
      }
    }
  } as unknown as StrategistParameters;

  it("omits the last decision turn when it was the previous turn", () => {
    expect(getDecisionTurnContext({
      ...baseParameters,
      lastDecisionTurn: 36
    })).toBe("You, Wu Zetian (leader of China, Player 2), are making strategic decisions after turn 37.");
  });

  it("includes the last decision turn when there was a skipped gap", () => {
    expect(getDecisionTurnContext({
      ...baseParameters,
      lastDecisionTurn: 32
    })).toBe("You, Wu Zetian (leader of China, Player 2), are making strategic decisions after turn 37 (last decision made at turn 32).");
  });
});
