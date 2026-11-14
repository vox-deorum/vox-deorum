/**
 * Pure transport-helper coverage for the in-game diplomacy bridge.
 */

import { describe, expect, it, vi } from "vitest";
import {
  IngameBridge,
  IngameChatSink,
  packMessageBatches,
  toGameContent,
  type GameSinkPort,
  type GameStatusState,
} from "../../../../src/diplomacy/ingame/ingame-bridge.js";
import type { TranscriptPushMessage } from "../../../../src/diplomacy/transcript/transcript.js";

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

  // A counterpart with no live context is an ordinary civilization this session assigns no
  // envoy, not a malformed caller. Reporting both as "Invalid diplomacy caller." made a live
  // observer session read as a bare transport timeout with nothing in any log to explain it,
  // so the two refusals must stay distinguishable on screen.
  it("reports a counterpart with no live context as a pair with no envoy", async () => {
    const transport = bridge();
    const push = vi.spyOn(transport as never, "push" as never).mockResolvedValue(undefined as never);

    transport.handleNotification({
      event: "DiplomacyPanelOpened",
      playerID: 8,
      turn: 10,
      latestID: 8_000_004,
      PlayerID: 8,
      Turn: 10,
      data: { PlayerID: 8, CounterpartID: 0, Turn: 10, AsObserver: true },
    });

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("VoxDeorumDiploStatus", [
      8,
      0,
      { state: "error", detail: "This leader has no envoy in this session." },
    ], expect.anything()));
  });

  it("still reports a self-addressed pair as an invalid caller", async () => {
    const transport = bridge();
    const push = vi.spyOn(transport as never, "push" as never).mockResolvedValue(undefined as never);

    transport.handleNotification({
      event: "DiplomacyPanelOpened",
      playerID: 3,
      turn: 10,
      latestID: 8_000_005,
      PlayerID: 3,
      Turn: 10,
      data: { PlayerID: 3, CounterpartID: 3, Turn: 10 },
    });

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("VoxDeorumDiploStatus", [
      3,
      3,
      { state: "error", detail: "Invalid diplomacy caller." },
    ], expect.anything()));
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

describe("IngameBridge deal-action parsing", () => {
  let latest = 9_000_000;

  /**
   * Feed one event through the parser and report the Status detail it produced.
   *
   * The bridge has no live counterpart context, so a payload that PARSES reaches the caller
   * resolution step and fails there as a pair with no envoy, while a payload the parser rejects
   * never gets that far ("Invalid diplomacy event."). That difference is the assertion — the
   * two details are sentinels for "parsed" versus "did not parse", not the behaviour under test.
   */
  async function parseDetail(data: Record<string, unknown>): Promise<string | undefined> {
    const transport = new IngameBridge({
      getCounterpartContext: () => undefined,
      getAssignments: () => ({}),
    });
    const push = vi.spyOn(transport as never, "push" as never).mockResolvedValue(undefined as never);
    latest += 1;
    transport.handleNotification({
      event: "DiplomacyDealAction",
      playerID: 1,
      turn: 8,
      latestID: latest,
      PlayerID: 1,
      Turn: 8,
      data,
    });
    await vi.waitFor(() => expect(push).toHaveBeenCalledOnce());
    const status = (push.mock.calls[0] as unknown as [string, [number, number, { detail: string }]])[1][2];
    return status.detail;
  }

  const accepted = "This leader has no envoy in this session.";
  const rejected = "Invalid diplomacy event.";
  const pair = { PlayerID: 1, CounterpartID: 3, Turn: 8 };

  it("accepts each canonical action with its required fields", async () => {
    await expect(parseDetail({ ...pair, Action: "propose", Deal: { version: 1 } })).resolves.toBe(accepted);
    await expect(parseDetail({ ...pair, Action: "counter", Deal: { version: 1 }, ProposalMessageID: 7 }))
      .resolves.toBe(accepted);
    await expect(parseDetail({ ...pair, Action: "accept", ProposalMessageID: 7 })).resolves.toBe(accepted);
    await expect(parseDetail({ ...pair, Action: "reject", ProposalMessageID: 7, Text: "No." }))
      .resolves.toBe(accepted);
  });

  it("retains an observer deal action, which carries no caller identity", async () => {
    await expect(parseDetail({ ...pair, PlayerID: 27, Action: "accept", ProposalMessageID: 7, AsObserver: true }))
      .resolves.toBe(accepted);
  });

  it("rejects a deal action with no action at all", async () => {
    await expect(parseDetail({ ...pair })).resolves.toBe(rejected);
  });

  it("rejects an action outside the canonical set, including the driver-local retract", async () => {
    await expect(parseDetail({ ...pair, Action: "retract", ProposalMessageID: 7 })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "enact", ProposalMessageID: 7 })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: 3, ProposalMessageID: 7 })).resolves.toBe(rejected);
  });

  it("requires a deal payload for propose and counter", async () => {
    await expect(parseDetail({ ...pair, Action: "propose" })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "counter", ProposalMessageID: 7 })).resolves.toBe(rejected);
  });

  it("requires a proposal reference for every action but propose", async () => {
    await expect(parseDetail({ ...pair, Action: "counter", Deal: { version: 1 } })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "accept" })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "reject" })).resolves.toBe(rejected);
  });

  it("rejects malformed field types on an otherwise complete action", async () => {
    await expect(parseDetail({ ...pair, Action: "propose", Deal: "not-a-deal" })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "propose", Deal: [1, 2] })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "accept", ProposalMessageID: 0 })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "accept", ProposalMessageID: -7 })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "accept", ProposalMessageID: 7.5 })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "accept", ProposalMessageID: "7" })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "reject", ProposalMessageID: 7, Text: 12 })).resolves.toBe(rejected);
    await expect(parseDetail({ ...pair, Action: "accept", ProposalMessageID: 7, AsObserver: false }))
      .resolves.toBe(rejected);
  });
});

