/**
 * @module envoy/ingame-bridge
 *
 * Makes the in-game diplomacy panel a second client of the Web conversation backend
 * (interactive-diplomacy stage 7.04 work items 5-7).
 *
 * The panel does not get its own chat engine. A `DiplomacyChatMessage` and a propose/counter
 * `DiplomacyDealAction` both run through the same `runChatTurn` the Web route runs, and accept/reject
 * run through the same shared `acceptDealAction` / `rejectDealAction` the Web routes run; the only
 * thing this module owns is the transport — two independent per-pair FIFOs, a game-shaped
 * `ChatStreamSink`, and the mapping from typed backend failures to `Status{error}`.
 *
 * The two queues are the load-bearing invariant. The **action FIFO** serializes the mutating work for
 * one pair (a turn holds the thread lock for as long as the model runs); the **push FIFO** orders the
 * Lua calls that reach the game. Sink callbacks fire from inside the model run and must never wait on
 * the action FIFO, so they only ever *append* to the push FIFO. An action observes its own pushes at
 * the end by snapshotting the push tail — legal only because the observer is a worker of the *other*
 * queue (see {@link enqueue}).
 */

import type { VoxContext } from "../../../infra/vox-context.js";
import type { PlayerAssignment } from "../../../types/api.js";
import type {
  ChatConnectedEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessageEvent,
  ChatStreamSink,
  EnvoyThread,
} from "../../../types/index.js";
import { civIdentity } from "../../../web/chat/enrichment.js";
import { openDiplomacyChat } from "../../../web/chat/factory.js";
import { runChatTurn } from "../../../web/chat/turn.js";
import {
  isThreadBusy,
  ThreadBusyError,
  threadBusyMessage,
} from "../turn/chat-turn-commit.js";
import { markdownToCiv5 } from "./civ5-markup.js";
import {
  acceptDealAction,
  NotDiplomacyThreadError,
  rejectDealAction,
} from "../deal/deal-actions.js";
import { IllegalDealError, ProposalConflictError, readActiveProposal } from "../deal/deal.js";
import {
  ConversationClosedThisTurnError,
  LiveTurnUnavailableError,
} from "../turn/live-turn.js";
import { notifyDiplomacyOutcome } from "./notify.js";
import { sendMessageToolName } from "../constants.js";
import {
  diplomacyThreadId,
  readTranscriptPage,
  type TranscriptPushMessage,
} from "../transcript/transcript.js";
import { mcpClient, type GameEventNotification } from "../../models/mcp-client.js";
import { unwrapMcpResponse } from "../../models/mcp-response.js";
import { createLogger } from "../../logger.js";
import { isRecord } from "../../guards.js";
import type { StrategistParameters } from "../../../strategist/strategy-parameters.js";
import { eventPipeDelimiter } from "../../../../../mcp-server/dist/bridge/protocol.js";

const logger = createLogger("ingame-diplomacy-bridge");
const wireBudget = 30 * 1024;
const truncationNotice = "\n[Message truncated for in-game display.]";
const transcriptPageLimit = 100;
const seenEventLimit = 1_000;
/** Seats above this are not addressable by the game (Civ 5 MAX_PLAYERS). */
const maxGameSeats = 64;
const staleTransport = Symbol("stale-transport");
/**
 * How long one game-bound Lua call may stay pending before the bridge reports a suspected
 * stall. The game drains this queue itself, so a game that stops draining it returns no
 * error at all — the call simply never completes. Warning while it is still outstanding is
 * the only way that failure names itself in a log rather than appearing as a bare timeout.
 */
const pushStallWarningMs = 10_000;
/** Shown when a counterpart has no live agent context, so the pair has no envoy to answer. */
const noEnvoyDetail = "This leader has no envoy in this session.";

/** The canonical deal transitions the panel may request; retract is sent as `reject`. */
const dealActions = ["propose", "counter", "accept", "reject"] as const;

