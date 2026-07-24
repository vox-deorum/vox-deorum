/**
 * Runtime transport coverage for the in-game diplomacy bridge. The MCP, transcript,
 * and chat edges are mocked so these tests exercise queue ordering and game switches.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendRow: vi.fn(),
  callTool: vi.fn(),
  loggerError: vi.fn(),
  openChat: vi.fn(),
  readPage: vi.fn(),
}));

vi.mock("../../../src/utils/models/mcp-client.js", () => ({
  mcpClient: { callTool: mocks.callTool },
}));

vi.mock("../../../src/utils/diplomacy/transcript.js", () => ({
  appendTranscriptMessageRow: mocks.appendRow,
  diplomacyThreadId: (playerAID: number, playerBID: number, gameID: string) => `${gameID}:${playerAID}:${playerBID}`,
  readTranscriptPage: mocks.readPage,
}));

vi.mock("../../../src/web/chat/factory.js", () => ({ openDiplomacyChat: mocks.openChat }));
vi.mock("../../../src/web/chat/enrichment.js", () => ({
  civIdentity: () => ({ name: "Rome", leader: "Caesar" }),
}));
vi.mock("../../../src/utils/diplomacy/chat-turn-commit.js", () => ({ isThreadBusy: () => false }));
vi.mock("../../../src/utils/diplomacy/civ5-markup.js", () => ({ markdownToCiv5: (content: string) => content }));
vi.mock("../../../src/utils/logger.js", () => ({
  createLogger: () => ({ error: mocks.loggerError, warn: vi.fn() }),
}));

import { IngameBridge } from "../../../src/envoy/ingame-bridge.js";

/** Build one committed transcript row. */
function row(id: number, content: string = `row ${id}`) {
  return { ID: id, SpeakerID: 3, MessageType: "text", Content: content, Turn: 7 };
}

/** Create an unresolved promise whose test controls its completion. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
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

/** Extract the Lua function names sent through the generic passthrough. */
function pushedNames(): string[] {
  return mocks.callTool.mock.calls.map((call) => call[1].Name as string);
}

describe("IngameBridge runtime transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callTool.mockResolvedValue({ structuredContent: { success: true } });
    mocks.readPage.mockResolvedValue({ messages: [], hasMore: false });
    mocks.openChat.mockResolvedValue({ player1ID: 1, player2ID: 3 });
    mocks.appendRow.mockResolvedValue(row(91));
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
    opening.resolve({ player1ID: 1, player2ID: 3 });
    await vi.waitFor(() => expect(mocks.appendRow).toHaveBeenCalledOnce());
  });

  it("finishes a reflush before a later history request can prepend", async () => {
    const bridge = bridgeFor();
    const firstPage = deferred<{ messages: ReturnType<typeof row>[]; hasMore: boolean }>();
    mocks.readPage.mockReturnValueOnce(firstPage.promise).mockResolvedValue({ messages: [row(1)], hasMore: true });

    bridge.handleNotification(event("DiplomacyPanelOpened", 4, { PlayerID: 1, CounterpartID: 3 }));
    bridge.handleNotification(event("DiplomacyTranscriptRequest", 5, { PlayerID: 1, CounterpartID: 3, BeforeID: 10 }));
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

    bridge.handleNotification(event("DiplomacyTranscriptRequest", 6, { PlayerID: 1, CounterpartID: 3, BeforeID: 20 }));

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
    const duplicate = event("DiplomacyPanelOpened", 7, { PlayerID: 1, CounterpartID: 3 });

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

  it("preserves a real observer identity through the temporary probe append", async () => {
    const bridge = bridgeFor();
    bridge.handleNotification(event("DiplomacyChatMessage", 8, {
      PlayerID: 27,
      CounterpartID: 3,
      AsObserver: true,
      Text: "Observer note",
    }));

    await vi.waitFor(() => expect(mocks.appendRow).toHaveBeenCalledOnce());
    expect(mocks.openChat).toHaveBeenCalledWith(expect.objectContaining({
      callerPlayerID: 27,
      callerRole: "Observer",
    }));
    expect(mocks.appendRow).toHaveBeenCalledWith(expect.anything(), 27, "Observer note", "game-a");
  });

  it("pushes an error Status when a chat append fails", async () => {
    const bridge = bridgeFor();
    mocks.openChat.mockRejectedValue(new Error("The requested seat is not active."));

    bridge.handleNotification(event("DiplomacyChatMessage", 81, {
      PlayerID: 1,
      CounterpartID: 3,
      Text: "hello",
    }));

    await vi.waitFor(() => expect(pushedNames()).toEqual(["VoxDeorumDiploStatus"]));
    expect(mocks.callTool.mock.calls[0][1].Args[2]).toEqual({
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

    bridge.handleNotification(event("DiplomacyPanelOpened", 9, { PlayerID: 1, CounterpartID: 3 }));

    await vi.waitFor(() => expect(pushedNames()).toEqual([
      "VoxDeorumDiploBegin",
      "VoxDeorumDiploStatus",
    ]));
    expect(pushedNames()).not.toContain("VoxDeorumDiploMessages");
  });

  it("invalidates an in-flight action before its append can reach a new game database", async () => {
    const bridge = bridgeFor("game-a");
    const opening = deferred<unknown>();
    mocks.openChat.mockReturnValue(opening.promise);

    bridge.handleNotification(event("DiplomacyChatMessage", 10, { PlayerID: 1, CounterpartID: 3, Text: "stale" }));
    await vi.waitFor(() => expect(mocks.openChat).toHaveBeenCalledOnce());
    bridge.resetForGame("game-b");
    opening.resolve({ player1ID: 1, player2ID: 3 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.appendRow).not.toHaveBeenCalled();
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight action when its owning session is disposed", async () => {
    const bridge = bridgeFor("game-a");
    const opening = deferred<unknown>();
    mocks.openChat.mockReturnValue(opening.promise);

    bridge.handleNotification(event("DiplomacyChatMessage", 11, { PlayerID: 1, CounterpartID: 3, Text: "stale" }));
    await vi.waitFor(() => expect(mocks.openChat).toHaveBeenCalledOnce());
    bridge.dispose();
    opening.resolve({ player1ID: 1, player2ID: 3 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.appendRow).not.toHaveBeenCalled();
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
