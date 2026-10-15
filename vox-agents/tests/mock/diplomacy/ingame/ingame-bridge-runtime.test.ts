/**
 * Runtime transport coverage for the in-game diplomacy bridge. The MCP, transcript, chat-turn, and
 * deal-action edges are mocked so these tests exercise what the bridge itself owns: queue ordering,
 * game switches, the routing of every event kind to the shared backend action, and the notification
 * boundary. What those shared actions *do* is covered by their own suites (deal-actions.test.ts,
 * chat-turn tests); what the notification helper decides is covered by notify.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStreamSink } from "../../../../src/types/index.js";

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  callTool: vi.fn(),
  loggerError: vi.fn(),
  notify: vi.fn(),
  openChat: vi.fn(),
  readActive: vi.fn(),
  readPage: vi.fn(),
  reject: vi.fn(),
  runChatTurn: vi.fn(),
}));

vi.mock("../../../../src/utils/models/mcp-client.js", () => ({
  mcpClient: { callTool: mocks.callTool },
}));

vi.mock("../../../../src/utils/diplomacy/transcript/transcript.js", () => ({
  diplomacyThreadId: (playerAID: number, playerBID: number, gameID: string) => `${gameID}:${playerAID}:${playerBID}`,
  readTranscriptPage: mocks.readPage,
}));

vi.mock("../../../../src/web/chat/factory.js", () => ({ openDiplomacyChat: mocks.openChat }));
vi.mock("../../../../src/web/chat/turn.js", () => ({ runChatTurn: mocks.runChatTurn }));
vi.mock("../../../../src/web/chat/enrichment.js", () => ({
  civIdentity: () => ({ name: "Rome", leader: "Caesar" }),
}));
vi.mock("../../../../src/utils/diplomacy/ingame/notify.js", () => ({ notifyDiplomacyOutcome: mocks.notify }));
vi.mock("../../../../src/utils/diplomacy/deal/deal-actions.js", () => ({
  acceptDealAction: mocks.accept,
  rejectDealAction: mocks.reject,
  NotDiplomacyThreadError: class NotDiplomacyThreadError extends Error {},
}));
// The bridge only reads this module for its error vocabulary and the open-offer read backing a
// blind panel propose; the real one pulls the whole transcript I/O layer in behind it, which this
// transport suite deliberately replaces.
vi.mock("../../../../src/utils/diplomacy/deal/deal.js", () => ({
  IllegalDealError: class IllegalDealError extends Error {},
  ProposalConflictError: class ProposalConflictError extends Error {},
  readActiveProposal: mocks.readActive,
}));
vi.mock("../../../../src/utils/diplomacy/turn/chat-turn-commit.js", () => ({
  isThreadBusy: () => false,
  ThreadBusyError: class ThreadBusyError extends Error {},
  threadBusyMessage: "A reply is already being generated for this conversation. Please wait for it to finish.",
}));
vi.mock("../../../../src/utils/diplomacy/ingame/civ5-markup.js", () => ({ markdownToCiv5: (content: string) => content }));
vi.mock("../../../../src/utils/logger.js", () => ({
  createLogger: () => ({ error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { IngameBridge } from "../../../../src/utils/diplomacy/ingame/ingame-bridge.js";
import { ProposalConflictError } from "../../../../src/utils/diplomacy/deal/deal.js";
import { ThreadBusyError, threadBusyMessage } from "../../../../src/utils/diplomacy/turn/chat-turn-commit.js";
import { deferred } from "../../../helpers/deferred.js";

/** Build one committed transcript row. */
function row(id: number, content: string = `row ${id}`, speakerID = 3) {
  return { ID: id, SpeakerID: speakerID, MessageType: "text", Content: content, Turn: 7 };
}

/** Build one durable deal outcome row. */
function dealRow(id: number, type: string, content = `deal ${id}`) {
  return { ID: id, SpeakerID: 1, MessageType: type, Content: content, Turn: 7, Payload: { ProposalMessageID: 7 } };
}