/** One requested deal transition, as the game-side driver spells it. */
type DealAction = (typeof dealActions)[number];

/**
 * `runChatTurn`'s progress channel: it emits its own status narration as a `text-delta` under this
 * sentinel id. That text is NOT model output and must never be spoken into the game.
 */
const progressChunkID = "progress";

/** Chunk types that mean "the model is thinking". Their content never crosses into the game. */
const reasoningChunkTypes = new Set([
  "reasoning",
  "reasoning-start",
  "reasoning-delta",
  "reasoning-end",
]);

/** Chunk types that mean "the model is using a tool". Their content never crosses into the game. */
const toolChunkTypes = new Set([
  "tool-input-start",
  "tool-input-delta",
  "tool-call",
  "tool-result",
  "tool-error",
]);

/** Minimum spacing between accumulated-draft pushes (specs: `VoxDeorumDiploDelta`, ~1/s). */
const deltaIntervalMs = 1_000;

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
  Action?: DealAction;
  Deal?: Record<string, unknown>;
  ProposalMessageID?: number;
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

/**
 * Append a task behind the prior task for one ordered pair without poisoning the queue on failure.
 *
 * @returns the queue's new tail for `key`. Awaiting it observes every task queued on that key so far,
 *          and it never rejects (both failure paths are caught and logged).
 *
 * **Never await a queue's tail from inside one of that queue's own workers.** A worker is itself part
 * of the tail, so it would be waiting for itself to finish: a deadlock, not a slow call. The bridge
 * observes only the *push* tail, and only from an action-FIFO worker — a member of the other queue,
 * which no push task ever waits on. That asymmetry is the whole reason the two FIFOs are separate.
 */
function enqueue(
  queue: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<void>,
): Promise<void> {
  const prior = queue.get(key) ?? Promise.resolve();
  // The first catch converts a rejected prior task into a resolved value so this task
  // still runs; removing it would let one failure poison every later task on this key.
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
  return next;
}

/**
 * Snapshot an ordered queue's current tail for `key` without appending to it, so a non-member can
 * await exactly the work queued up to this moment. An idle key has no tail, which is already
 * "everything queued so far has finished". Same non-self-await rule as {@link enqueue}.
 */
function queueTail(queue: Map<string, Promise<void>>, key: string): Promise<void> {
  return queue.get(key) ?? Promise.resolve();
}

