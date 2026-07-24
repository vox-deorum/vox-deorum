/**
 * @module envoy/ingame-bridge
 *
 * Transports the in-game diplomacy panel's durable transcript requests and temporary
 * probe actions without coupling the panel to Web chat state.
 */

import type { VoxContext } from "../infra/vox-context.js";
import type { PlayerAssignment } from "../types/api.js";
import { civIdentity } from "../web/chat/enrichment.js";
import { openDiplomacyChat } from "../web/chat/factory.js";
import { isThreadBusy } from "../utils/diplomacy/chat-turn-commit.js";
import { markdownToCiv5 } from "../utils/diplomacy/civ5-markup.js";
import {
  appendTranscriptMessageRow,
  diplomacyThreadId,
  readTranscriptPage,
  type TranscriptPushMessage,
} from "../utils/diplomacy/transcript.js";
import { mcpClient, type GameEventNotification } from "../utils/models/mcp-client.js";
import { unwrapMcpResponse } from "../utils/models/mcp-response.js";
import { createLogger } from "../utils/logger.js";
import type { StrategistParameters } from "../strategist/strategy-parameters.js";

const logger = createLogger("ingame-diplomacy-bridge");
const wireBudget = 30 * 1024;
const truncationNotice = "\n[Message truncated for in-game display.]";
const pipeDelimiter = "!@#$%^!";
const transcriptPageLimit = 100;
const seenEventLimit = 1_000;
const staleTransport = Symbol("stale-transport");

/** Live session lookups that keep this bridge independent from StrategistSession internals. */
export interface IngameBridgeDependencies {
  getCounterpartContext: (playerID: number) => VoxContext<StrategistParameters> | undefined;
  getAssignments: () => Record<number, PlayerAssignment>;
}

/** The validated event shape shared by all in-game diplomacy notifications. */
interface DiplomacyEvent {
  PlayerID: number;
  CounterpartID: number;
  AsObserver?: true;
  Text?: string;
  BeforeID?: number;
}

/** Caller details resolved exactly once at the notification boundary. */
export interface ResolvedCaller {
  callerID: number;
  callerRole: string;
  callerIdentity?: { name: string; leader: string };
  counterpartContext: VoxContext<StrategistParameters>;
}

/** Identifies the game generation a queued transport task is allowed to serve. */
interface TransportGeneration {
  generation: number;
  gameID?: string;
}

/** Append a task behind the prior task for one ordered pair without poisoning the queue on failure. */
function enqueue(
  queue: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<void>,
): void {
  const prior = queue.get(key) ?? Promise.resolve();
  const next = prior.catch((error: unknown) => {
    logger.error("A prior in-game diplomacy task failed", { error, key });
  }).then(task).catch((error: unknown) => {
    logger.error("An in-game diplomacy task failed", { error, key });
  });
  queue.set(key, next);
  const cleanup = (): void => {
    if (queue.get(key) === next) queue.delete(key);
  };
  void next.then(cleanup, cleanup);
}

/** Check a notification payload before it can create a thread or mutate a transcript. */
function parseEvent(data: Record<string, unknown> | undefined): DiplomacyEvent | undefined {
  if (!data) return undefined;
  const playerID = data?.PlayerID;
  const counterpartID = data?.CounterpartID;
  const beforeID = data?.BeforeID;
  if (typeof playerID !== "number" || typeof counterpartID !== "number") return undefined;
  if (!Number.isInteger(playerID) || !Number.isInteger(counterpartID)) return undefined;
  if (data.AsObserver !== undefined && data.AsObserver !== true) return undefined;
  if (data.Text !== undefined && typeof data.Text !== "string") return undefined;
  if (beforeID !== undefined && (typeof beforeID !== "number" || !Number.isInteger(beforeID) || beforeID <= 0)) return undefined;
  return { PlayerID: playerID, CounterpartID: counterpartID, ...data } as DiplomacyEvent;
}

