/**
 * Tests for the evaluator strategist (src/strategist/agents/evaluator-strategist.ts): one
 * evaluation call per decision, then the action tools that change something in order. The whole
 * decision is recorded as the `strategist.decision` attribute on the active span, any state
 * trimming as `strategist.trim`, and nothing is returned. The fake context carries a ready cached
 * game state and the MCP tool schemas, so the only tool calls are the actions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import { agentRegistry } from "../../../src/infra/agent-registry.js";
import type { EvaluatorStrategist } from "../../../src/strategist/agents/evaluator-strategist.js";
import type { StrategistAnswer } from "../../../src/strategist/agents/evaluator-questions.js";
import type { Model, StrategistDecision, StrategistTrim } from "../../../src/types/index.js";
import {
  createFakeVoxContext,
  makeGameState,
  makeStrategistParameters,
  makeStrategistToolSchemas,
} from "../../helpers/fake-vox-context.js";

const evaluatorModel = { provider: "typesafe", name: "jev-latest" } as Model;

/** The change-making action tools the strategist may call, all answering with a plain success envelope. */
const actionTools = ["set-flavors", "set-persona", "set-relationship", "set-research", "set-policy"];

/** Answers that change every part of the decision. */
const answers = {
  grand_strategy: { choice: "Space" },
  flavor_Science: { probabilities: { "4": 1 } },
  persona_Boldness: { probabilities: { "4": 1 } },
  relationship_public_2: { probabilities: { "2": 1 } },
  relationship_private_2: { probabilities: { "4": 1 } },
  research: { choice: "Pottery" },
  policy: { choice: "Tradition" },
};

/** Answers that match the game once {@link matchingReport} states the in-game values. */
const matchingAnswers: Record<string, StrategistAnswer> = {
  grand_strategy: { choice: "Balanced" },
  flavor_Science: { probabilities: { "2": 1 } },
  persona_Boldness: { probabilities: { "2": 1 } },
  persona_WarBias: { probabilities: { "2": 1 } },
  relationship_public_2: { probabilities: { "2": 1 } },
  relationship_private_2: { probabilities: { "2": 1 } },
};

/** The default report: no flavor, persona, or relationship values, and no research or policy set. */
const gameOptions = {
  Options: {
    GrandStrategies: { Balanced: "No single focus", Space: "Race for the spaceship" },
    Flavors: { Science: "Research priority" },
    Technologies: { Pottery: "Enables pottery" },
    Policies: { Tradition: "City growth" },
  },
  Strategy: { GrandStrategy: "Balanced" },
  Technology: { Next: "None" },
  Policy: { Next: "None" },
};

/** A report in which every part of {@link matchingAnswers} is already the game's value. */
const matchingReport = {
  Strategy: { GrandStrategy: "Balanced", Flavors: { Science: 50 } },
  Persona: { Boldness: 5, WarBias: 5 },
  Relationships: { Greece: { Public: 0, Private: 0 } },
};

/** The turn the decision is made for, matching the cached game state. */
const turn = 5;

/**
 * Wire a decision: a fake context with a cached game state (no `eventsAfter`, so no refresh),
 * the tool schemas, a scripted evaluation, success handlers for every action, and a run signal.
 * `report` replaces top-level sections of the options report, `answers` scripts the evaluation,
 * and `events` replaces the events report.
 */
function setup(options: {
  mode?: "Strategy" | "Flavor";
  signal?: AbortSignal;
  answers?: Record<string, StrategistAnswer>;
  report?: Record<string, unknown>;
  events?: Record<string, unknown[]>;
} = {}) {
  const fake = createFakeVoxContext();
  const state = makeGameState(turn, {
    options: { ...gameOptions, ...options.report } as never,
    players: {
      "1": { Civilization: "Rome", IsMajor: true },
      "2": { Civilization: "Greece", IsMajor: true },
    } as never,
    events: (options.events ?? { [String(turn)]: [{ Type: "DeclareWar" }] }) as never,
  });
  const parameters = makeStrategistParameters({ turn, mode: options.mode ?? "Flavor", gameStates: { [turn]: state } });
  fake.setBaseParameters(parameters);
  fake.setMcpTools(makeStrategistToolSchemas());
  for (const tool of actionTools) fake.respondWith(tool, { Success: true });
  // The no-change action the strategist sends instead of set-flavors.
  fake.respondWith("keep-status-quo", { Success: true });
  fake.evaluate.mockResolvedValue({ answers: options.answers ?? answers });

  const context = fake.asContext();
  // The fake context has no signal of its own; the strategist reads the active root's.
  (context as unknown as { currentSignal: () => AbortSignal }).currentSignal =
    () => options.signal ?? new AbortController().signal;

  return { fake, context, parameters };
}

/** The prepared system prompt the evaluation state must lead with. */
const systemMarker = "SYSTEM-MARKER";

/** Run one decision with the evaluator model, or a model carrying its own input limit. */
function decide({ context, parameters }: ReturnType<typeof setup>, model: Model = evaluatorModel) {
  return strategist.executeEvaluation(parameters, undefined, context, { system: systemMarker, messages: [], tools: undefined }, model);
}

/** Stand the active span in for a recording double; returns its `setAttribute` spy. */
function recordSpanAttributes() {
  const setAttribute = vi.fn();
  vi.spyOn(trace, "getActiveSpan").mockReturnValue({ setAttribute } as never);
  return setAttribute;
}

