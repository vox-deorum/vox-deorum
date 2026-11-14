import { describe, expect, it } from "vitest";
import { getGameSpeedMultiplier, getOffsetedTurn } from "../../../src/knowledge/game-speed.js";
import { makeStrategistParameters } from "../../helpers/fake-vox-context.js";

describe("game speed timing", () => {
  it("should prefer a positive numeric multiplier over an English speed name", () => {
    const params = makeStrategistParameters();
    params.metadata = { ...params.metadata!, GameSpeed: "Quick", GameSpeedMultiplier: 2.4 };

    expect(getGameSpeedMultiplier(params)).toBe(2.4);
    expect(getOffsetedTurn(params, -5)).toBe(params.turn - 12);
  });

  it.each([undefined, 0, -1, Infinity, NaN])("should preserve English timing for invalid or absent numeric multiplier %s", (multiplier) => {
    const params = makeStrategistParameters();
    params.metadata = { ...params.metadata!, GameSpeed: "Epic", GameSpeedMultiplier: multiplier };

    expect(getGameSpeedMultiplier(params)).toBe(1.5);
  });

  it("should preserve the standard fallback for older localized metadata and absent metadata", () => {
    const params = makeStrategistParameters();
    params.metadata = { ...params.metadata!, GameSpeed: "보통" };
    expect(getOffsetedTurn(params, -5)).toBe(params.turn - 5);
    params.metadata = undefined;
    expect(getGameSpeedMultiplier(params)).toBe(1);
  });
});
