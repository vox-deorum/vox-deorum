/**
 * Composable for managing thread messages
 * Handles message operations and streaming logic for chat threads
 */

import type { Ref } from 'vue';
import type { EnvoyThread, ChatMessageRequest, MessageWithMetadata, DealPayload, DealTranscriptMessage } from '@/utils/types';
import type { LanguageModelV3TextPart, LanguageModelV3ReasoningPart, LanguageModelV3ToolCallPart, LanguageModelV3ToolResultPart } from '@ai-sdk/provider';
import { api, type SendCommitState } from '@/api/client';
import type { ModelMessage } from 'ai';
// Pure transcript helper (shared with the backend via @vox) — hydrate the server's committed deal row
// (arriving on the `connected` SSE event) into a cache item exactly as a full re-hydrate would.
import { hydrateDealRow } from '@vox/utils/diplomacy/transcript-utils';

export interface UseThreadMessagesOptions {
  thread: Ref<EnvoyThread | null>;
  sessionId: Ref<string>;
  isStreaming: Ref<boolean>;
  /**
   * The authoritative current game turn (the server's chat-response enrichment, kept fresh by the
   * host). Used to stamp optimistic/streamed rows so they carry the same turn marker hydrated rows
   * get from the store — `thread.metadata.turn` is only the turn at open time and goes stale.
   */
  currentTurn?: Ref<number | undefined>;
  onNewChunk?: () => void;
  /**
   * A user-sent message could not be delivered. `commit` says whether retrying is safe: 'uncommitted'
   * (a pre-stream rejection — the live turn wasn't available, the conversation was closed this turn,
   * etc.) means nothing was written and the optimistic rows were fully removed, so the host returns the
   * text to the input box for a clean retry; 'committed' means the stream had opened and the message may
   * be on the record, so only the unfinished reply was removed and the message stays on screen — the
   * host surfaces the error WITHOUT restoring the input, since resending could duplicate it.
   */
  onSendFailed?: (text: string, error: string, commit: SendCommitState) => void;
  /**
   * A greeting request ({{{Greeting}}}) failed. A greeting has no user text to restore, so the host
   * just surfaces why it bounced; the server drops the failed trigger so a reload can re-greet.
   */
  onGreetingFailed?: (error: string) => void;
  /**
   * A deal proposal/counter could not be committed or its streamed reply failed. `commit` follows the
   * same contract as `onSendFailed`: 'uncommitted' (pre-stream rejection — illegal/uninspectable deal,
   * busy thread, close-lock) means nothing was stored and `connected` never fired, so the dialog is
   * still open (the host just surfaces why); 'committed' means the proposal was durably stored (its
   * authoritative card is already inline) but the diplomat's reply failed, so the card stays.
   */
  onDealFailed?: (error: string, commit: SendCommitState) => void;
}