/** Parse the `strategist.decision` attribute the recording span was given. */
function recordedDecision(setAttribute: ReturnType<typeof vi.fn>): StrategistDecision {
  const call = setAttribute.mock.calls.find(args => args[0] === "strategist.decision");
  expect(call, "the strategist recorded no decision on the active span").toBeDefined();
  return JSON.parse((call as unknown as [string, string])[1]) as StrategistDecision;
}

/** Parse the `strategist.trim` attribute, or undefined when the strategist recorded no trimming. */
function recordedTrim(setAttribute: ReturnType<typeof vi.fn>): StrategistTrim | undefined {
  const call = setAttribute.mock.calls.find(args => args[0] === "strategist.trim");
  return call === undefined ? undefined : JSON.parse((call as unknown as [string, string])[1]) as StrategistTrim;
}

// Loaded through the registry, which settles the agent module import cycle first.
const strategist = agentRegistry.get("evaluator-strategist") as EvaluatorStrategist;

afterEach(() => vi.restoreAllMocks());

describe("EvaluatorStrategist", () => {
  it("should ask one evaluation over the decision's state and questions", async () => {
    const run = setup();

    await decide(run);

    expect(run.fake.evaluate).toHaveBeenCalledTimes(1);
    const [model, state, options] = run.fake.evaluate.mock.calls[0] as [Model, string, { questions: Record<string, unknown> }];
    expect(model).toBe(evaluatorModel);
    expect(state.startsWith(systemMarker)).toBe(true);
    expect(state).toContain("DeclareWar");
    expect(Object.keys(options.questions)).toEqual(expect.arrayContaining([
      "grand_strategy", "flavor_Science", "research", "policy", "persona_Boldness", "relationship_public_2", "relationship_private_2",
    ]));
  });

  it("should issue the decision tools in order and resolve to nothing", async () => {
    const run = setup();

    await expect(decide(run)).resolves.toBeUndefined();

    expect(run.fake.calls().map(call => call.name)).toEqual(actionTools);
    expect(run.fake.calls("set-flavors")[0].args).toMatchObject({ GrandStrategy: "Space", Flavors: { Science: 100 } });
    expect(run.fake.calls("set-relationship")[0].args).toMatchObject({ TargetID: 2, Public: 0, Private: 100 });
  });

  it("should skip a failed action, issue the ones after it, and record each status", async () => {
    const setAttribute = recordSpanAttributes();
    const run = setup();
    run.fake.respondWith("set-persona", { isError: true });

    const result = await decide(run);

    expect(result).toBeUndefined();
    expect(run.fake.calls().map(call => call.name)).toEqual(actionTools);
    expect(run.fake.logger.warn).toHaveBeenCalled();
    expect(recordedDecision(setAttribute).calls).toEqual([
      { tool: "set-flavors", status: "applied" },
      { tool: "set-persona", status: "failed" },
      { tool: "set-relationship", status: "applied", target: 2 },
      { tool: "set-research", status: "applied" },
      { tool: "set-policy", status: "applied" },
    ]);
  });

  it("should keep the status quo and record dropped calls when the answers match the game", async () => {
    const setAttribute = recordSpanAttributes();
    const run = setup({ report: matchingReport, answers: matchingAnswers });

    await decide(run);

    expect(run.fake.calls().map(call => call.name)).toEqual(["keep-status-quo"]);
    expect(run.fake.calls("keep-status-quo")[0].args).toMatchObject({ PlayerID: 1, Mode: "Flavor" });
    const decision = recordedDecision(setAttribute);
    // The executed call first, then the calls the matching answers dropped.
    expect(decision.calls).toEqual([
      { tool: "keep-status-quo", status: "applied" },
      { tool: "set-persona", status: "dropped" },
      { tool: "set-relationship", status: "dropped", target: 2 },
    ]);
    expect(decision.questions.flavor_Science).toEqual({ current: 50, proposed: 50, sent: false });
  });

  it("should record strategist.trim when the model input limit forces trimming", async () => {
    const setAttribute = recordSpanAttributes();
    const noise = Array.from({ length: 40 }, (_, index) => ({ Type: "TileRevealed", Detail: `plot ${index} `.repeat(30) }));
    const run = setup({ events: { [String(turn)]: [...noise, { Type: "DeclareWar" }] } });
    // A limit whose 90% budget cannot hold even the trimmed state, so the ladder runs.
    const tightModel = { ...evaluatorModel, options: { maxInputTokens: 100 } } as Model;

    await decide(run, tightModel);

    const trim = recordedTrim(setAttribute);
    expect(trim, "the strategist recorded no trim on the active span").toBeDefined();
    expect(trim!.steps).toEqual(["events-noise"]);
    expect(trim!.droppedEvents).toBe(noise.length);
    expect(typeof trim!.fits).toBe("boolean");
    // The trimmed turning-point event still reaches the evaluation.
    const [, state] = run.fake.evaluate.mock.calls[0] as [Model, string];
    expect(state).toContain("DeclareWar");
  });

  it("should record an empty strategist.trim when the state fits the model input limit", async () => {
    const setAttribute = recordSpanAttributes();
    const run = setup();

    await decide(run);

    expect(setAttribute).toHaveBeenCalledWith("strategist.trim", "");
    expect(recordedDecision(setAttribute)).toBeDefined();
  });

  it("should refuse the Strategy decision mode without evaluating", async () => {
    const run = setup({ mode: "Strategy" });

    await expect(decide(run)).rejects.toThrow();

    expect(run.fake.evaluate).not.toHaveBeenCalled();
  });

  it("should stop before any action once the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = setup({ signal: controller.signal });

    await expect(decide(run)).rejects.toThrow();

    expect(run.fake.calls()).toEqual([]);
  });
});