/** Build a live counterpart context and reset the bridge to that game. */
function bridgeFor(gameID = "game-a") {
  const context = {
    id: `context-${gameID}`,
    getBaseParameters: () => ({ gameID, turn: 7 }),
    session: { getTurn: () => 7 },
  };
  const bridge = new IngameBridge({
    getCounterpartContext: (playerID) => playerID === 3 ? context as never : undefined,
    getAssignments: () => ({ 3: { diplomat: "diplomat" } }),
  });
  bridge.resetForGame(gameID);
  return bridge;
}

/** Build a routeable stage-03 game notification. */
function event(eventName: string, latestID: number, data: Record<string, unknown>) {
  return {
    event: eventName,
    playerID: 1,
    turn: 7,
    latestID,
    PlayerID: 1,
    Turn: 7,
    data,
  } as never;
}

/** A well-formed deal action for the 1↔3 pair. */
function dealEvent(latestID: number, data: Record<string, unknown>) {
  return event("DiplomacyDealAction", latestID, { PlayerID: 1, CounterpartID: 3, Turn: 7, ...data });
}

/** Extract the Lua function names sent through the generic passthrough. */
function pushedNames(): string[] {
  return mocks.callTool.mock.calls.map((call) => call[1].Name as string);
}

/** The payload argument of the nth Lua call. */
function pushedArg(index: number): unknown {
  return mocks.callTool.mock.calls[index][1].Args[2];
}

