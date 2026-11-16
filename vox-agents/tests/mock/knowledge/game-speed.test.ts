import { describe, expect, it } from "vitest";
import { getGameSpeedMultiplier, getOffsetedTurn, resolveGameSpeedMultiplier } from "../../../src/knowledge/game-speed.js";
import { resolveReplaySpeed } from "../../../src/newspaper/replay/session.js";
import { makeStrategistParameters } from "../../helpers/fake-vox-context.js";

describe("game speed timing", () => {
  it('should resolve metadata without strategist state and leave unknown names unresolved', () => {
    expect(resolveGameSpeedMultiplier({ GameSpeed: 'Epic', GameSpeedMultiplier: 2.4 })).toBe(2.4);
    expect(resolveGameSpeedMultiplier({ GameSpeed: 'Quick', GameSpeedMultiplier: 0 })).toBe(0.67);
    expect(resolveGameSpeedMultiplier({ GameSpeed: 'Marathon' })).toBe(3);
    expect(resolveGameSpeedMultiplier({ GameSpeed: 'Standard' })).toBe(1);
    expect(resolveGameSpeedMultiplier({ GameSpeed: '보통' })).toBeUndefined();
    expect(resolveGameSpeedMultiplier({ GameSpeed: 'toString' })).toBeUndefined();
    expect(resolveGameSpeedMultiplier()).toBeUndefined();
  });

  it.each(['Quick', 'Standard', 'Epic', 'Marathon'])('should prefer recognized recorded speed %s over a replay override', name => {
    expect(resolveReplaySpeed(name, 2)).toMatchObject({ source: 'recorded', multiplier: resolveGameSpeedMultiplier({ GameSpeed: name }), recordedName: name });
  });

  it.each([null, '보통', 'Unknown'])('should use an override or labelled Standard assumption for recorded name %s', recordedName => {
    expect(resolveReplaySpeed(recordedName, 1.8)).toMatchObject({ multiplier: 1.8, source: 'override', recordedName });
    expect(resolveReplaySpeed(recordedName)).toMatchObject({ multiplier: 1, source: 'assumedStandard', recordedName, label: expect.any(String) });
  });
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
