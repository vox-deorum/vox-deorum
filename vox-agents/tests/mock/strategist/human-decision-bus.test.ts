import { describe, expect, it } from "vitest";
import { HumanDecisionBus, type HumanDecisionSubmission } from "../../../src/strategist/human-decision-bus.js";

describe("HumanDecisionBus", () => {
  it("resolves a pending request with the submission", async () => {
    const bus = new HumanDecisionBus();
    const submission: HumanDecisionSubmission = { PlayerID: 7, Rationale: "go tall", DeliberationMs: 1234, StatusQuo: true };

    const waiting = bus.request(7);
    expect(bus.isPending(7)).toBe(true);

    expect(bus.resolve(7, submission)).toBe(true);
    await expect(waiting).resolves.toEqual(submission);
    // Resolving clears the pending entry.
    expect(bus.isPending(7)).toBe(false);
  });

  it("keys pending requests by playerID so seats stay isolated", async () => {
    const bus = new HumanDecisionBus();
    const a = bus.request(3);
    const b = bus.request(7);

    bus.resolve(7, { PlayerID: 7, Rationale: "seven", DeliberationMs: 0 });
    await expect(b).resolves.toMatchObject({ Rationale: "seven" });
    // Player 3's wait is untouched.
    expect(bus.isPending(3)).toBe(true);

    bus.resolve(3, { PlayerID: 3, Rationale: "three", DeliberationMs: 0 });
    await expect(a).resolves.toMatchObject({ Rationale: "three" });
  });

  it("reports resolve on a player with no pending request as a no-op", () => {
    const bus = new HumanDecisionBus();
    expect(bus.resolve(7, { PlayerID: 7, Rationale: "nobody waiting", DeliberationMs: 0 })).toBe(false);
  });

  it("cancel rejects the pending wait and clears the entry", async () => {
    const bus = new HumanDecisionBus();
    const waiting = bus.request(7);

    expect(bus.cancel(7, new Error("crash"))).toBe(true);
    await expect(waiting).rejects.toThrow("crash");
    expect(bus.isPending(7)).toBe(false);
    // Cancelling again is a no-op.
    expect(bus.cancel(7)).toBe(false);
  });

  it("a fresh request supersedes a still-pending one without being shadowed", async () => {
    const bus = new HumanDecisionBus();
    // Simulates a crash-recovery relaunch: the old wait was never explicitly
    // cancelled, but the new request must take over (spec §6).
    const stale = bus.request(7);
    const fresh = bus.request(7);

    await expect(stale).rejects.toThrow(/Superseded/);
    expect(bus.isPending(7)).toBe(true);

    bus.resolve(7, { PlayerID: 7, Rationale: "re-presented", DeliberationMs: 0 });
    await expect(fresh).resolves.toMatchObject({ Rationale: "re-presented" });
  });

  it("cancelAll rejects every pending wait", async () => {
    const bus = new HumanDecisionBus();
    const a = bus.request(1);
    const b = bus.request(2);

    bus.cancelAll(new Error("shutting down"));

    await expect(a).rejects.toThrow("shutting down");
    await expect(b).rejects.toThrow("shutting down");
    expect(bus.isPending(1)).toBe(false);
    expect(bus.isPending(2)).toBe(false);
  });
});