describe("IngameBridge runtime transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callTool.mockResolvedValue({ structuredContent: { success: true } });
    mocks.readPage.mockResolvedValue({ messages: [], hasMore: false });
    mocks.openChat.mockResolvedValue({ id: "dipl:game-a:1:3", player1ID: 1, player2ID: 3 });
    mocks.notify.mockResolvedValue(true);
    // A turn that commits the caller row, then completes with the diplomat's archived reply.
    mocks.runChatTurn.mockImplementation(async (_body: unknown, sink: ChatStreamSink) => {
      sink.connected({ sessionId: "s", rows: [row(90, "hello", 1)] });
      sink.done({ sessionId: "s", messageCount: 2, deals: [], rows: [row(91, "Greetings.")] });
      return undefined;
    });
  });

  it("dispatches a valid panel-open event into an atomic begin then transcript push", async () => {
    const bridge = bridgeFor();
    mocks.readPage.mockResolvedValue({ messages: [row(4)], hasMore: false });

    bridge.handleNotification(event("DiplomacyPanelOpened", 1, { PlayerID: 1, CounterpartID: 3 }));

    await vi.waitFor(() => expect(pushedNames()).toEqual([
      "VoxDeorumDiploBegin",
      "VoxDeorumDiploMessages",
    ]));
  });

  it("keeps a blocked action FIFO independent from the push FIFO", async () => {
    const bridge = bridgeFor();
    const opening = deferred<unknown>();
    mocks.openChat.mockReturnValue(opening.promise);

    bridge.handleNotification(event("DiplomacyChatMessage", 2, { PlayerID: 1, CounterpartID: 3, Text: "hello" }));
    await vi.waitFor(() => expect(mocks.openChat).toHaveBeenCalledOnce());
    bridge.handleNotification(event("DiplomacyPanelOpened", 3, { PlayerID: 1, CounterpartID: 3 }));

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploBegin"]));
    opening.resolve({ id: "dipl:game-a:1:3", player1ID: 1, player2ID: 3 });
    await vi.waitFor(() => expect(mocks.runChatTurn).toHaveBeenCalledOnce());
  });

  it("lands a sink push while the turn that produced it still owns the action FIFO", async () => {
    const bridge = bridgeFor();
    const running = deferred<undefined>();
    mocks.runChatTurn.mockImplementation(async (_body: unknown, sink: ChatStreamSink) => {
      sink.connected({ sessionId: "s", rows: [row(90, "hello", 1)] });
      return running.promise;
    });

    bridge.handleNotification(event("DiplomacyChatMessage", 4, { PlayerID: 1, CounterpartID: 3, Text: "hello" }));

    // The turn has not returned, so the action FIFO is still blocked; the caller row must not be
    // waiting behind it. A sink callback that awaited the action queue would hang here forever.
    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploMessages"]));
    expect(mocks.notify).not.toHaveBeenCalled();
    running.resolve(undefined);
  });

  it("finishes a reflush before a later history request can prepend", async () => {
    const bridge = bridgeFor();
    const firstPage = deferred<{ messages: ReturnType<typeof row>[]; hasMore: boolean }>();
    mocks.readPage.mockReturnValueOnce(firstPage.promise).mockResolvedValue({ messages: [row(1)], hasMore: true });

    bridge.handleNotification(event("DiplomacyPanelOpened", 5, { PlayerID: 1, CounterpartID: 3 }));
    bridge.handleNotification(event("DiplomacyTranscriptRequest", 6, { PlayerID: 1, CounterpartID: 3, BeforeID: 10 }));
    expect(mocks.callTool).not.toHaveBeenCalled();
    firstPage.resolve({ messages: [row(10)], hasMore: false });

    await vi.waitFor(() => expect(pushedNames()).toEqual([
      "VoxDeorumDiploBegin",
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploMessages",
    ]));
  });

  it("sends multi-batch prepends newest batch first and paging state with the oldest batch", async () => {
    const bridge = bridgeFor();
    mocks.readPage.mockResolvedValue({
      messages: [row(1, "a".repeat(18_000)), row(2, "b".repeat(18_000)), row(3, "c".repeat(18_000))],
      hasMore: true,
    });

    bridge.handleNotification(event("DiplomacyTranscriptRequest", 7, { PlayerID: 1, CounterpartID: 3, BeforeID: 20 }));

    await vi.waitFor(() => expect(pushedNames()).toEqual([
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploMessages",
    ]));
    const batches = mocks.callTool.mock.calls.map((call) => call[1].Args[2]);
    expect(batches.map((batch: { messages: { ID: number }[] }) => batch.messages[0].ID)).toEqual([3, 2, 1]);
    expect(batches.map((batch: { hasMore?: boolean }) => batch.hasMore)).toEqual([undefined, undefined, true]);
  });

  it("suppresses duplicate deliveries before parsing or dispatch", async () => {
    const bridge = bridgeFor();
    const duplicate = event("DiplomacyPanelOpened", 8, { PlayerID: 1, CounterpartID: 3 });

    bridge.handleNotification(duplicate);
    bridge.handleNotification(duplicate);

    await vi.waitFor(() => expect(mocks.readPage).toHaveBeenCalledOnce());
  });

  it("deduplicates malformed routeable events before their error Status is queued", async () => {
    const bridge = bridgeFor();
    const malformed = event("DiplomacyTranscriptRequest", 70, { PlayerID: 1, CounterpartID: 3, BeforeID: -1 });

    bridge.handleNotification(malformed);
    bridge.handleNotification(malformed);

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploStatus"]));
  });

  it("re-admits a reused event ID after the dedup reset for a DLL reconnect", async () => {
    // A reloaded save restores the DLL's event-ID sequence, so a same-game relaunch re-issues IDs
    // this bridge already consumed; resetEventDedup is what lets the first post-reload request through.
    const bridge = bridgeFor();

    bridge.handleNotification(event("DiplomacyPanelOpened", 71, { PlayerID: 1, CounterpartID: 3 }));
    await vi.waitFor(() => expect(mocks.readPage).toHaveBeenCalledOnce());
    bridge.resetEventDedup();
    bridge.handleNotification(event("DiplomacyPanelOpened", 71, { PlayerID: 1, CounterpartID: 3 }));

    await vi.waitFor(() => expect(mocks.readPage).toHaveBeenCalledTimes(2));
  });

  it("keeps an in-flight action live across the dedup reset, unlike a game switch", async () => {
    const bridge = bridgeFor("game-a");
    const opening = deferred<unknown>();
    mocks.openChat.mockReturnValue(opening.promise);

    bridge.handleNotification(event("DiplomacyChatMessage", 72, { PlayerID: 1, CounterpartID: 3, Text: "hello" }));
    await vi.waitFor(() => expect(mocks.openChat).toHaveBeenCalledOnce());
    bridge.resetEventDedup();
    opening.resolve({ id: "dipl:game-a:1:3", player1ID: 1, player2ID: 3 });

    await vi.waitFor(() => expect(mocks.runChatTurn).toHaveBeenCalledOnce());
  });

  it("preserves a real observer identity through the shared chat turn", async () => {
    const bridge = bridgeFor();
    bridge.handleNotification(event("DiplomacyChatMessage", 9, {
      PlayerID: 27,
      CounterpartID: 3,
      AsObserver: true,
      Text: "Observer note",
    }));

    await vi.waitFor(() => expect(mocks.runChatTurn).toHaveBeenCalledOnce());
    expect(mocks.openChat).toHaveBeenCalledWith(expect.objectContaining({
      callerPlayerID: 27,
      callerRole: "Observer",
      callerIdentity: undefined,
    }));
    expect(mocks.runChatTurn.mock.calls[0][0]).toEqual({
      kind: "text",
      chatId: "dipl:game-a:1:3",
      message: "Observer note",
    });
  });

  it("pushes the caller row, the terminal rows, the terminal idle status, and then notifies", async () => {
    const bridge = bridgeFor();
    mocks.notify.mockImplementation(async () => {
      // Captured at call time: the notification must follow both the rows AND the terminal
      // status it announces — every action ends with exactly one terminal status before
      // anything downstream of the turn (the outcome notification) runs.
      expect(pushedNames()).toEqual([
        "VoxDeorumDiploMessages",
        "VoxDeorumDiploMessages",
        "VoxDeorumDiploStatus",
      ]);
      return true;
    });

    bridge.handleNotification(event("DiplomacyChatMessage", 10, { PlayerID: 1, CounterpartID: 3, Text: "hello" }));

    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    expect((pushedArg(0) as { messages: { ID: number }[] }).messages.map((m) => m.ID)).toEqual([90]);
    expect((pushedArg(1) as { messages: { ID: number }[] }).messages.map((m) => m.ID)).toEqual([91]);
    expect(pushedArg(2)).toEqual({ state: "idle" });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      playerID: 1,
      counterpartID: 3,
      rows: [row(91, "Greetings.")],
    }));
  });

  it("queues a terminal error Status, and never notifies, when a turn settles done with no rows", async () => {
    const bridge = bridgeFor();
    mocks.runChatTurn.mockImplementation(async (_body: unknown, sink: ChatStreamSink) => {
      sink.connected({ sessionId: "s", rows: [row(90, "hello", 1)] });
      // The negotiator's terminal tool ran but persisted nothing, so `done` carries no rows at
      // all — settled, but nothing durable to show for it.
      sink.done({ sessionId: "s", messageCount: 1, deals: [], rows: [] });
      return undefined;
    });

    bridge.handleNotification(event("DiplomacyChatMessage", 10, { PlayerID: 1, CounterpartID: 3, Text: "hello" }));

    await vi.waitFor(() => expect(pushedNames()).toEqual([
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploStatus",
    ]));
    expect(pushedArg(1)).toEqual({
      state: "error",
      detail: "The envoy could not settle on a response. Please try again.",
    });
    expect(mocks.notify).not.toHaveBeenCalled();
    // Quiescence: the error must be this action's only terminal status — no trailing idle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const statuses = mocks.callTool.mock.calls
      .filter((call) => call[1].Name === "VoxDeorumDiploStatus")
      .map((call) => (call[1].Args[2] as { state: string }).state);
    expect(statuses).toEqual(["error"]);
  });

  it("queues the same terminal error Status when the turn reneges on ever reporting one", async () => {
    const bridge = bridgeFor();
    mocks.runChatTurn.mockImplementation(async (_body: unknown, sink: ChatStreamSink) => {
      // Neither `done` nor `error` fires — the shape a throw inside `turn.ts`'s own terminal emitter
      // leaves behind (see the invariant on `runTurn`): `sink.terminal` stays `undefined` even though
      // the turn has genuinely ended.
      sink.connected({ sessionId: "s", rows: [row(90, "hello", 1)] });
      return undefined;
    });

    bridge.handleNotification(event("DiplomacyChatMessage", 18, { PlayerID: 1, CounterpartID: 3, Text: "hello" }));

    await vi.waitFor(() => expect(pushedNames()).toEqual([
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploStatus",
    ]));
    expect(pushedArg(1)).toEqual({
      state: "error",
      detail: "The envoy could not settle on a response. Please try again.",
    });
    expect(mocks.notify).not.toHaveBeenCalled();
    // Quiescence: the error must be this action's only terminal status — no trailing idle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const statuses = mocks.callTool.mock.calls
      .filter((call) => call[1].Name === "VoxDeorumDiploStatus")
      .map((call) => (call[1].Args[2] as { state: string }).state);
    expect(statuses).toEqual(["error"]);
  });

  it("turns a pre-stream chat rejection into an error Status without notifying", async () => {
    const bridge = bridgeFor();
    mocks.runChatTurn.mockResolvedValue({ status: 409, error: "This conversation was closed this turn." });

    bridge.handleNotification(event("DiplomacyChatMessage", 11, { PlayerID: 1, CounterpartID: 3, Text: "hello" }));

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploStatus"]));
    expect(pushedArg(0)).toEqual({ state: "error", detail: "This conversation was closed this turn." });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("delivers the durable rows of a post-commit failure and never notifies", async () => {
    const bridge = bridgeFor();
    mocks.runChatTurn.mockImplementation(async (_body: unknown, sink: ChatStreamSink) => {
      sink.connected({ sessionId: "s", rows: [row(90, "hello", 1)] });
      sink.error({ message: "Failed to execute agent: boom", rows: [dealRow(92, "deal-proposal")] });
      return undefined;
    });

    bridge.handleNotification(event("DiplomacyChatMessage", 12, { PlayerID: 1, CounterpartID: 3, Text: "hello" }));

    await vi.waitFor(() => expect(pushedNames()).toEqual([
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploStatus",
    ]));
    expect((pushedArg(1) as { messages: { ID: number }[] }).messages.map((m) => m.ID)).toEqual([92]);
    expect(pushedArg(2)).toEqual({ state: "error", detail: "Failed to execute agent: boom" });
    expect(mocks.notify).not.toHaveBeenCalled();
    // Quiescence: `sink.terminal === "error"` must return outright, never falling into the shared
    // post-settle branch that appends `idle` for a genuine outcome.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const statuses = mocks.callTool.mock.calls
      .filter((call) => call[1].Name === "VoxDeorumDiploStatus")
      .map((call) => (call[1].Args[2] as { state: string }).state);
    expect(statuses).toEqual(["error"]);
  });

  it("rejects an empty chat message before it can open a thread", async () => {
    const bridge = bridgeFor();

    bridge.handleNotification(event("DiplomacyChatMessage", 13, { PlayerID: 1, CounterpartID: 3, Text: "   " }));

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploStatus"]));
    expect(pushedArg(0)).toEqual({ state: "error", detail: "A chat message is required." });
    expect(mocks.openChat).not.toHaveBeenCalled();
  });

  it("pushes an error Status when opening the pair fails", async () => {
    const bridge = bridgeFor();
    mocks.openChat.mockRejectedValue(new Error("The requested seat is not active."));

    bridge.handleNotification(event("DiplomacyChatMessage", 14, {
      PlayerID: 1,
      CounterpartID: 3,
      Text: "hello",
    }));

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploStatus"]));
    expect(pushedArg(0)).toEqual({
      state: "error",
      detail: "Diplomacy request failed: The requested seat is not active.",
    });
  });

  it("stops after an explicit Lua failure instead of continuing the reflush", async () => {
    const bridge = bridgeFor();
    mocks.readPage.mockResolvedValue({ messages: [row(4)], hasMore: false });
    mocks.callTool
      .mockResolvedValueOnce({ structuredContent: { success: false, error: { code: "NO_DLL", message: "offline" } } })
      .mockResolvedValue({ structuredContent: { success: true } });

    bridge.handleNotification(event("DiplomacyPanelOpened", 15, { PlayerID: 1, CounterpartID: 3 }));

    await vi.waitFor(() => expect(pushedNames()).toEqual([
      "VoxDeorumDiploBegin",
      "VoxDeorumDiploStatus",
    ]));
    expect(pushedNames()).not.toContain("VoxDeorumDiploMessages");
  });

  it("invalidates an in-flight action before its turn can reach a new game database", async () => {
    const bridge = bridgeFor("game-a");
    const opening = deferred<unknown>();
    mocks.openChat.mockReturnValue(opening.promise);

    bridge.handleNotification(event("DiplomacyChatMessage", 16, { PlayerID: 1, CounterpartID: 3, Text: "stale" }));
    await vi.waitFor(() => expect(mocks.openChat).toHaveBeenCalledOnce());
    bridge.resetForGame("game-b");
    opening.resolve({ id: "dipl:game-a:1:3", player1ID: 1, player2ID: 3 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.runChatTurn).not.toHaveBeenCalled();
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight action when its owning session is disposed", async () => {
    const bridge = bridgeFor("game-a");
    const opening = deferred<unknown>();
    mocks.openChat.mockReturnValue(opening.promise);

    bridge.handleNotification(event("DiplomacyChatMessage", 17, { PlayerID: 1, CounterpartID: 3, Text: "stale" }));
    await vi.waitFor(() => expect(mocks.openChat).toHaveBeenCalledOnce());
    bridge.dispose();
    opening.resolve({ id: "dipl:game-a:1:3", player1ID: 1, player2ID: 3 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.runChatTurn).not.toHaveBeenCalled();
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  it("surfaces a text-only MCP tool error from a failed push", async () => {
    const bridge = bridgeFor("game-a");
    mocks.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "The active game no longer matches." }],
    });

    await expect((bridge as unknown as {
      push: (
        name: string,
        args: unknown[],
        guard: { generation: number; gameID?: string },
      ) => Promise<boolean>;
    }).push("VoxDeorumDiploBegin", [], { generation: 1, gameID: "game-a" }))
      .rejects.toThrow("call-lua-function VoxDeorumDiploBegin failed: The active game no longer matches.");
  });
});

