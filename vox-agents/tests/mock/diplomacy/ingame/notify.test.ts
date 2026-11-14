/**
 * @module tests/mock/diplomacy/notify
 *
 * Coverage for the native-notification helper (src/diplomacy/ingame/notify.ts), which owns decision 5
 * of the stage 7.04 wiring plan: a committed action announces itself only when it produced something
 * new for the player to read. Everything asserted here is policy, not plumbing — which durable rows
 * count as an outcome, what the player sees, and the deliberate refusal to let a failed announcement
 * contaminate an action that already succeeded.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { installMockMcpClient, structuredResult } from "../../../helpers/mock-mcp-client.js";
import type { TranscriptPushMessage } from "../../../../src/diplomacy/transcript/transcript.js";
import { eventPipeDelimiter } from "../../../../../mcp-server/dist/bridge/protocol.js";

vi.mock("../../../../src/agents/mcp/mcp-client.js", async () => {
  const helper = await import("../../../helpers/mock-mcp-client.js");
  return helper.mockMcpClientModule();
});

const identity = vi.hoisted(() => ({
  value: undefined as { name: string; leader: string } | undefined,
}));

vi.mock("../../../../src/web/chat/enrichment.js", () => ({
  civIdentity: () => identity.value,
}));

import {
  defaultOutcomeMessage,
  findNotifiableOutcome,
  messageLimit,
  notifyDiplomacyOutcome,
  summaryLimit,
} from "../../../../src/diplomacy/ingame/notify.js";

let mcp: ReturnType<typeof installMockMcpClient>;

beforeEach(() => {
  mcp = installMockMcpClient();
  mcp.respondWith("post-notification", structuredResult({ Success: true, Result: true }));
  identity.value = { name: "Rome", leader: "Caesar" };
});

/** The counterpart is seat 3; the human caller is seat 1. */
const counterpartID = 3;
const playerID = 1;

/** Build one durable row projection. */
function row(
  id: number,
  overrides: Partial<TranscriptPushMessage> = {},
): TranscriptPushMessage {
  return {
    ID: id,
    SpeakerID: counterpartID,
    MessageType: "text",
    Content: `row ${id}`,
    Turn: 4,
    ...overrides,
  };
}

/** Post an outcome with the standard pair. */
function post(rows: TranscriptPushMessage[], changed?: boolean) {
  return notifyDiplomacyOutcome({ playerID, counterpartID, rows, changed });
}

/** The arguments of the single post-notification call. */
function posted() {
  return mcp.calls("post-notification")[0]?.args as Record<string, unknown> | undefined;
}

describe("findNotifiableOutcome", () => {
  it("selects the last counterpart reply, close, or deal row", () => {
    const rows = [row(1, { MessageType: "deal-proposal" }), row(2)];
    expect(findNotifiableOutcome(rows, counterpartID)?.ID).toBe(2);
    expect(findNotifiableOutcome([row(1), row(2, { MessageType: "close" })], counterpartID)?.ID).toBe(2);
  });

  it("ignores rows the caller itself spoke", () => {
    const rows = [row(1, { SpeakerID: playerID }), row(2, { SpeakerID: playerID, MessageType: "close" })];
    expect(findNotifiableOutcome(rows, counterpartID)).toBeUndefined();
  });

  it("counts a deal row whichever endpoint spoke it, since it is a state transition either way", () => {
    const rows = [row(9, { SpeakerID: playerID, MessageType: "deal-accept" })];
    expect(findNotifiableOutcome(rows, counterpartID)?.ID).toBe(9);
  });
});

