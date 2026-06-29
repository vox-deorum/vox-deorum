/**
 * Composable for managing thread messages
 * Handles message operations and streaming logic for chat threads
 */

import type { Ref } from 'vue';
import type { EnvoyThread, ChatMessageRequest } from '@/utils/types';
import type { LanguageModelV3TextPart, LanguageModelV3ReasoningPart, LanguageModelV3ToolCallPart, LanguageModelV3ToolResultPart } from '@ai-sdk/provider';
import { api, type SendCommitState } from '@/api/client';
import type { ModelMessage } from 'ai';

export interface UseThreadMessagesOptions {
  thread: Ref<EnvoyThread | null>;
  sessionId: Ref<string>;
  isStreaming: Ref<boolean>;
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
}

export function useThreadMessages(options: UseThreadMessagesOptions) {
  const { thread, sessionId, isStreaming, onNewChunk, onSendFailed, onGreetingFailed } = options;

  /** Trim the thread's messages back to `length`, no-op if the thread went away mid-stream. */
  const rollbackTo = (length: number) => thread.value?.messages.splice(length);

  /**
   * Streams an agent response, setting up the assistant message placeholder and handling all chunk
   * types. Shared by sendMessage and requestGreeting. `optimisticStart` is the thread length captured
   * before the caller's optimistic row was added; the assistant placeholder we push here sits just
   * after it. On a failure before `done`, a RECOVERABLE error (the send never took effect) rolls every
   * optimistic row back to `optimisticStart`; an unrecoverable one (the stream had opened, so the
   * message may be committed) rolls back only the unfinished assistant row and keeps the message.
   */
  const streamResponse = (
    request: ChatMessageRequest,
    optimisticStart: number,
    onFailure?: (error: string, commit: SendCommitState) => void,
  ): (() => void) | undefined => {
    if (!thread.value) return;

    const currentTurn = thread.value.metadata?.turn || 0;

    // Prepare for assistant response with array content for multi-part support. Its index is the
    // rollback point for an unrecoverable failure (keep the caller's message, drop the partial reply).
    const assistantMessage: ModelMessage = { role: "assistant", content: [] };
    thread.value.messages.push({
      message: assistantMessage,
      metadata: {
        datetime: new Date(),
        turn: currentTurn
      }
    });
    const assistantStart = thread.value.messages.length - 1;
    const contents = thread.value.messages[assistantStart]!.message.content as Array<
      LanguageModelV3TextPart | LanguageModelV3ReasoningPart | LanguageModelV3ToolCallPart | LanguageModelV3ToolResultPart
    >;

    // The terminal 'done' commits the exchange server-side; a trailing error after it must not undo it.
    let done = false;

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
        // 'uncommitted': the send was rejected before the server wrote anything (a pre-stream guard), so
        // remove every optimistic row and let the caller restore the input for a clean retry. 'committed':
        // the stream had opened and the caller's message may already be on the record — keep it on screen
        // and drop only the unfinished assistant reply, so a retry can't duplicate it.
        rollbackTo(commit === 'uncommitted' ? optimisticStart : assistantStart);
        onFailure?.(error, commit);
        isStreaming.value = false;
      },
      () => {
        // onDone callback - streaming completed successfully
        done = true;
        console.log('Streaming completed');
        isStreaming.value = false;
      }
    );
  };

  /**
   * Send a message and handle streaming response
   * @param message - The message to send
   * @returns Cleanup function for SSE or undefined
   */
  const sendMessage = async (message: string): Promise<(() => void) | undefined> => {
    if (!message.trim() || isStreaming.value || !thread.value) {
      return;
    }

    // Optimistically render the user's message. Capture the pre-send length so a failed send can
    // remove exactly the rows we add (this user message + the assistant placeholder).
    const optimisticStart = thread.value.messages.length;
    const currentTurn = thread.value.metadata?.turn || 0;
    const userMessage: ModelMessage = { role: "user", content: message };
    thread.value.messages.push({
      message: userMessage,
      metadata: {
        datetime: new Date(),
        turn: currentTurn
      }
    });

    isStreaming.value = true;

    try {
      return streamResponse(
        { chatId: sessionId.value, message },
        optimisticStart,
        (error, commit) => onSendFailed?.(message, error, commit),
      );
    } catch (error) {
      // A synchronous throw means the stream never started, so nothing was committed → 'uncommitted'.
      console.error('Failed to send message:', error);
      rollbackTo(optimisticStart);
      onSendFailed?.(message, error instanceof Error ? error.message : 'Failed to send message', 'uncommitted');
      isStreaming.value = false;
    }
  };

  /**
   * Request a greeting from the agent by sending the {{{Greeting}}} special message.
   * Can be called at any time — on new threads or when re-entering a stale conversation.
   * @returns Cleanup function for SSE or undefined
   */
  const requestGreeting = async (): Promise<(() => void) | undefined> => {
    if (isStreaming.value || !thread.value) {
      return;
    }

    // The greeting trigger isn't a visible user message; only the assistant placeholder is
    // optimistic, so a failed greeting just rolls that one row back (no input to restore). It still
    // surfaces the failure (rather than silently vanishing) via onGreetingFailed.
    const optimisticStart = thread.value.messages.length;
    isStreaming.value = true;

    try {
      return streamResponse(
        { chatId: sessionId.value, message: '{{{Greeting}}}' },
        optimisticStart,
        (error) => onGreetingFailed?.(error),
      );
    } catch (error) {
      console.error('Failed to request greeting:', error);
      rollbackTo(optimisticStart);
      onGreetingFailed?.(error instanceof Error ? error.message : 'Failed to request greeting');
      isStreaming.value = false;
    }
  };

  return { sendMessage, requestGreeting };
}
