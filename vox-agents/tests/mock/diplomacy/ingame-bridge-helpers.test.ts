/**
 * Pure transport-helper coverage for the in-game diplomacy bridge.
 */

import { describe, expect, it, vi } from "vitest";
import {
  IngameBridge,
  packMessageBatches,
  toGameContent,
} from "../../../src/envoy/ingame-bridge.js";
import type { TranscriptPushMessage } from "../../../src/utils/diplomacy/transcript.js";

/** Build one game-bound transcript row with optional content padding. */
function row(id: number, content: string = `row ${id}`): TranscriptPushMessage {
  return {
    ID: id,
    SpeakerID: 3,
    MessageType: "text",
    Content: content,
    Payload: { source: "test" },
    Turn: 9,
  };
}

describe("toGameContent", () => {
  it("strips the pipe delimiter and converts markdown only at the game boundary", () => {
    expect(toGameContent("Hello !@#$%^!**world**"))
      .toBe("Hello [COLOR_YELLOW]world[ENDCOLOR]");
  });
});

describe("packMessageBatches", () => {
  it("projects only pinned game fields and preserves row order", () => {
    const source = {
      ...row(4, "**Terms**"),
      Player1ID: 1,
      Player2ID: 3,
      Player1Role: "the leader",
      Player2Role: "diplomat",
      CreatedAt: 123,
    };

    const [batch] = packMessageBatches([source], "append");

    expect(batch).toEqual({
      mode: "append",
      messages: [{
        ID: 4,
        SpeakerID: 3,
        MessageType: "text",
        Content: "[COLOR_YELLOW]Terms[ENDCOLOR]",
        Payload: { source: "test" },
        Turn: 9,
      }],
    });
  });

  it("splits large pages without truncation and puts paging state on the final batch", () => {
    const messages = [
      row(1, "a".repeat(18_000)),
      row(2, "b".repeat(18_000)),
      row(3, "c".repeat(18_000)),
    ];

    const batches = packMessageBatches(messages, "prepend", true);

    expect(batches.map((batch) =>
      (batch.messages as TranscriptPushMessage[]).map((message) => message.ID)
    )).toEqual([[1], [2], [3]]);
    expect(batches.slice(0, -1).every((batch) => !("hasMore" in batch))).toBe(true);
    expect(batches.at(-1)?.hasMore).toBe(true);
    expect(batches.flatMap((batch) => batch.messages as TranscriptPushMessage[]))
      .toHaveLength(messages.length);
  });

  it("truncates one oversized display row so its batch stays within the wire budget", () => {
    const [batch] = packMessageBatches([row(1, "x".repeat(40_000))], "append");
    const [message] = batch.messages as TranscriptPushMessage[];

    expect(Buffer.byteLength(JSON.stringify({ ...batch, hasMore: true }), "utf8"))
      .toBeLessThanOrEqual(30 * 1024);
    expect(message.Content).toContain("[Message truncated for in-game display.]");
    expect(message.Content.length).toBeLessThan(40_000);
  });

  it("omits an oversized display payload when content truncation cannot fit the row", () => {
    const oversized = {
      ...row(2, "Deal summary"),
      Payload: { deal: "x".repeat(40_000) },
    };
    const [batch] = packMessageBatches([oversized], "append");
    const [message] = batch.messages as TranscriptPushMessage[];

    expect(Buffer.byteLength(JSON.stringify({ ...batch, hasMore: true }), "utf8"))
      .toBeLessThanOrEqual(30 * 1024);
    expect(message.Content).toBe("Deal summary");
    expect(message.Payload).toBeUndefined();
  });
});

describe("IngameBridge invalid-event handling", () => {
  /** Build a bridge whose context dependencies are not needed by rejected event shapes. */
  function bridge(): IngameBridge {
    return new IngameBridge({
      getCounterpartContext: () => undefined,
      getAssignments: () => ({}),
    });
  }

  it("queues an error Status when routeable IDs accompany an invalid cursor", async () => {
    const transport = bridge();
    const push = vi.spyOn(transport as never, "push" as never).mockResolvedValue(undefined as never);

    transport.handleNotification({
      event: "DiplomacyTranscriptRequest",
      playerID: 1,
      turn: 8,
      latestID: 8_000_001,
      PlayerID: 1,
      Turn: 8,
      data: { PlayerID: 1, CounterpartID: 3, BeforeID: -1 },
    });

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("VoxDeorumDiploStatus", [
      1,
      3,
      { state: "error", detail: "Invalid diplomacy event." },
    ], expect.anything()));
  });

  it("settles and cleans up a failed Status push without an unhandled rejection", async () => {
    const transport = bridge();
    const push = vi.spyOn(transport as never, "push" as never)
      .mockRejectedValue(new Error("DLL_DISCONNECTED") as never);

    transport.handleNotification({
      event: "DiplomacyTranscriptRequest",
      playerID: 1,
      turn: 8,
      latestID: 8_000_002,
      PlayerID: 1,
      Turn: 8,
      data: { PlayerID: 1, CounterpartID: 3, BeforeID: -1 },
    });

    await vi.waitFor(() => expect(push).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect((transport as unknown as { pushQueue: Map<string, Promise<void>> }).pushQueue.size).toBe(0));
  });

  it("ignores new notifications after disposal", async () => {
    const transport = bridge();
    const push = vi.spyOn(transport as never, "push" as never).mockResolvedValue(undefined as never);
    transport.dispose();

    transport.handleNotification({
      event: "DiplomacyTranscriptRequest",
      playerID: 1,
      turn: 8,
      latestID: 8_000_003,
      PlayerID: 1,
      Turn: 8,
      data: { PlayerID: 1, CounterpartID: 3, BeforeID: -1 },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(push).not.toHaveBeenCalled();
  });
});
