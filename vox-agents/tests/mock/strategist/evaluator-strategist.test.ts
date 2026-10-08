/**
 * Tests for the evaluator strategist (src/strategist/agents/evaluator-strategist.ts): one
 * evaluation call per decision, then the chosen action tools in order. The fake context carries a
 * ready cached game state and the MCP tool schemas, so the only tool calls are the actions.
 */
import { describe, expect, it } from "vitest";
import { agentRegistry } from "../../../src/infra/agent-registry.js";
import type { EvaluatorStrategist } from "../../../src/strategist/agents/evaluator-strategist.js";
import type { Model } from "../../../src/types/index.js";
import {
  createFakeVoxContext,
  makeGameState,
  makeStrategistParameters,
  makeStrategistToolSchemas,
} from "../../helpers/fake-vox-context.js";

const evaluatorModel = { provider: "typesafe", name: "jev-latest" } as Model;

/** The action tools the strategist may call, all answering with a plain success envelope. */
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

/** The turn the decision is made for, matching the cached game state. */
const turn = 5;

/**
 * Wire a decision: a fake context with a cached game state (no `eventsAfter`, so no refresh),
 * the tool schemas, a scripted evaluation, success handlers for every action, and a run signal.
 */
function setup(options: { mode?: "Strategy" | "Flavor"; signal?: AbortSignal } = {}) {
  const fake = createFakeVoxContext();
  const state = makeGameState(turn, {
    options: {
      Options: {
        GrandStrategies: { Balanced: "No single focus", Space: "Race for the spaceship" },
        Flavors: { Science: "Research priority" },
        Technologies: { Pottery: "Enables pottery" },
        Policies: { Tradition: "City growth" },
      },
      Strategy: { GrandStrategy: "Balanced" },
      Technology: { Next: "None" },
      Policy: { Next: "None" },
    } as never,
    players: {
      "1": { Civilization: "Rome", IsMajor: true },
      "2": { Civilization: "Greece", IsMajor: true },
    } as never,
    events: { [String(turn)]: [{ Type: "DeclareWar" }] } as never,
  });
  const parameters = makeStrategistParameters({ turn, mode: options.mode ?? "Flavor", gameStates: { [turn]: state } });
  fake.setBaseParameters(parameters);
  fake.setMcpTools(makeStrategistToolSchemas());
  for (const tool of actionTools) fake.respondWith(tool, { Success: true });
  fake.evaluate.mockResolvedValue({ answers });

  const context = fake.asContext();
  // The fake context has no signal of its own; the strategist reads the active root's.
  (context as unknown as { currentSignal: () => AbortSignal }).currentSignal =
    () => options.signal ?? new AbortController().signal;

  return { fake, context, parameters };
}

/** Run one decision with the evaluator model. */
function decide({ context, parameters }: ReturnType<typeof setup>) {
  return strategist.executeEvaluation(parameters, undefined, context, {} as never, evaluatorModel);
}

// Loaded through the registry, which settles the agent module import cycle first.
const strategist = agentRegistry.get("evaluator-strategist") as EvaluatorStrategist;

describe("EvaluatorStrategist", () => {
  it("should ask one evaluation over the decision's state and questions", async () => {
    const run = setup();

    await decide(run);

    expect(run.fake.evaluate).toHaveBeenCalledTimes(1);
    const [model, state, options] = run.fake.evaluate.mock.calls[0] as [Model, Record<string, unknown>, { questions: Record<string, unknown> }];
    expect(model).toBe(evaluatorModel);
    expect(state).toHaveProperty("Events");
    expect(Object.keys(options.questions)).toEqual(expect.arrayContaining([
      "grand_strategy", "flavor_Science", "research", "policy", "persona_Boldness", "relationship_public_2", "relationship_private_2",
    ]));
  });

  it("should issue the decision tools in order", async () => {
    const run = setup();

    await decide(run);

    expect(run.fake.calls().map(call => call.name)).toEqual(actionTools);
    expect(run.fake.calls("set-flavors")[0].args).toMatchObject({ GrandStrategy: "Space", Flavors: { Science: 100 } });
    expect(run.fake.calls("set-relationship")[0].args).toMatchObject({ TargetID: 2, Public: 0, Private: 100 });
  });

  it("should skip a failed action and still issue the ones after it", async () => {
    const run = setup();
    run.fake.respondWith("set-persona", { isError: true });

    const result = await decide(run);

    expect(run.fake.calls().map(call => call.name)).toEqual(actionTools);
    expect(result).toMatch(/4 of 5/);
    expect(run.fake.logger.warn).toHaveBeenCalled();
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