export function useThreadMessages(options: UseThreadMessagesOptions) {
  const { thread, sessionId, isStreaming, currentTurn, onNewChunk, onSendFailed, onGreetingFailed, onDealFailed } = options;

  /** Trim the thread's messages back to `length`, no-op if the thread went away mid-stream. */
  const rollbackTo = (length: number) => thread.value?.messages.splice(length);

  /** The turn to stamp on new rows: the live enrichment turn, falling back to the open-time turn. */
  const turnNow = () => currentTurn?.value ?? thread.value?.metadata?.turn ?? 0;

  /**
   * Append the authoritative deal rows the local thread is missing (by ID) onto the end, leaving every
   * existing row — and its streamed reasoning/tool traces — untouched. The surgical, refresh-free way to
   * fold in deal rows the SSE text stream didn't carry: the diplomat's mid-run outcomes (sent on `done`)
   * and a committed proposal whose `connected` card was lost to a drop (re-read from the store).
   */
  const mergeDealRows = (rows: DealTranscriptMessage[]) => {
    if (!thread.value || rows.length === 0) return;
    const present = new Set(thread.value.messages.flatMap((m) => (m.deal ? [m.deal.ID] : [])));
    for (const row of rows) {
      if (!present.has(row.ID)) thread.value.messages.push(hydrateDealRow(row, thread.value.agent));
    }
  };

  /** Re-read the conversation's deal rows from the store and fold in any the local thread is missing. */
  const reconcileDeals = async () => {
    if (!thread.value) return;
    try {
      const { messages } = await api.getDealMessages(sessionId.value);
      mergeDealRows(messages);
    } catch (error) {
      console.error('Failed to reconcile deals after a committed deal drop:', error);
    }
  };

  /**
   * Streams an agent response: pushes the assistant placeholder, then on the `connected` event (which
   * the server sends post-commit, before the reply) inserts a deal turn's authoritative committed row
   * just BEFORE that placeholder and fires `onConnected` (the host closes the deal dialog there).
   * `optimisticStart` is the thread length captured before the caller's optimistic row(s); on a failure
   * before `done`, a RECOVERABLE error (the send never took effect) rolls every optimistic row back to
   * `optimisticStart`; an unrecoverable one (the stream had opened, so the move may be committed) rolls
   * back only the unfinished assistant row — keeping the committed user message / authoritative deal row.
   */
  const streamResponse = (
    request: ChatMessageRequest,
    optimisticStart: number,
    onFailure?: (error: string, commit: SendCommitState) => void,
    onConnected?: () => void,
  ): (() => void) | undefined => {
    if (!thread.value) return;

    // Prepare for assistant response with array content for multi-part support. Its index is the
    // rollback point for an unrecoverable failure (keep the caller's message, drop the partial reply).
    // It's a `let` because a deal turn splices its committed row in just before this on `connected`,
    // bumping the placeholder one slot down (so the 'committed' rollback keeps the deal row).
    const assistantMessage: ModelMessage = { role: "assistant", content: [] };
    thread.value.messages.push({
      message: assistantMessage,
      metadata: {
        datetime: new Date(),
        turn: turnNow()
      }
    });
    let assistantStart = thread.value.messages.length - 1;
    const contents = thread.value.messages[assistantStart]!.message.content as Array<
      LanguageModelV3TextPart | LanguageModelV3ReasoningPart | LanguageModelV3ToolCallPart | LanguageModelV3ToolResultPart
    >;

    // The terminal 'done' commits the exchange server-side; a trailing error after it must not undo it.
    let done = false;
    // Whether the authoritative committed deal row arrived on `connected`. A deal turn that commits but
    // then drops BEFORE delivering it (the `connected` event was lost) is still 'committed', yet leaves
    // no card and the dialog open — `onError` uses this to reconcile the missing row from the store.
    let dealRowReceived = false;

    // Streaming text/reasoning parts are mutated in place as deltas arrive. `thread` is a deep `ref`,
    // so `contents` is a reactive array: `contents.push(obj)` stores the RAW object, but the view reads
    // it back through a reactive proxy. We must re-read the just-pushed element (`contents[len-1]`) and
    // mutate THAT proxy — mutating the local raw object would bypass the proxy's set-trap and never
    // trigger a re-render, freezing the display at the first delta.
    let currentText: LanguageModelV3TextPart | null = null;
    let currentTextID: string = "";
    let currentReasoning: LanguageModelV3ReasoningPart | null = null;
    let currentReasoningID: string = "";

    return api.streamAgentMessage(
      request,
      (part) => {
        switch (part.type) {
          case "text-delta":
            // Handle text streaming
            if (part.id !== currentTextID) {
              // New text part, create and add to contents
              currentTextID = part.id;
              currentText = { type: "text", text: part.text };
              contents.push(currentText);
              // Re-read the in-array reactive proxy so subsequent deltas mutate reactively (see above).
              currentText = contents[contents.length - 1] as LanguageModelV3TextPart;
            } else if (currentText) {
              // Continue streaming to existing text part
              currentText.text += part.text;
            }
            // Trigger event on meaningful text chunk
            onNewChunk?.();
            break;

          case "reasoning-delta":
            // Handle reasoning streaming (for models that support it)
            if (part.id !== currentReasoningID) {
              // New reasoning part, create and add to contents
              currentReasoningID = part.id;
              currentReasoning = { type: "reasoning", text: part.text };
              contents.push(currentReasoning);
              // Re-read the in-array reactive proxy so subsequent deltas mutate reactively (see above).
              currentReasoning = contents[contents.length - 1] as LanguageModelV3ReasoningPart;
            } else if (currentReasoning) {
              // Continue streaming to existing reasoning part
              currentReasoning.text += part.text;
            }
            // Trigger event on reasoning chunk
            onNewChunk?.();
            break;

          case "tool-call":
            // Tool calls arrive whole (not streamed), so just append — nothing mutates it afterward.
            contents.push({
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input
            });
            break;

          case "tool-result":
            // Handle tool result
            contents.push({
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: part.output
            });
            // Trigger event on tool result
            onNewChunk?.();
            break;

          default:
            // Log unknown part types for debugging
            console.warn('Unknown stream part type:', part.type, part);
            break;
        }
      },
      (error, commit) => {
        if (done) return; // a terminal 'done' already committed the exchange — ignore a trailing error
        console.error('SSE error:', error);
        // 'uncommitted': rejected before the server wrote anything (a pre-stream guard, before `connected`)
        // — remove every optimistic row so the caller can restore the input / leave the dialog open for a
        // clean retry. 'committed': the stream had opened (past `connected`), so the caller's move is on
        // the record — keep it (the committed user message or the authoritative deal card) and drop only
        // the unfinished assistant reply.
        rollbackTo(commit === 'uncommitted' ? optimisticStart : assistantStart);
        // A deal that committed but dropped BEFORE its `connected` card arrived: the proposal is durably
        // stored yet absent locally, and the dialog is still open — so the human could unknowingly re-send
        // a duplicate. Re-read the committed row from the store, fold it in, and close the dialog (via the
        // same `onConnected` the normal path uses) so the landed offer is shown and not re-authored.
        if (commit === 'committed' && request.kind === 'deal' && !dealRowReceived) {
          void reconcileDeals().then(() => onConnected?.());
        }
        onFailure?.(error, commit);
        isStreaming.value = false;
      },
      (data) => {
        // onDone — streaming completed successfully; the committed exchange stays put. The diplomat's
        // negotiator handoff (`call-negotiator`) is a terminal action, so a handoff turn writes deal rows
        // mid-run (counter/accept/reject/enacted) but speaks no separate reply; the server reconciled the
        // new rows and sent them here. Append them AFTER the streamed reasoning/tool block that produced
        // them (via `mergeDealRows`, which dedups against the connected proposal card and pushes to the
        // end — the assistant reply is the last item on `done`), so a card reads as the OUTCOME of the
        // handoff rather than preceding it. No reload, so the streamed reasoning/tool traces survive; a
        // later full reload drops those ephemeral traces and re-syncs to the store's append order, which —
        // since a handoff turn has no separate reply row — matches this order exactly.
        done = true;
        if (data?.deals?.length) mergeDealRows(data.deals);
        isStreaming.value = false;
      },
      (data) => {
        // 'connected' — the server committed this turn (it's the "accepted" signal). A deal turn carries
        // the authoritative committed row: splice it in just BEFORE the reply placeholder so the order is
        // [deal card, reply], and bump `assistantStart` so a later 'committed' rollback keeps the card.
        // `contents` already references the placeholder's content array, so the splice doesn't disturb
        // streaming. Then notify the host (e.g. close the deal dialog) — for chat/greeting there's no deal.
        if (data.deal && thread.value) {
          thread.value.messages.splice(assistantStart, 0, hydrateDealRow(data.deal, thread.value.agent));
          assistantStart++;
          dealRowReceived = true;
        }
        onConnected?.();
      }
    );
  };

  /**
   * Shared runner for every streamed turn (chat message, greeting, deal proposal/counter): push the
   * caller's optimistic row(s), mark streaming, then hand off to `streamResponse` (which appends the
   * assistant placeholder and streams the reply). A synchronous throw means the stream never started,
   * so nothing was committed → roll the optimistic rows back and report 'uncommitted'. The
   * `uncommitted`/`committed` post-open rollback contract lives in `streamResponse`, inherited by all.
   */
  const beginTurn = (
    optimisticRows: MessageWithMetadata[],
    request: ChatMessageRequest,
    onFailure?: (error: string, commit: SendCommitState) => void,
    onConnected?: () => void,
  ): (() => void) | undefined => {
    if (isStreaming.value || !thread.value) return;
    const optimisticStart = thread.value.messages.length;
    thread.value.messages.push(...optimisticRows);
    isStreaming.value = true;
    try {
      return streamResponse(request, optimisticStart, onFailure, onConnected);
    } catch (error) {
      console.error('Failed to start streaming turn:', error);
      rollbackTo(optimisticStart);
      onFailure?.(error instanceof Error ? error.message : 'Failed to send', 'uncommitted');
      isStreaming.value = false;
    }
  };

  /**
   * Send a message and handle streaming response.
   * @param message - The message to send
   * @returns Cleanup function for SSE or undefined
   */
  const sendMessage = async (message: string): Promise<(() => void) | undefined> => {
    if (!message.trim()) return;
    // Optimistically render the user's message; a failed send removes exactly this row + the placeholder.
    return beginTurn(
      [{ message: { role: 'user', content: message }, metadata: { datetime: new Date(), turn: turnNow() } }],
      { kind: 'text', chatId: sessionId.value, message },
      (error, commit) => onSendFailed?.(message, error, commit),
    );
  };

  /**
   * Request a greeting from the agent by sending the {{{Greeting}}} special message. The trigger isn't
   * a visible user row, so only the assistant placeholder is optimistic (no input to restore).
   * @returns Cleanup function for SSE or undefined
   */
  const requestGreeting = async (): Promise<(() => void) | undefined> =>
    beginTurn(
      [],
      { kind: 'text', chatId: sessionId.value, message: '{{{Greeting}}}' },
      (error) => onGreetingFailed?.(error),
    );

  /**
   * Submit a deal (propose or counter — one action), streaming the diplomat's reply through the SAME path
   * as a chat message. The dialog stays open (its controls disabled via `isStreaming`) until the server
   * COMMITS the deal: the `connected` event then carries the authoritative committed row, which
   * `streamResponse` inserts as the inline card and `onConnected` (passed by the host) uses to close the
   * dialog. So there's no optimistic/sentinel card and no post-stream refresh — the reply streams below
   * the real card. A pre-stream rejection never reaches `connected`, leaving the dialog open with the
   * draft intact.
   *
   * `expectedProposalID` is the open offer the submission answers — the ID of the proposal on the table,
   * or omitted when none is open (a fresh proposal). The server reconciles it against the live state
   * under the turn lock and 409s a mismatch (a stale submission that would supersede a freshly-opened
   * offer, or a stale counter answering a dead one) — surfaced as an `uncommitted` failure (the draft
   * stays). It also derives the archival type (proposal vs counter) from that state.
   * @returns Cleanup function for SSE or undefined
   */
  const proposeDeal = async (
    deal: DealPayload,
    onConnected?: () => void,
    expectedProposalID?: number,
  ): Promise<(() => void) | undefined> =>
    beginTurn(
      [],
      { kind: 'deal', chatId: sessionId.value, deal, expectedProposalID },
      (error, commit) => onDealFailed?.(error, commit),
      onConnected,
    );

  return { sendMessage, requestGreeting, proposeDeal };
}
