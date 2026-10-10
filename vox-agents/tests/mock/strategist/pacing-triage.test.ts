/**
 * Tests for strategist triage (src/strategist/pacing/triage.ts): when it runs, how the evaluator's
 * `revision` score maps to a verdict, which events the evaluator sees, and the fallback on failure.
 */
import { describe, expect, it, vi } from "vitest";

// Read only the seat overrides, so a local config.json evaluator cannot leak into these tests.
vi.mock("../../../src/utils/models/evaluation.js", () => ({
  getEvaluatorConfig: (_name: string, overrides?: Record<string, unknown>) => overrides?.evaluator,
}));

import { runStrategistTriage } from "../../../src/strategist/pacing/triage.js";
import type { TriageSetting } from "../../../src/types/config.js";
import { createFakeVoxContext, makeGameState, makeStrategistParameters } from "../../helpers/fake-vox-context.js";

const strategist = "simple-strategist";

/** Wire a decision on turn 5 with one event per cached turn, an evaluator, and a scripted revision score. */
function setup(options: { triage?: TriageSetting; evaluator?: boolean; score?: number; signal?: AbortSignal } = {}) {
  const fake = createFakeVoxContext();
  const gameStates = Object.fromEntries([3, 4, 5].map(turn => [turn, makeGameState(turn, {
    events: { [String(turn)]: [{ Type: `EventOnTurn${turn}` }] } as never,
  })]));
  const parameters = makeStrategistParameters({ turn: 5, gameStates });
  const state = gameStates[5];
  if (options.evaluator ?? true) fake.modelOverrides = { evaluator: { provider: "typesafe", name: "jev-latest" } };
  fake.evaluate.mockResolvedValue({ answers: { revision: { score: options.score ?? 2 } } });

  const context = fake.asContext();
  Object.assign(context, {
    triage: options.triage ?? [strategist],
    currentSignal: () => options.signal ?? new AbortController().signal,
  });
  return { fake, context, parameters, state };
}

/** Run triage for the standard setup, with turns 4 and 5 not yet covered by a decision. */
function triage({ context, parameters, state }: ReturnType<typeof setup>) {
  return runStrategistTriage(context, parameters, state, strategist, 4);
}

describe("runStrategistTriage", () => {
  it("should not evaluate when triage is off for the strategist", async () => {
    const run = setup({ triage: ["diplomat"] });

    expect(await triage(run)).toBeUndefined();
    expect(run.fake.evaluate).not.toHaveBeenCalled();
  });

  it("should not evaluate when no evaluator is configured", async () => {
    const run = setup({ evaluator: false });

    expect(await triage(run)).toBeUndefined();
    expect(run.fake.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    [0, "skip"],
    [0.9, "small"],
    [2.2, "default"],
    [3, "large"],
  ])("should map a revision score of %s to %s", async (score, verdict) => {
    expect(await triage(setup({ score }))).toBe(verdict);
  });

  it("should evaluate the events since the last decision without touching the cached state", async () => {
    const run = setup();

    await triage(run);

    expect(run.fake.evaluate).toHaveBeenCalledTimes(1);
    const [, text, options] = run.fake.evaluate.mock.calls[0] as [unknown, string, { purpose: string; questions: object }];
    expect(options.purpose).toBe("triage");
    expect(Object.keys(options.questions)).toEqual(["revision"]);
    expect(text).toContain("EventOnTurn4");
    expect(text).toContain("EventOnTurn5");
    expect(text).not.toContain("EventOnTurn3");
    expect(run.state.mergedEvents).toBeUndefined();
  });

  it("should fall back to the cadence when the evaluation fails", async () => {
    const run = setup();
    run.fake.evaluate.mockRejectedValue(new Error("evaluator down"));

    expect(await triage(run)).toBeUndefined();
    expect(run.fake.logger.warn).toHaveBeenCalled();
  });

  it("should rethrow a failure once the run is aborted", async () => {
    const controller = new AbortController();
    const run = setup({ signal: controller.signal });
    run.fake.evaluate.mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });

    await expect(triage(run)).rejects.toThrow();
  });
});
