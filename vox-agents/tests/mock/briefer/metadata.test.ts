import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { agentRegistry } from "../../../src/agents/runtime/agent-registry.js";
import type { SimpleBriefer } from "../../../src/briefer/simple-briefer.js";
import type { SpecializedBriefer } from "../../../src/briefer/specialized-briefer.js";
import type { StrategistParameters } from "../../../src/strategist/strategy-parameters.js";
import type { VoxContext } from "../../../src/agents/runtime/vox-context.js";
import { createFakeVoxContext, makeGameState, makeStrategistParameters } from "../../helpers/fake-vox-context.js";

/** Both public briefer entry paths using their normal input contracts. */
const builders = [
  {
    name: "simple",
    build: (parameters: StrategistParameters, context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> =>
      (agentRegistry.get("simple-briefer") as SimpleBriefer).getInitialMessages(parameters, "", context),
  },
  {
    name: "specialized",
    build: (parameters: StrategistParameters, context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> =>
      (agentRegistry.get("specialized-briefer") as SpecializedBriefer).getInitialMessages(parameters, { mode: "Military", instruction: "" }, context),
  },
];

/** Prepare a populated turn cache that can be briefed without fetching reports again. */
function parametersForBriefing(): StrategistParameters {
  return makeStrategistParameters({
    turn: 20,
    metadata: undefined,
    gameStates: {
      20: makeGameState(20, { players: {}, cities: {}, events: {}, military: {}, victory: {} } as never),
      5: makeGameState(5, { reports: { briefing: "earlier-strategic-observation" } }),
      15: makeGameState(15, { reports: { briefing: "later-strategic-observation" } }),
    },
  });
}

describe.each(builders)("$name briefer metadata", ({ build }) => {
  it.each(["马拉松", "마라톤"])("should repair identity and use numeric timing with localized speed %s", async (speed) => {
    const ctx = createFakeVoxContext();
    const params = parametersForBriefing();
    const identity = { Name: "한국", Leader: "세종", PlayerID: 1 };
    ctx.respondWith("get-game-settings", { GameSpeed: speed, GameSpeedMultiplier: 3, YouAre: identity });

    const messages = await build(params, ctx.asContext());
    const contents = messages.map(message => message.content).join("\n");

    expect(contents).toContain(identity.Name);
    expect(contents).toContain(identity.Leader);
    expect(contents).toContain("earlier-strategic-observation");
    expect(contents).not.toContain("later-strategic-observation");
    expect(ctx.calls().map(call => call.name)).toEqual(["get-game-settings"]);
    await build(params, ctx.asContext());
    expect(ctx.calls("get-game-settings")).toHaveLength(1);
  });

  it("should reject unavailable identity before building a prompt", async () => {
    const ctx = createFakeVoxContext();
    const params = parametersForBriefing();
    ctx.respondWith("get-game-settings", { GameSpeed: "Standard" });

    await expect(build(params, ctx.asContext())).rejects.toThrow();
    expect(params.metadata).toBeUndefined();
  });
});