describe("IngameBridge deal actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callTool.mockResolvedValue({ structuredContent: { success: true } });
    mocks.readPage.mockResolvedValue({ messages: [], hasMore: false });
    mocks.openChat.mockResolvedValue({ id: "dipl:game-a:1:3", player1ID: 1, player2ID: 3 });
    mocks.notify.mockResolvedValue(true);
    mocks.readActive.mockResolvedValue({ active: null, status: "none", proposals: [] });
    mocks.runChatTurn.mockImplementation(async (_body: unknown, sink: ChatStreamSink) => {
      sink.connected({ sessionId: "s", rows: [dealRow(80, "deal-proposal")] });
      sink.done({ sessionId: "s", messageCount: 2, deals: [], rows: [row(81, "Interesting.")] });
      return undefined;
    });
  });

  it("routes a propose action with nothing open through the shared chat turn without an expected proposal", async () => {
    const bridge = bridgeFor();

    bridge.handleNotification(dealEvent(20, { Action: "propose", Deal: { version: 1, items: [] } }));

    await vi.waitFor(() => expect(mocks.runChatTurn).toHaveBeenCalledOnce());
    expect(mocks.runChatTurn.mock.calls[0][0]).toEqual({
      kind: "deal",
      chatId: "dipl:game-a:1:3",
      deal: { version: 1, items: [] },
    });
  });

  it("coerces a propose into a counter when an offer is already open", async () => {
    const bridge = bridgeFor();
    // The panel's Propose is pressed blind (it never carries the offer the player saw), so the
    // bridge derives the open offer — the player's own included — and submits against it, letting
    // classifyDealSubmission archive the deal as a counter instead of 409ing.
    mocks.readActive.mockResolvedValue({
      active: { ID: 7, SpeakerID: 3 },
      status: "open",
      proposals: [],
    });

    bridge.handleNotification(dealEvent(22, { Action: "propose", Deal: { version: 1, items: [] } }));

    await vi.waitFor(() => expect(mocks.runChatTurn).toHaveBeenCalledOnce());
    expect(mocks.readActive).toHaveBeenCalledWith(1, 3);
    expect(mocks.runChatTurn.mock.calls[0][0]).toEqual({
      kind: "deal",
      chatId: "dipl:game-a:1:3",
      deal: { version: 1, items: [] },
      expectedProposalID: 7,
    });
  });

  it("routes a counter action with the mounted proposal as expectedProposalID", async () => {
    const bridge = bridgeFor();

    bridge.handleNotification(dealEvent(21, {
      Action: "counter",
      Deal: { version: 1, items: [] },
      ProposalMessageID: 7,
    }));

    await vi.waitFor(() => expect(mocks.runChatTurn).toHaveBeenCalledOnce());
    expect(mocks.runChatTurn.mock.calls[0][0]).toEqual({
      kind: "deal",
      chatId: "dipl:game-a:1:3",
      deal: { version: 1, items: [] },
      expectedProposalID: 7,
    });
  });

  it("pushes a countered deal's row then exactly one idle status, and notifies", async () => {
    const bridge = bridgeFor();
    // The motivating case for the `idle`-vs-`error` split: the turn's only terminal row is the
    // `deal-counter` itself (no free-text reply alongside it), so `terminalRows` is non-empty even
    // though it holds a single structured row.
    mocks.runChatTurn.mockImplementation(async (_body: unknown, sink: ChatStreamSink) => {
      sink.connected({ sessionId: "s", rows: [dealRow(80, "deal-proposal")] });
      sink.done({ sessionId: "s", messageCount: 2, deals: [], rows: [dealRow(93, "deal-counter")] });
      return undefined;
    });

    bridge.handleNotification(dealEvent(29, {
      Action: "counter",
      Deal: { version: 1, items: [] },
      ProposalMessageID: 7,
    }));

    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    expect(pushedNames()).toEqual([
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploMessages",
      "VoxDeorumDiploStatus",
    ]);
    expect((pushedArg(1) as { messages: { ID: number }[] }).messages.map((m) => m.ID)).toEqual([93]);
    expect(pushedArg(2)).toEqual({ state: "idle" });
  });

  it("opens the pair before dispatching a direct action, since a panel open caches no thread", async () => {
    const bridge = bridgeFor();
    mocks.accept.mockResolvedValue({ rows: [dealRow(30, "deal-accept"), dealRow(31, "deal-enacted")], changed: true });

    bridge.handleNotification(dealEvent(22, { Action: "accept", ProposalMessageID: 7 }));

    await vi.waitFor(() => expect(mocks.accept).toHaveBeenCalledOnce());
    expect(mocks.openChat).toHaveBeenCalledBefore(mocks.accept);
    expect(mocks.openChat).toHaveBeenCalledWith(expect.objectContaining({
      callerPlayerID: 1,
      targetPlayerID: 3,
      callerRole: "the leader",
    }));
  });

  it("queues the exact accept rows and notifies a state-changing acceptance", async () => {
    const bridge = bridgeFor();
    mocks.accept.mockResolvedValue({ rows: [dealRow(30, "deal-accept"), dealRow(31, "deal-enacted")], changed: true });

    bridge.handleNotification(dealEvent(23, { Action: "accept", ProposalMessageID: 7 }));

    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    expect(mocks.accept).toHaveBeenCalledWith(expect.objectContaining({ id: "dipl:game-a:1:3" }), 7);
    expect((pushedArg(0) as { messages: { ID: number }[] }).messages.map((m) => m.ID)).toEqual([30, 31]);
    expect(pushedArg(1)).toEqual({ state: "idle" });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ changed: true }));
  });

  it("routes a retract, which arrives as canonical reject, through the shared rejection action", async () => {
    const bridge = bridgeFor();
    mocks.reject.mockResolvedValue({ rows: [dealRow(40, "deal-reject")], changed: true });

    bridge.handleNotification(dealEvent(24, {
      Action: "reject",
      ProposalMessageID: 7,
      Text: "I withdraw this offer.",
    }));

    await vi.waitFor(() => expect(mocks.reject).toHaveBeenCalledOnce());
    expect(mocks.reject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dipl:game-a:1:3" }),
      7,
      "I withdraw this offer.",
    );
    expect((pushedArg(0) as { messages: { ID: number }[] }).messages.map((m) => m.ID)).toEqual([40]);
  });

  it("re-pushes an idempotent rejection's existing row, then idle, while reporting no state change", async () => {
    const bridge = bridgeFor();
    mocks.reject.mockResolvedValue({ rows: [dealRow(40, "deal-reject")], changed: false });

    bridge.handleNotification(dealEvent(25, { Action: "reject", ProposalMessageID: 7 }));

    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
    // The panel dedupes the repeated row by ID, but the deal screen's resolver needs it to release
    // the mounted editor, so the acknowledgement is pushed exactly as a fresh rejection would be.
    // A direct transactional action never runs the sink, so it queues its own terminal `idle`
    // status right after its rows (same invariant `runTurn` upholds for a streamed turn).
    expect(pushedNames()).toEqual(["VoxDeorumDiploMessages", "VoxDeorumDiploStatus"]);
    expect((pushedArg(0) as { messages: { ID: number }[] }).messages.map((m) => m.ID)).toEqual([40]);
    expect(pushedArg(1)).toEqual({ state: "idle" });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ changed: false }));
  });

  it("maps a typed proposal conflict to one error Status", async () => {
    const bridge = bridgeFor();
    mocks.accept.mockRejectedValue(new ProposalConflictError("That proposal is no longer the open offer."));

    bridge.handleNotification(dealEvent(26, { Action: "accept", ProposalMessageID: 7 }));

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploStatus"]));
    expect(pushedArg(0)).toEqual({
      state: "error",
      detail: "That proposal is no longer the open offer.",
    });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("maps a busy thread to the one shared busy wording", async () => {
    const bridge = bridgeFor();
    mocks.reject.mockRejectedValue(new ThreadBusyError());

    bridge.handleNotification(dealEvent(27, { Action: "reject", ProposalMessageID: 7 }));

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploStatus"]));
    expect(pushedArg(0)).toEqual({ state: "error", detail: threadBusyMessage });
  });

  it("keeps an untyped deal failure on the generic transport-failure path", async () => {
    const bridge = bridgeFor();
    mocks.accept.mockRejectedValue(new Error("store unreachable"));

    bridge.handleNotification(dealEvent(28, { Action: "accept", ProposalMessageID: 7 }));

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploStatus"]));
    expect(pushedArg(0)).toEqual({
      state: "error",
      detail: "Diplomacy request failed: store unreachable",
    });
  });
});