/** Whether a value is a durable transcript row ID as the game may reference one. */
function isRowID(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Check a notification payload before it can create a thread or mutate a transcript.
 *
 * Every optional field is type-checked whether or not this event kind uses it, so one malformed
 * member rejects the whole event rather than being silently dropped on the way to a Lua call. A
 * `DiplomacyDealAction` additionally has to satisfy the per-action field requirements, mirroring the
 * `superRefine` on the mcp-server event schema: propose and counter carry a `Deal`, and everything
 * except propose references a `ProposalMessageID`.
 */
function parseEvent(
  eventName: string,
  data: Record<string, unknown> | undefined,
): DiplomacyEvent | undefined {
  if (!data) return undefined;
  const playerID = data?.PlayerID;
  const counterpartID = data?.CounterpartID;
  const beforeID = data?.BeforeID;
  if (typeof playerID !== "number" || typeof counterpartID !== "number") return undefined;
  if (!Number.isInteger(playerID) || !Number.isInteger(counterpartID)) return undefined;
  if (data.AsObserver !== undefined && data.AsObserver !== true) return undefined;
  if (data.Text !== undefined && typeof data.Text !== "string") return undefined;
  if (beforeID !== undefined && (typeof beforeID !== "number" || !Number.isInteger(beforeID) || beforeID <= 0)) return undefined;
  if (data.Action !== undefined && !(dealActions as readonly unknown[]).includes(data.Action)) return undefined;
  if (data.Deal !== undefined && !isRecord(data.Deal)) return undefined;
  if (data.ProposalMessageID !== undefined && !isRowID(data.ProposalMessageID)) return undefined;
  if (eventName === "DiplomacyDealAction") {
    const action = data.Action as DealAction | undefined;
    if (action === undefined) return undefined;
    if ((action === "propose" || action === "counter") && data.Deal === undefined) return undefined;
    if (action !== "propose" && data.ProposalMessageID === undefined) return undefined;
  }
  return { PlayerID: playerID, CounterpartID: counterpartID, ...data } as DiplomacyEvent;
}

/**
 * The single bridge mapper from a typed backend failure to the panel's `Status{error}` detail, or
 * undefined for anything untyped (which stays an unexpected transport failure and takes the generic
 * path in {@link IngameBridge.runIfCurrent}). It is the game-side counterpart of the Web mapper's
 * HTTP status classes, and it exists for the same reason: neither transport should classify a failure
 * by inspecting message text.
 */
function bridgeActionDetail(error: unknown): string | undefined {
  if (error instanceof ThreadBusyError) return threadBusyMessage;
  if (
    error instanceof NotDiplomacyThreadError
    || error instanceof LiveTurnUnavailableError
    || error instanceof ConversationClosedThisTurnError
    || error instanceof ProposalConflictError
    || error instanceof IllegalDealError
  ) {
    return error.message;
  }
  return undefined;
}

/** Build the ordered-pair key shared by action and push FIFO maps. */
function pairKey(playerID: number, counterpartID: number): string {
  return `${Math.min(playerID, counterpartID)}:${Math.max(playerID, counterpartID)}`;
}

/** Whether a value is a seat index the game-side panel transport can address. */
function isAddressableSeat(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < maxGameSeats;
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

  const candidate = { ...row };
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
  return markdownToCiv5(content.replaceAll(eventPipeDelimiter, ""));
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

/** The generic agent-activity states the panel renders (specs: `VoxDeorumDiploStatus`). */
export type GameStatusState = "composing" | "reasoning" | "tool" | "idle" | "error";

/**
 * The push-side seam a {@link IngameChatSink} is given: append-only access to one pair's push FIFO,
 * plus the ability to observe its tail. Deliberately narrow — the sink can enqueue Lua work and wait
 * for what it enqueued, and it can do nothing else. In particular it holds no reference to the action
 * FIFO, so a sink callback cannot wait on the turn that is currently running it.
 */
export interface GameSinkPort {
  /** Queue the durable rows of an outcome as an ordinary `Messages{append}` increment. */
  queueRows(rows: TranscriptPushMessage[]): void;
  /** Queue one generic activity status. Reasoning and tool *content* never crosses this boundary. */
  queueStatus(state: GameStatusState, detail?: string): void;
  /** Queue the accumulated spoken draft so far (cumulative and idempotent). */
  queueDelta(text: string): void;
  /** Await the push work queued so far. Called only from an action-FIFO worker. */
  settle(): Promise<void>;
}

/**
 * The in-game `ChatStreamSink`: the game-facing counterpart of the Web's SSE adapter.
 *
 * Two rules shape it.
 *
 * **Nothing blocks.** Every callback runs inside the model run, on the action FIFO's worker. They
 * append to the push FIFO and return; none of them awaits anything. An action collects its pushes
 * afterwards with {@link settle}.
 *
 * **The chunk stream is an allowlist, not a passthrough.** The Web client can afford to render
 * whatever arrives, because a browser tab showing a tool call is a feature there. The game panel
 * cannot: reasoning traces and tool arguments are the diplomat's private deliberation, and the
 * `progress` sentinel is `runChatTurn`'s own narration, not the counterpart speaking. So recognized
 * reasoning/tool chunks collapse to a bare state with no content, the progress sentinel becomes a
 * generic composing status, and an unrecognized chunk is dropped outright. Only ordinary `text-delta`
 * content is treated as spoken text — and even that is a temporary draft, replaced when the durable
 * final reply arrives in `done.rows`.
 */
export class IngameChatSink implements ChatStreamSink {
  /** The durable caller row committed before the model ran (`connected.rows`). */
  readonly connectedRows: TranscriptPushMessage[] = [];
  /** The turn's terminal-only row snapshot (`done.rows` or `error.rows`). */
  readonly terminalRows: TranscriptPushMessage[] = [];
  /** Which terminal event arrived, or undefined when the turn has not reported one. */
  terminal?: "done" | "error";
  /** The failure text of a post-commit failure, for callers that want to report it. */
  failure?: string;

  private spoken = "";
  private pushedLength = 0;
  private lastDeltaAt = 0;
  private lastState?: GameStatusState;

  constructor(
    private readonly port: GameSinkPort,
    private readonly now: () => number = Date.now,
  ) {}

  /** The committed caller row is durable the moment the turn connects, so push it immediately. */
  connected(data: ChatConnectedEvent): void {
    this.retain(this.connectedRows, data.rows);
  }

  /** Map one stream chunk through the allowlist. Anything not listed is dropped. */
  message(chunk: ChatMessageEvent): void {
    if (chunk.type === "text-delta") {
      // The progress sentinel is the turn's own narration ("Fetching episodes for turn 42..."),
      // multiplexed onto the text channel. It is a status, never a spoken line.
      if (chunk.id === progressChunkID) {
        this.flushSpoken();
        this.status("composing");
        return;
      }
      const text = typeof chunk.text === "string" ? chunk.text : "";
      if (text === "") return;
      this.spoken += text;
      // Speaking ends the previous activity, so a later tool or reasoning chunk is worth announcing
      // again rather than being suppressed as a repeat of a state that has since been superseded.
      this.lastState = undefined;
      const now = this.now();
      if (now - this.lastDeltaAt < deltaIntervalMs) return;
      this.pushedLength = this.spoken.length;
      this.lastDeltaAt = now;
      this.port.queueDelta(this.spoken);
      return;
    }
    if (reasoningChunkTypes.has(chunk.type)) {
      this.flushSpoken();
      this.status("reasoning");
      return;
    }
    if (toolChunkTypes.has(chunk.type)) {
      this.flushSpoken();
      // A `send-message` chunk is the spoken reply in tool clothing; the streamer already converted
      // it to text-deltas, so re-announcing it as tool activity would be wrong twice over.
      if (chunk.toolName === sendMessageToolName) return;
      this.status("tool");
      return;
    }
  }

  /** Push the terminal rows; the durable final reply supersedes whatever draft was streamed. */
  done(data: ChatDoneEvent): void {
    if (this.terminal) return;
    this.terminal = "done";
    this.retain(this.terminalRows, data.rows);
  }

  /**
   * Push whatever the failed turn did commit, then report the failure. An append-only store cannot
   * unwrite those rows, so the panel is told about them even though the turn failed.
   */
  error(data: ChatErrorEvent): void {
    if (this.terminal) return;
    this.terminal = "error";
    this.failure = data.message;
    this.retain(this.terminalRows, data.rows);
    this.port.queueStatus("error", data.message);
  }

  /**
   * No-op by design. The Web sink cancels its run when the browser socket closes; the game has no
   * socket, and a run must not become cancellable through a channel the player never opened.
   */
  onDisconnect(): void {}

  /** Await the pushes this sink queued, without ever touching the action FIFO. */
  settle(): Promise<void> {
    return this.port.settle();
  }

  /** Retain a durable row set as this action's outcome and queue it for the panel. */
  private retain(into: TranscriptPushMessage[], rows: TranscriptPushMessage[]): void {
    if (rows.length === 0) return;
    into.push(...rows);
    this.port.queueRows(rows);
  }

  /** Push any spoken tail that the regular delta throttle has not emitted yet. */
  private flushSpoken(): void {
    if (this.spoken.length === this.pushedLength) return;
    this.pushedLength = this.spoken.length;
    this.lastDeltaAt = this.now();
    this.port.queueDelta(this.spoken);
  }

  /** Queue one generic status, collapsing an unbroken run of the same state into a single push. */
  private status(state: GameStatusState): void {
    if (this.lastState === state) return;
    this.lastState = state;
    this.port.queueStatus(state);
  }
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

  /**
   * Forget every seen event ID because the DLL (re)connected.
   *
   * Stored event IDs are `turn * 1e6 + sequence`, and the DLL restores the sequence counter from
   * the save file — so reloading a save re-issues IDs the previous run of the same game already
   * consumed. Only a *changed* gameID triggers {@link resetForGame}; a crash-recovery relaunch or a
   * manual reload of the same game keeps the cache, and the first post-reload diplomacy event would
   * be swallowed as a pipe/SSE duplicate. The session calls this on `DLLConnected` instead: the
   * dedup cache is the one thing that must not outlive a game process, while the queues and the
   * generation stay valid (pending game-bound calls already fail fast on a dead DLL).
   */
  resetEventDedup(): void {
    if (this.disposed) return;
    if (this.seenEvents.size === 0) return;
    logger.info("Clearing the in-game diplomacy event dedup cache for a DLL reconnect", {
      forgottenEvents: this.seenEvents.size,
      gameID: this.activeGameID,
    });
    this.seenEvents.clear();
    this.seenEventOrder.length = 0;
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
    const event = parseEvent(params.event, params.data);
    if (!event) {
      logger.warn("Ignoring malformed in-game diplomacy event", { event: params.event, data: params.data });
      const playerID = params.data?.PlayerID;
      const counterpartID = params.data?.CounterpartID;
      // Only report back to seats the game can actually address; otherwise a
      // malformed payload would still produce a live Lua call for arbitrary IDs.
      if (isAddressableSeat(playerID) && isAddressableSeat(counterpartID)) {
        void this.enqueueStatus(playerID, counterpartID, "Invalid diplomacy event.", this.captureGeneration());
      }
      return;
    }
    const resolved = this.resolveCaller(event);
    if (!resolved) {
      // Two very different refusals share this path, and conflating them made a live
      // session unreadable: a self-addressed pair is a genuinely malformed caller, while
      // a counterpart with no live context is an ordinary civilization this session
      // simply assigns no envoy. Name both in the log — this drop was previously silent,
      // so the bridge looked dead — and tell the player the truthful one on screen.
      const selfAddressed = event.PlayerID === event.CounterpartID;
      logger.warn("Refusing an in-game diplomacy event", {
        event: params.event,
        playerID: event.PlayerID,
        counterpartID: event.CounterpartID,
        reason: selfAddressed ? "self-addressed-pair" : "counterpart-context-missing",
      });
      if (isAddressableSeat(event.PlayerID) && isAddressableSeat(event.CounterpartID)) {
        void this.enqueueStatus(
          event.PlayerID,
          event.CounterpartID,
          selfAddressed ? "Invalid diplomacy caller." : noEnvoyDetail,
          this.captureGeneration(),
        );
      }
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
      enqueue(this.actionQueue, key, () => this.runIfCurrent(guard, resolved, event, () => this.runChat(event, resolved, guard)));
    } else {
      enqueue(this.actionQueue, key, () => this.runIfCurrent(guard, resolved, event, () => this.runDealAction(event, resolved, guard)));
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
    if (this.seenEvents.has(key)) {
      // Named because a dropped event produces no other trace: a request the game keeps waiting
      // on would otherwise look like a bridge that simply never answered.
      logger.info("Dropping a duplicate in-game diplomacy event", {
        event: params.event,
        latestID: params.latestID,
      });
      return true;
    }
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

  /**
   * Build the append-only push seam for one pair, bound to this event's generation guard.
   *
   * Every queued task re-checks the guard before it touches the game: an action can still be running
   * (and its sink still enqueueing) when the session switches game databases, and a push that lands
   * after that would write a dead conversation's rows into a live one.
   */
  private sinkPort(event: DiplomacyEvent, caller: ResolvedCaller, guard: TransportGeneration): GameSinkPort {
    const key = pairKey(event.PlayerID, event.CounterpartID);
    /** Append one guarded task to this pair's push FIFO, never waiting for it here. */
    const queue = (task: () => Promise<void>): void => {
      enqueue(this.pushQueue, key, async () => {
        if (!this.isCurrent(guard, caller)) return;
        await task();
      });
    };
    return {
      queueRows: (rows) => queue(async () => {
        // A concurrent reflush can read a just-committed row before this dedicated push lands,
        // sending the same message ID twice. The panel deduplicates rows by ID (m_rowByID in
        // VoxDeorumDiploPanel.lua); that client-side dedup is part of the transport contract.
        for (const batch of packMessageBatches(rows, "append")) {
          const pushed = await this.awaitCurrent(guard, caller, () => this.push(
            "VoxDeorumDiploMessages",
            [event.PlayerID, event.CounterpartID, batch],
            guard,
            caller,
          ));
          if (pushed === staleTransport || !pushed) return;
        }
      }),
      queueStatus: (state, detail) => queue(async () => {
        await this.push(
          "VoxDeorumDiploStatus",
          [event.PlayerID, event.CounterpartID, detail === undefined ? { state } : { state, detail }],
          guard,
          caller,
        );
      }),
      queueDelta: (text) => queue(async () => {
        await this.push(
          "VoxDeorumDiploDelta",
          [event.PlayerID, event.CounterpartID, toGameContent(text)],
          guard,
          caller,
        );
      }),
      // Legal because only an action-FIFO worker calls this: see `enqueue`'s non-self-await rule.
      settle: () => queueTail(this.pushQueue, key),
    };
  }

  /**
   * Open the deterministic pair thread for a mutating action.
   *
   * `callerPlayerID` is always the event's own seat: `resolveHumanSeat` cannot infer one in an
   * observer or autoplay session, so letting the factory default would bind the conversation to the
   * wrong endpoint (or fail outright). A pure observer additionally suppresses its caller identity and
   * presents as `Observer`, which `resolveCaller` has already decided.
   */
  private openPair(event: DiplomacyEvent, caller: ResolvedCaller): Promise<EnvoyThread> {
    return openDiplomacyChat({
      contextId: caller.counterpartContext.id,
      targetPlayerID: event.CounterpartID,
      callerPlayerID: caller.callerID,
      callerRole: caller.callerRole,
      callerIdentity: caller.callerIdentity,
      turn: caller.counterpartContext.session?.getTurn(),
    });
  }

  /** Run one human chat message through the same turn engine the Web route runs. */
  private async runChat(event: DiplomacyEvent, caller: ResolvedCaller, guard: TransportGeneration): Promise<void> {
    // Checked before opening the pair so a junk event cannot create a thread. `runChatTurn` would
    // reject it too, but only after the factory had already run.
    if (!event.Text || event.Text.trim() === "") {
      await this.enqueueStatus(event.PlayerID, event.CounterpartID, "A chat message is required.", guard);
      return;
    }
    const thread = await this.awaitCurrent(guard, caller, () => this.openPair(event, caller));
    if (thread === staleTransport) return;
    await this.runTurn(event, caller, guard, {
      kind: "text",
      chatId: thread.id,
      message: event.Text,
    });
  }

  /**
   * Run one deal transition.
   *
   * The pair is opened first, unconditionally: `DiplomacyPanelOpened` is read-only and deliberately
   * does not populate the thread cache, so a player who opens the native deal screen and proposes
   * without ever sending a message reaches here with no `EnvoyThread` in existence.
   *
   * Propose and counter are ordinary chat turns whose commit happens to be a deal, so they take the
   * streaming path. Accept and reject are direct transactional actions with no model run, so they
   * return their durable rows immediately. Retract has no wire form: the driver sends it as `reject`,
   * and the backend already permits an author to reject their own offer.
   *
   * The panel's Propose is pressed blind — unlike the Web editor it never carries the ID of the offer
   * the player saw. So the open offer is derived here instead of rejecting: proposing while an offer
   * is on the table (either side's, the player's own included) submits a counter superseding it,
   * which is `classifyDealSubmission`'s own rule. The classifier still re-checks under the turn lock,
   * so an offer that changes identity between this read and the commit 409s as before.
   */
  private async runDealAction(event: DiplomacyEvent, caller: ResolvedCaller, guard: TransportGeneration): Promise<void> {
    const thread = await this.awaitCurrent(guard, caller, () => this.openPair(event, caller));
    if (thread === staleTransport) return;
    try {
      if (event.Action === "propose" || event.Action === "counter") {
        const expectedProposalID = event.Action === "counter"
          ? event.ProposalMessageID
          : await this.openProposalID(thread);
        await this.runTurn(event, caller, guard, {
          kind: "deal",
          chatId: thread.id,
          deal: event.Deal,
          ...(expectedProposalID !== undefined ? { expectedProposalID } : {}),
        });
        return;
      }
      // The parser guarantees a proposal reference for every action but propose.
      const proposalMessageID = event.ProposalMessageID!;
      const result = event.Action === "accept"
        ? await acceptDealAction(thread, proposalMessageID)
        : await rejectDealAction(thread, proposalMessageID, event.Text);
      // Pushed even when `changed` is false: an idempotent rejection re-delivers its existing row so
      // the panel (which dedupes by ID) drops it while the deal screen's resolver still sees the
      // acknowledgement it needs to release the mounted editor.
      const port = this.sinkPort(event, caller, guard);
      port.queueRows(result.rows);
      // A direct transactional action never runs the sink, so it is the one that must queue its own
      // terminal status: see the invariant documented on `runTurn`.
      port.queueStatus("idle");
      await port.settle();
      await this.notifyOutcome(event, caller, guard, result.rows, result.changed);
    } catch (error) {
      const detail = bridgeActionDetail(error);
      // Untyped failures are genuinely unexpected, so they keep the generic transport-failure path.
      if (detail === undefined) throw error;
      await this.enqueueStatus(event.PlayerID, event.CounterpartID, detail, guard);
    }
  }

  /** The ID of the pair's currently open offer (either side's), or undefined when none is open. */
  private async openProposalID(thread: EnvoyThread): Promise<number | undefined> {
    const reduction = await readActiveProposal(thread.player1ID, thread.player2ID);
    return reduction.status === "open" ? reduction.active?.ID : undefined;
  }

  /**
   * Drive one `runChatTurn` through the game sink and settle its pushes.
   *
   * A returned rejection is always pre-stream — nothing committed, nothing streamed — so it becomes a
   * plain `Status{error}`. Once the turn connects, every outcome (including a post-commit failure)
   * arrives through the sink instead, which is why there is no second error path here.
   *
   * Every action the panel drives ends with exactly one terminal status — `idle` on a genuine outcome,
   * `error` otherwise — so the panel is never left showing a stale "composing"/"reasoning"/"tool" state
   * once the turn has actually finished. The sink's own `error()` already queues its `Status{error}` for
   * a failed turn, so this only has to cover what the sink cannot: `done` with rows is the one genuine
   * outcome and gets `idle`; everything else collapses to the same `error` — a `done` with zero rows (a
   * terminal tool was called, so no retry line was archived, but it persisted nothing, e.g. every
   * candidate deal failed validation) or no terminal event at all (the turn returned without the sink
   * ever recording `done`/`error`).
   */
  private async runTurn(
    event: DiplomacyEvent,
    caller: ResolvedCaller,
    guard: TransportGeneration,
    body: Record<string, unknown>,
  ): Promise<void> {
    const port = this.sinkPort(event, caller, guard);
    const sink = new IngameChatSink(port);
    const rejection = await runChatTurn(body, sink);
    if (rejection) {
      await this.enqueueStatus(event.PlayerID, event.CounterpartID, rejection.error, guard);
      return;
    }
    await sink.settle();
    if (sink.terminal === "error") return;
    if (sink.terminal === "done" && sink.terminalRows.length > 0) {
      port.queueStatus("idle");
      await port.settle();
      await this.notifyOutcome(event, caller, guard, sink.terminalRows);
      return;
    }
    port.queueStatus("error", "The envoy could not settle on a response. Please try again.");
    await port.settle();
  }

  /**
   * Offer a completed action's durable rows to the notification channel.
   *
   * Best-effort by contract (decision 5): the helper decides eligibility and swallows its own posting
   * failures, so an already-committed conversation action can never be reported to the player as a
   * failure because an announcement did not land.
   */
  private async notifyOutcome(
    event: DiplomacyEvent,
    caller: ResolvedCaller,
    guard: TransportGeneration,
    rows: TranscriptPushMessage[],
    changed?: boolean,
  ): Promise<void> {
    if (!this.isCurrent(guard, caller)) return;
    await notifyDiplomacyOutcome({
      playerID: event.PlayerID,
      counterpartID: event.CounterpartID,
      counterpartContext: caller.counterpartContext,
      rows,
      changed,
    });
  }

  /** Queue a status update through the push FIFO without blocking an action queue worker. */
  private async enqueueStatus(playerID: number, counterpartID: number, detail: string, guard: TransportGeneration): Promise<void> {
    enqueue(this.pushQueue, pairKey(playerID, counterpartID), async () => {
      // Deliberately checked without a caller: by the time a status is reported the
      // counterpart context may itself be the stale/missing thing, so status pushes
      // rely only on the generation and the captured game identity.
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
    // A game-bound Lua call is only drained when the game itself services the bridge's
    // queue, and a game that stops servicing it produces no error at all — the call just
    // never returns, and the panel silently reaches its transport-acknowledgement timeout
    // with nothing in any log to explain it. Report a suspected stall while the call is
    // still pending, so the next live session names the stall instead of leaving a gap.
    // Unref'd: this watchdog must never hold the process open on its own.
    const startedAt = Date.now();
    const stallWarning = setTimeout(() => {
      logger.warn("A game-bound diplomacy Lua call has not returned; the game may not be draining its Lua queue", {
        name,
        pendingMs: pushStallWarningMs,
        gameID: guard.gameID,
      });
    }, pushStallWarningMs);
    stallWarning.unref?.();
    let result: unknown;
    try {
      result = await mcpClient.callTool("call-lua-function", {
        Name: name,
        Args: args,
        ...(guard.gameID !== undefined ? { ExpectedGameID: guard.gameID } : {}),
      });
    } finally {
      clearTimeout(stallWarning);
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= pushStallWarningMs) {
      logger.warn("A game-bound diplomacy Lua call returned only after a long delay", { name, elapsedMs });
    } else {
      logger.info("Completed a game-bound diplomacy Lua call", { name, elapsedMs });
    }
    if (!this.isCurrent(guard, caller)) return false;
    // Tool-level failures throw inside unwrapMcpResponse; this check covers the
    // separate Lua-level failure reported inside a transport-level success.
    const response = unwrapMcpResponse(result, `call-lua-function ${name}`) as {
      success?: unknown;
      error?: { code?: unknown; message?: unknown };
    };
    if (response.success !== true) {
      const code = typeof response.error?.code === "string" ? response.error.code : "LUA_CALL_FAILED";
      const message = typeof response.error?.message === "string"
        ? response.error.message
        : `Lua function ${name} failed`;
      throw new Error(`${code}: ${message}`);
    }
    return true;
  }
}