describe("IngameChatSink", () => {
  /** A recording stand-in for the pair's push FIFO seam. */
  function fakePort() {
    const order: string[] = [];
    const rows: TranscriptPushMessage[][] = [];
    const statuses: { state: GameStatusState; detail?: string }[] = [];
    const deltas: string[] = [];
    let settles = 0;
    const port: GameSinkPort = {
      queueRows: (queued) => { rows.push(queued); order.push("rows"); },
      queueStatus: (state, detail) => { statuses.push({ state, detail }); order.push("status"); },
      queueDelta: (text) => { deltas.push(text); order.push("delta"); },
      settle: async () => { settles += 1; },
    };
    return { port, order, rows, statuses, deltas, settled: () => settles };
  }

  /** A sink whose clock the test advances explicitly, so delta throttling is deterministic. */
  function sinkWithClock() {
    const recorder = fakePort();
    let now = 10_000;
    const sink = new IngameChatSink(recorder.port, () => now);
    return { ...recorder, sink, advance: (ms: number) => { now += ms; } };
  }

  /** Build one durable row projection. */
  function durable(id: number, type = "text", speakerID = 3): TranscriptPushMessage {
    return { ID: id, SpeakerID: speakerID, MessageType: type, Content: `row ${id}`, Turn: 4 };
  }

  it("turns the progress sentinel into a generic status and never speaks it", () => {
    const { sink, statuses, deltas } = sinkWithClock();

    sink.message({ type: "text-delta", id: "progress", text: "Fetching episodes for turn 42...\n" });

    expect(statuses).toEqual([{ state: "composing", detail: undefined }]);
    expect(deltas).toEqual([]);
  });

  it("accumulates ordinary text deltas and pushes the cumulative draft about once per second", () => {
    const { sink, deltas, advance } = sinkWithClock();

    sink.message({ type: "text-delta", id: "m1", text: "Greet" });
    sink.message({ type: "text-delta", id: "m1", text: "ings" });
    sink.message({ type: "text-delta", id: "m1", text: ", friend" });
    expect(deltas).toEqual(["Greet"]);

    advance(1_000);
    sink.message({ type: "text-delta", id: "m1", text: "." });

    // Cumulative and idempotent, so the throttled-away middle deltas cost the panel nothing.
    expect(deltas).toEqual(["Greet", "Greetings, friend."]);
  });

  it("reports reasoning and tool activity as bare states carrying no content", () => {
    const { sink, statuses, deltas } = sinkWithClock();

    sink.message({ type: "reasoning-start", id: "r1" });
    sink.message({ type: "reasoning-delta", id: "r1", text: "They will never accept this." });
    sink.message({ type: "tool-input-start", id: "t1", toolName: "get-briefing" });
    sink.message({ type: "tool-input-delta", id: "t1", delta: "{\"Player\":3" });
    sink.message({ type: "tool-call", toolCallId: "t1", toolName: "get-briefing", input: { Player: 3 } });
    sink.message({ type: "tool-result", toolCallId: "t1", toolName: "get-briefing" });

    expect(statuses).toEqual([
      { state: "reasoning", detail: undefined },
      { state: "tool", detail: undefined },
    ]);
    expect(deltas).toEqual([]);
    expect(JSON.stringify(statuses)).not.toContain("never accept");
  });

  it("re-announces an activity that resumes after the diplomat spoke", () => {
    const { sink, statuses } = sinkWithClock();

    sink.message({ type: "tool-call", toolCallId: "t1", toolName: "get-briefing" });
    sink.message({ type: "text-delta", id: "m1", text: "One moment." });
    sink.message({ type: "tool-call", toolCallId: "t2", toolName: "get-briefing" });

    expect(statuses.map((status) => status.state)).toEqual(["tool", "tool"]);
  });

  it("drops unrecognized chunks and the send-message tool traffic the streamer already converted", () => {
    const { sink, order } = sinkWithClock();

    sink.message({ type: "text-start", id: "m1" });
    sink.message({ type: "text-end", id: "m1" });
    sink.message({ type: "raw" });
    sink.message({ type: "source" });
    sink.message({ type: "finish-step" });
    sink.message({ type: "tool-call", toolCallId: "s1", toolName: "send-message" });
    sink.message({ type: "tool-result", toolCallId: "s1", toolName: "send-message" });
    sink.message({ type: "text-delta", id: "m1", text: "" });

    expect(order).toEqual([]);
  });

  it("retains and pushes the caller row and the terminal rows separately", async () => {
    const { sink, rows, order, settled } = sinkWithClock();

    sink.connected({ sessionId: "s", rows: [durable(10, "text", 1)] });
    sink.done({ sessionId: "s", messageCount: 2, deals: [], rows: [durable(11), durable(12, "deal-proposal")] });
    await sink.settle();

    expect(order).toEqual(["rows", "rows"]);
    expect(rows.map((batch) => batch.map((message) => message.ID))).toEqual([[10], [11, 12]]);
    expect(sink.connectedRows.map((message) => message.ID)).toEqual([10]);
    expect(sink.terminalRows.map((message) => message.ID)).toEqual([11, 12]);
    expect(sink.terminal).toBe("done");
    expect(settled()).toBe(1);
  });

  it("pushes the durable rows of a post-commit failure before its error status", () => {
    const { sink, order, rows, statuses } = sinkWithClock();

    sink.connected({ sessionId: "s", rows: [durable(10, "text", 1)] });
    sink.error({ message: "Failed to execute agent: boom", rows: [durable(11, "deal-proposal")] });

    expect(order).toEqual(["rows", "rows", "status"]);
    expect(rows[1].map((message) => message.ID)).toEqual([11]);
    expect(statuses).toEqual([{ state: "error", detail: "Failed to execute agent: boom" }]);
    expect(sink.terminal).toBe("error");
    expect(sink.failure).toBe("Failed to execute agent: boom");
  });

  it("skips an empty row set rather than pushing an empty increment", () => {
    const { sink, order } = sinkWithClock();

    sink.connected({ sessionId: "s", rows: [] });

    expect(order).toEqual([]);
    expect(sink.connectedRows).toEqual([]);
  });

  it("keeps the first terminal event and ignores a second one", () => {
    const { sink, rows } = sinkWithClock();

    sink.done({ sessionId: "s", messageCount: 1, deals: [], rows: [durable(11)] });
    sink.error({ message: "late", rows: [durable(12)] });

    expect(sink.terminal).toBe("done");
    expect(rows.map((batch) => batch.map((message) => message.ID))).toEqual([[11]]);
  });

  it("ignores a disconnect request, because the game has no socket to cancel a run with", () => {
    const { sink, order } = sinkWithClock();
    const cancel = vi.fn();

    sink.onDisconnect(cancel);

    expect(cancel).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });
});
