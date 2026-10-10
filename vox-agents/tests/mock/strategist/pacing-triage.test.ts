/**
 * Tests for strategist triage (src/strategist/pacing/triage.ts): when it runs, how the evaluator's
 * `revision` score maps to a verdict, which events the evaluator sees, the trimming it shares with
 * the evaluator strategist, and the fallback on failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";

// Read only the seat overrides, so a local config.json evaluator cannot leak into these tests.
vi.mock("../../../src/utils/models/evaluation.js", () => ({
  getEvaluatorConfig: (_name: string, overrides?: Record<string, unknown>) => overrides?.evaluator,
}));

import { runStrategistTriage } from "../../../src/strategist/pacing/triage.js";
import type { TriageSetting } from "../../../src/types/config.js";
import type { Model, StrategistTrim } from "../../../src/types/index.js";
import { countTokens } from "../../../src/utils/models/token-counter.js";
import { createFakeVoxContext, makeGameState, makeStrategistParameters } from "../../helpers/fake-vox-context.js";

const strategist = "simple-strategist";

const evaluatorModel = { provider: "typesafe", name: "jev-latest" } as Model;

/** An error the event window fallback treats as an overflow. */
const overflow = () => Object.assign(new Error("state too long"), { __contextLengthError: true });

/**
 * Wire a decision on turn 5 with one (noise-tier) event per cached turn, an evaluator, and a
 * scripted revision score. `evaluator` replaces the evaluator model, or removes it with false,
 * and `extraEvents` adds events to turn 5.
 */
function setup(options: {
  triage?: TriageSetting;
  evaluator?: Model | false;
  score?: number;
  signal?: AbortSignal;
  extraEvents?: unknown[];
} = {}) {
  const fake = createFakeVoxContext();
  const gameStates = Object.fromEntries([3, 4, 5].map(turn => [turn, makeGameState(turn, {
    events: { [String(turn)]: [{ Type: `EventOnTurn${turn}` }, ...(turn === 5 ? options.extraEvents ?? [] : [])] } as never,
  })]));
  const parameters = makeStrategistParameters({ turn: 5, gameStates });
  const state = gameStates[5];
  if (options.evaluator !== false) fake.modelOverrides = { evaluator: options.evaluator ?? evaluatorModel };
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

/** The state text of each evaluate call, in order. */
function evaluatedStates(run: ReturnType<typeof setup>): string[] {
  return run.fake.evaluate.mock.calls.map(call => call[1] as string);
}

afterEach(() => vi.restoreAllMocks());

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

  it("should trim the state to the evaluator's input limit and record strategist.trim", async () => {
    const setAttribute = vi.fn();
    vi.spyOn(trace, "getActiveSpan").mockReturnValue({ setAttribute } as never);
    const noise = Array.from({ length: 40 }, (_, index) => ({ Type: "TileRevealed", Detail: `plot ${index} `.repeat(30) }));
    const maxInputTokens = 2_000;
    const run = setup({
      evaluator: { ...evaluatorModel, options: { maxInputTokens } } as Model,
      extraEvents: [...noise, { Type: "DeclareWar" }],
    });

    expect(await triage(run)).toBe("default");
    expect(run.fake.evaluate).toHaveBeenCalledTimes(1);

    const call = setAttribute.mock.calls.find(args => args[0] === "strategist.trim");
    expect(call, "triage recorded no trim on the active span").toBeDefined();
    const trim = JSON.parse(call![1] as string) as StrategistTrim;
    expect(trim.steps).toContain("events-noise");
    expect(trim.fits).toBe(true);
    const [text] = evaluatedStates(run);
    expect(countTokens(text)).toBeLessThanOrEqual(maxInputTokens);
    expect(text).not.toContain("TileRevealed");
    expect(text).toContain("DeclareWar");
  });

  it("should retry with fewer events when the state overflows", async () => {
    const run = setup({ score: 3, extraEvents: [{ Type: "DeclareWar" }] });
    run.fake.evaluate.mockRejectedValueOnce(overflow());

    expect(await triage(run)).toBe("large");

    const [first, second] = evaluatedStates(run);
    expect(first).toContain("EventOnTurn4");
    expect(second).not.toContain("EventOnTurn4");
    expect(second).toContain("DeclareWar");
    expect(run.state.mergedEvents).toBeUndefined();
  });

  it("should clear the earlier trim record when a retry needs no trimming", async () => {
    const attributes = new Map<string, string>();
    const setAttribute = vi.fn((name: string, value: string) => attributes.set(name, value));
    vi.spyOn(trace, "getActiveSpan").mockReturnValue({ setAttribute } as never);
    const noise = Array.from({ length: 40 }, (_, index) => ({ Type: "TileRevealed", Detail: `plot ${index} `.repeat(30) }));
    const run = setup({
      evaluator: { ...evaluatorModel, options: { maxInputTokens: 2_000 } } as Model,
      extraEvents: [...noise, { Type: "DeclareWar" }],
    });
    const trimAtEvaluation: string[] = [];
    run.fake.evaluate.mockImplementation(async () => {
      trimAtEvaluation.push(attributes.get("strategist.trim")!);
      if (trimAtEvaluation.length === 1) throw overflow();
      return { answers: { revision: { score: 2 } } };
    });

    expect(await triage(run)).toBe("default");

    expect(run.fake.evaluate).toHaveBeenCalledTimes(2);
    expect(JSON.parse(trimAtEvaluation[0]).steps).toContain("events-noise");
    expect(trimAtEvaluation[1]).toBe("");
    expect(attributes.get("strategist.trim")).toBe("");
    expect(run.state.mergedEvents).toBeUndefined();
  });

  it("should fall back to the cadence when the state never fits", async () => {
    const run = setup({ extraEvents: [{ Type: "DeclareWar" }] });
    run.fake.evaluate.mockRejectedValue(overflow());

    expect(await triage(run)).toBeUndefined();
    expect(run.fake.evaluate.mock.calls.length).toBeGreaterThan(1);
    expect(run.fake.logger.warn).toHaveBeenCalled();
  });

  it("should fall back to the cadence when the evaluation fails", async () => {
    const run = setup();
    run.fake.evaluate.mockRejectedValue(new Error("evaluator down"));

    expect(await triage(run)).toBeUndefined();
    expect(run.fake.evaluate).toHaveBeenCalledTimes(1);
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