/** Build the ordered-pair key shared by action and push FIFO maps. */
function pairKey(playerID: number, counterpartID: number): string {
  return `${Math.min(playerID, counterpartID)}:${Math.max(playerID, counterpartID)}`;
}

/** Estimate one serialized Lua-call argument payload in UTF-8 wire bytes. */
function wireSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** Fit one projected transcript row within the game transport budget. */
function fitMessageRow(row: Record<string, unknown>, mode: "append" | "prepend"): Record<string, unknown> {
  const batchSize = (candidate: Record<string, unknown>): number =>
    wireSize({ mode, messages: [candidate], hasMore: true });
  const originalSize = batchSize(row);
  if (originalSize <= wireBudget) return row;

  logger.warn("Truncating an oversized diplomacy transcript row for in-game display", {
    messageID: row.ID,
    wireBytes: originalSize,
    wireBudget,
  });

  let candidate = { ...row };
  if (batchSize({ ...candidate, Content: truncationNotice }) > wireBudget && "Payload" in candidate) {
    delete candidate.Payload;
    logger.warn("Omitting an oversized diplomacy transcript payload from the in-game display", {
      messageID: row.ID,
    });
  }

  const content = Array.from(String(candidate.Content ?? ""));
  if (batchSize(candidate) <= wireBudget) return candidate;
  let low = 0;
  let high = content.length;
  let best = { ...candidate, Content: truncationNotice };
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const attempt = {
      ...candidate,
      Content: `${content.slice(0, middle).join("")}${middle < content.length ? truncationNotice : ""}`,
    };
    if (batchSize(attempt) <= wireBudget) {
      best = attempt;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

/** Convert raw durable content only at the game-bound Lua-call edge. */
export function toGameContent(content: string): string {
  // This delimiter must match the named bridge protocol delimiter in mcp-server.
  return markdownToCiv5(content.replaceAll(pipeDelimiter, ""));
}

/** Pack ordered transcript rows into conservative Lua-call batches. */
export function packMessageBatches(messages: TranscriptPushMessage[], mode: "append" | "prepend", hasMore?: boolean): Record<string, unknown>[] {
  const batches: Record<string, unknown>[] = [];
  let rows: Record<string, unknown>[] = [];
  const makeBatch = (batchRows: Record<string, unknown>[], includeMore: boolean): Record<string, unknown> => ({
    mode,
    messages: batchRows,
    ...(includeMore && hasMore !== undefined ? { hasMore } : {}),
  });
  for (const message of messages) {
    const projected: Record<string, unknown> = {
      ID: message.ID,
      SpeakerID: message.SpeakerID,
      MessageType: message.MessageType,
      Content: toGameContent(message.Content),
      Turn: message.Turn,
      ...(message.Payload !== undefined ? { Payload: message.Payload } : {}),
    };
    const row = fitMessageRow(projected, mode);
    if (
      rows.length > 0
      && wireSize({ ...makeBatch([...rows, row], false), hasMore: true }) > wireBudget
    ) {
      batches.push(makeBatch(rows, false));
      rows = [];
    }
    rows.push(row);
  }
  if (rows.length > 0 || mode === "prepend") batches.push(makeBatch(rows, true));
  return batches;
}

/** Owns the independent per-pair action and game-push queues for one strategist session. */
export class IngameBridge {
  private readonly actionQueue = new Map<string, Promise<void>>();
  private readonly pushQueue = new Map<string, Promise<void>>();
  private readonly seenEvents = new Set<string>();
  private readonly seenEventOrder: string[] = [];
  private generation = 0;
  private disposed = false;
  private activeGameID?: string;

  constructor(private readonly dependencies: IngameBridgeDependencies) {}

  /** Invalidate every queued or in-flight task before the session adopts a new game database. */
  resetForGame(gameID: string): void {
    if (this.disposed) return;
    this.invalidate(gameID);
  }

  /** Invalidate every task owned by a session that is shutting down. */
  dispose(): void {
    this.disposed = true;
    this.invalidate(undefined);
  }

  /** Advance the transport generation and clear all per-game queue state. */
  private invalidate(gameID: string | undefined): void {
    this.generation++;
    this.activeGameID = gameID;
    this.actionQueue.clear();
    this.pushQueue.clear();
    this.seenEvents.clear();
    this.seenEventOrder.length = 0;
  }

  /** Dispatch one notification after deduplicating pipe and SSE overlap by its stored event ID. */
  handleNotification(params: GameEventNotification): void {
    if (this.disposed) return;
    if (!this.isSupportedEvent(params.event)) return;
    if (this.isDuplicate(params)) return;
    const event = parseEvent(params.data);
    if (!event) {
      logger.warn("Ignoring malformed in-game diplomacy event", { event: params.event, data: params.data });
      const playerID = params.data?.PlayerID;
      const counterpartID = params.data?.CounterpartID;
      if (
        typeof playerID === "number"
        && Number.isInteger(playerID)
        && typeof counterpartID === "number"
        && Number.isInteger(counterpartID)
      ) {
        void this.enqueueStatus(playerID, counterpartID, "Invalid diplomacy event.", this.captureGeneration());
      }
      return;
    }
    const resolved = this.resolveCaller(event);
    if (!resolved) {
      void this.enqueueStatus(event.PlayerID, event.CounterpartID, "Invalid diplomacy caller.", this.captureGeneration());
      return;
    }
    const guard = this.captureGeneration(resolved);
    if (!this.isCurrent(guard, resolved)) return;
    const key = pairKey(event.PlayerID, event.CounterpartID);
    if (params.event === "DiplomacyPanelOpened") {
      enqueue(this.pushQueue, key, () => this.runIfCurrent(guard, resolved, event, () => this.reflush(event, resolved, guard)));
    } else if (params.event === "DiplomacyTranscriptRequest") {
      enqueue(this.pushQueue, key, () => this.runIfCurrent(guard, resolved, event, () => this.prepend(event, resolved, guard)));
    } else if (params.event === "DiplomacyChatMessage") {
      enqueue(this.actionQueue, key, () => this.runIfCurrent(guard, resolved, event, () => this.appendProbe(event, resolved, guard)));
    } else {
      // TODO(stage-04): Replace this temporary deal-action status with the real handler.
      enqueue(this.actionQueue, key, async () => this.enqueueStatus(event.PlayerID, event.CounterpartID, "Deal actions are not wired yet.", guard));
    }
  }

  /** Resolve trusted caller presentation and require only that the counterpart's context is live. */
  resolveCaller(event: DiplomacyEvent): ResolvedCaller | undefined {
    if (event.PlayerID === event.CounterpartID) return undefined;
    const counterpartContext = this.dependencies.getCounterpartContext(event.CounterpartID);
    if (!counterpartContext) return undefined;
    if (event.AsObserver === true) {
      return { callerID: event.PlayerID, callerRole: "Observer", counterpartContext };
    }
    return {
      callerID: event.PlayerID,
      callerRole: "the leader",
      callerIdentity: civIdentity(counterpartContext, event.PlayerID),
      counterpartContext,
    };
  }

  /** Test whether a notification name belongs to this transport stage. */
  private isSupportedEvent(event: string): boolean {
    return event === "DiplomacyPanelOpened"
      || event === "DiplomacyChatMessage"
      || event === "DiplomacyDealAction"
      || event === "DiplomacyTranscriptRequest";
  }

  /** Deduplicate both valid and malformed routeable notifications with a bounded per-game cache. */
  private isDuplicate(params: GameEventNotification): boolean {
    if (!Number.isInteger(params.latestID)) return false;
    const key = `${this.activeGameID ?? "unbound"}:${params.event}:${params.latestID}`;
    if (this.seenEvents.has(key)) return true;
    this.seenEvents.add(key);
    this.seenEventOrder.push(key);
    if (this.seenEventOrder.length > seenEventLimit) {
      const oldest = this.seenEventOrder.shift();
      if (oldest) this.seenEvents.delete(oldest);
    }
    return false;
  }

  /** Capture the current generation and the caller's game identity at event admission. */
  private captureGeneration(caller?: ResolvedCaller): TransportGeneration {
    return {
      generation: this.generation,
      gameID: caller?.counterpartContext.getBaseParameters()?.gameID ?? this.activeGameID,
    };
  }

  /** Check that a task still belongs to this game generation and a live counterpart context. */
  private isCurrent(guard: TransportGeneration, caller?: ResolvedCaller): boolean {
    if (this.disposed) return false;
    if (guard.generation !== this.generation) return false;
    if (guard.gameID !== undefined && this.activeGameID !== undefined && guard.gameID !== this.activeGameID) return false;
    const contextGameID = caller?.counterpartContext.getBaseParameters()?.gameID;
    return guard.gameID === undefined || contextGameID === undefined || contextGameID === guard.gameID;
  }

  /** Skip stale work at every queue boundary instead of letting it reach the new game's MCP database. */
  private async runIfCurrent(
    guard: TransportGeneration,
    caller: ResolvedCaller | undefined,
    event: DiplomacyEvent,
    task: () => Promise<void>,
  ): Promise<void> {
    if (!this.isCurrent(guard, caller)) return;
    try {
      await task();
    } catch (error) {
      if (this.isCurrent(guard, caller)) {
        const reason = error instanceof Error && error.message
          ? error.message
          : "Unknown transport failure.";
        await this.enqueueStatus(
          event.PlayerID,
          event.CounterpartID,
          `Diplomacy request failed: ${reason}`,
          guard,
        );
      }
      throw error;
    }
  }

  /** Run one asynchronous transport step and reject its result if the generation changed. */
  private async awaitCurrent<T>(
    guard: TransportGeneration,
    caller: ResolvedCaller | undefined,
    step: () => Promise<T>,
  ): Promise<T | typeof staleTransport> {
    if (!this.isCurrent(guard, caller)) return staleTransport;
    const value = await step();
    return this.isCurrent(guard, caller) ? value : staleTransport;
  }

  /** Run an atomic read-only reflush in the push FIFO. */
  private async reflush(event: DiplomacyEvent, caller: ResolvedCaller, guard: TransportGeneration): Promise<void> {
    const page = await this.awaitCurrent(
      guard,
      caller,
      () => readTranscriptPage(event.PlayerID, event.CounterpartID, { limit: transcriptPageLimit }),
    );
    if (page === staleTransport) return;
    const gameID = caller.counterpartContext.getBaseParameters()?.gameID;
    if (!gameID) throw new Error("Counterpart context has no live game ID.");
    const threadID = diplomacyThreadId(gameID, event.PlayerID, event.CounterpartID);
    const hasEnvoy = Boolean(this.dependencies.getAssignments()[event.CounterpartID]?.diplomat);
    const liveTurn = caller.counterpartContext.session?.getTurn()
      ?? caller.counterpartContext.getBaseParameters()?.turn;
    if (typeof liveTurn !== "number") throw new Error("Counterpart context has no live turn.");
    const began = await this.awaitCurrent(guard, caller, () => this.push(
      "VoxDeorumDiploBegin",
      [event.PlayerID, event.CounterpartID, liveTurn, {
        hasEnvoy,
        busy: isThreadBusy(threadID),
        hasMore: page.hasMore,
      }],
      guard,
      caller,
    ));
    if (began === staleTransport || !began) return;
    for (const batch of packMessageBatches(page.messages, "append")) {
      const pushed = await this.awaitCurrent(guard, caller, () => this.push(
        "VoxDeorumDiploMessages",
        [event.PlayerID, event.CounterpartID, batch],
        guard,
        caller,
      ));
      if (pushed === staleTransport || !pushed) return;
    }
  }

  /** Run an atomic older-history page request in the push FIFO. */
  private async prepend(event: DiplomacyEvent, caller: ResolvedCaller, guard: TransportGeneration): Promise<void> {
    const page = await this.awaitCurrent(guard, caller, () => readTranscriptPage(
      event.PlayerID,
      event.CounterpartID,
      {
        beforeID: event.BeforeID,
        limit: transcriptPageLimit,
      },
    ));
    if (page === staleTransport) return;
    const batches = packMessageBatches(page.messages, "prepend");
    const pushOrder = [...batches].reverse();
    for (const [index, originalBatch] of pushOrder.entries()) {
      const batch = index === pushOrder.length - 1
        ? { ...originalBatch, hasMore: page.hasMore }
        : originalBatch;
      const pushed = await this.awaitCurrent(guard, caller, () => this.push(
        "VoxDeorumDiploMessages",
        [event.PlayerID, event.CounterpartID, batch],
        guard,
        caller,
      ));
      if (pushed === staleTransport || !pushed) return;
    }
  }

  /** Append the temporary stage-03 raw-text probe row, then push its committed durable projection. */
  private async appendProbe(event: DiplomacyEvent, caller: ResolvedCaller, guard: TransportGeneration): Promise<void> {
    if (!event.Text) {
      await this.enqueueStatus(event.PlayerID, event.CounterpartID, "A chat message is required.", guard);
      return;
    }
    const thread = await this.awaitCurrent(guard, caller, () => openDiplomacyChat({
        contextId: caller.counterpartContext.id,
        targetPlayerID: event.CounterpartID,
        callerPlayerID: caller.callerID,
        callerRole: caller.callerRole,
        callerIdentity: caller.callerIdentity,
        turn: caller.counterpartContext.session?.getTurn(),
      }));
    if (thread === staleTransport) return;
    const row = await this.awaitCurrent(
      guard,
      caller,
      () => appendTranscriptMessageRow(thread, caller.callerID, event.Text!, guard.gameID),
    );
    if (row === staleTransport) return;
    enqueue(this.pushQueue, pairKey(event.PlayerID, event.CounterpartID), async () => {
      if (!this.isCurrent(guard, caller)) return;
      for (const batch of packMessageBatches([row], "append")) {
        const pushed = await this.awaitCurrent(guard, caller, () => this.push(
          "VoxDeorumDiploMessages",
          [event.PlayerID, event.CounterpartID, batch],
          guard,
          caller,
        ));
        if (pushed === staleTransport || !pushed) return;
      }
    });
  }

  /** Queue a status update through the push FIFO without blocking an action queue worker. */
  private async enqueueStatus(playerID: number, counterpartID: number, detail: string, guard: TransportGeneration): Promise<void> {
    enqueue(this.pushQueue, pairKey(playerID, counterpartID), async () => {
      if (!this.isCurrent(guard)) return;
      await this.push("VoxDeorumDiploStatus", [
      playerID,
      counterpartID,
      { state: "error", detail },
      ], guard);
    });
  }

  /** Call the generic MCP Lua passthrough and preserve its explicit failures for logging. */
  private async push(
    name: string,
    args: unknown[],
    guard: TransportGeneration,
    caller?: ResolvedCaller,
  ): Promise<boolean> {
    if (!this.isCurrent(guard, caller)) return false;
    const result = await mcpClient.callTool("call-lua-function", {
      Name: name,
      Args: args,
      ...(guard.gameID !== undefined ? { ExpectedGameID: guard.gameID } : {}),
    });
    if (!this.isCurrent(guard, caller)) return false;
    const unwrapped = unwrapMcpResponse(result);
    const response = unwrapped.data as {
      success?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    if (response.success !== true) {
      const code = typeof response.error?.code === "string" ? response.error.code : "LUA_CALL_FAILED";
      const message = typeof response.error?.message === "string"
        ? response.error.message
        : unwrapped.text ?? `Lua function ${name} failed`;
      throw new Error(`${code}: ${message}`);
    }
    return true;
  }
}