describe("notifyDiplomacyOutcome eligibility", () => {
  it("posts for a newly committed counterpart reply", async () => {
    await expect(post([row(5, { Content: "We accept your terms." })])).resolves.toBe(true);
    expect(posted()).toMatchObject({ Message: "We accept your terms." });
  });

  it("posts for a counterpart close row", async () => {
    await expect(post([row(5, { MessageType: "close", Content: "Farewell." })])).resolves.toBe(true);
  });

  it("posts for a state-changing deal outcome", async () => {
    await expect(post([
      row(5, { SpeakerID: playerID, MessageType: "deal-accept", Content: "Accepted." }),
      row(6, { SpeakerID: playerID, MessageType: "deal-enacted", Content: "The deal was enacted." }),
    ], true)).resolves.toBe(true);
    expect(posted()).toMatchObject({ Message: "The deal was enacted." });
  });

  it("does not post for an idempotent acknowledgement that changed nothing", async () => {
    await expect(post([row(5, { MessageType: "deal-reject", Content: "Rejected." })], false))
      .resolves.toBe(false);
    expect(mcp.calls("post-notification")).toHaveLength(0);
  });

  it("does not post when nothing was committed, as after a conflict or an unavailable turn", async () => {
    await expect(post([])).resolves.toBe(false);
    expect(mcp.calls("post-notification")).toHaveLength(0);
  });

  it("does not post for the caller's own committed message", async () => {
    await expect(post([row(5, { SpeakerID: playerID, Content: "Hello there." })])).resolves.toBe(false);
    expect(mcp.calls("post-notification")).toHaveLength(0);
  });
});

describe("notifyDiplomacyOutcome content", () => {
  it("targets the caller seat and the conversation counterpart", async () => {
    await notifyDiplomacyOutcome({ playerID: 27, counterpartID, rows: [row(5)] });
    expect(posted()).toMatchObject({ PlayerID: 27, CounterpartID: counterpartID });
  });

  it("headlines with the counterpart's leader and civilization names", async () => {
    await post([row(5)]);
    expect(posted()?.Summary).toBe("Caesar of Rome");
  });

  it("falls back to the civilization, then to the seat, when identity is unavailable", async () => {
    identity.value = { name: "Rome", leader: "" };
    await post([row(5)]);
    expect(posted()?.Summary).toBe("Rome");

    mcp.callLog.length = 0;
    identity.value = undefined;
    await post([row(5)]);
    expect(posted()?.Summary).toBe(`Player ${counterpartID}`);
  });

  it("uses the first non-empty line of the outcome, converted out of markdown", async () => {
    await post([row(5, { Content: "\n\n## **Peace** at last\n\nAnd the rest of the letter." })]);
    expect(posted()?.Message).toBe("Peace at last");
  });

  it("strips the IPC frame delimiter from both fields", async () => {
    identity.value = { name: "Rome", leader: `Cae${eventPipeDelimiter}sar` };
    await post([row(5, { Content: `Well${eventPipeDelimiter} met.` })]);
    expect(posted()).toMatchObject({ Summary: "Caesar of Rome", Message: "Well met." });
  });

  it("trims both fields to the tool's schema limits", async () => {
    identity.value = { name: "Rome", leader: "L".repeat(summaryLimit + 50) };
    await post([row(5, { Content: "M".repeat(messageLimit + 500) })]);
    const args = posted()!;
    expect((args.Summary as string).length).toBe(summaryLimit);
    expect((args.Message as string).length).toBe(messageLimit);
  });

  it("substitutes a generic body when the outcome carries no visible text", async () => {
    await post([row(5, { MessageType: "close", Content: "   \n  " })]);
    expect(posted()?.Message).toBe(defaultOutcomeMessage);
  });
});

describe("notifyDiplomacyOutcome delivery failures", () => {
  it("reports a transport failure without throwing, leaving the committed action intact", async () => {
    mcp.failWith("post-notification", "bridge disconnected");
    await expect(post([row(5)])).resolves.toBe(false);
  });

  it("treats a Lua-level refusal inside a transport success as a failed post", async () => {
    mcp.respondWith("post-notification", structuredResult({ Success: false, Error: { Code: "NO_DLL", Message: "offline" } }));
    await expect(post([row(5)])).resolves.toBe(false);
  });
});
