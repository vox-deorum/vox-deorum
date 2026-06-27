/**
 * Composable for managing thread messages
 * Handles message operations and streaming logic for chat threads
 */

import type { Ref } from 'vue';
import type { EnvoyThread, ChatMessageRequest } from '@/utils/types';
import type { LanguageModelV3TextPart, LanguageModelV3ReasoningPart, LanguageModelV3ToolCallPart, LanguageModelV3ToolResultPart } from '@ai-sdk/provider';
import { api } from '@/api/client';
import type { ModelMessage } from 'ai';

export interface UseThreadMessagesOptions {
  thread: Ref<EnvoyThread | null>;
  sessionId: Ref<string>;
  isStreaming: Ref<boolean>;
  onNewChunk?: () => void;
  /**
   * A user-sent message could not be delivered because the send never took effect (e.g. the live
   * turn wasn't available, or the conversation was closed this turn). Its optimistically-rendered
   * rows have already been removed; the host returns the text to the input box and surfaces why.
   */
  onSendFailed?: (text: string, error: string) => void;
}

export function useThreadMessages(options: UseThreadMessagesOptions) {
  const { thread, sessionId, isStreaming, onNewChunk, onSendFailed } = options;
  let contents: Array<LanguageModelV3TextPart | LanguageModelV3ReasoningPart | LanguageModelV3ToolCallPart | LanguageModelV3ToolResultPart>;

  /**
   * Push or update an error message
   * @param error - Error object or string
   * @param messageIndex - Optional index to update existing message
   * @returns Index of the error message
   */
  const pushErrorMessage = (error: any) => {
    if (!thread.value) return -1;
    const errorMessage = typeof error === 'string'
      ? error
      : error?.message || 'An error occurred during the streaming.';
    const errorContent = `❌ ${errorMessage}`;
    // Update existing message
    contents.push({
      type: "text",
      text: errorContent
    });
  };

  /**
   * Streams an agent response, setting up the assistant message placeholder and handling all chunk
   * types. Shared by sendMessage and requestGreeting. `rollbackTo` is the thread length captured
   * before the caller's optimistic rows were added; if the send never takes effect, every row from
   * there on is removed and `onRecoverableFailure` runs (so the caller can restore the input).
   */
  const streamResponse = (
    request: ChatMessageRequest,
    rollbackTo: number,
    onRecoverableFailure?: (error: string) => void,
  ): (() => void) | undefined => {
    if (!thread.value) return;

    const currentTurn = thread.value.metadata?.turn || 0;

    // Prepare for assistant response with array content for multi-part support
    const assistantMessage: ModelMessage = { role: "assistant", content: [] };
    thread.value.messages.push({
      message: assistantMessage,
      metadata: {
        datetime: new Date(),
        turn: currentTurn
      }
    });
    contents = thread.value.messages[thread.value.messages.length - 1]!.message.content as any;

    // Prepare for each type
    let currentText: LanguageModelV3TextPart | null = null;
    let currentTextID: string = "";
    let currentReasoning: LanguageModelV3ReasoningPart | null = null;
    let currentReasoningID: string = "";
    let currentToolCall: LanguageModelV3ToolCallPart | null = null;

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
              currentText = contents[contents.length - 1] as any;
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
              currentReasoning = contents[contents.length - 1] as any;
            } else if (currentReasoning) {
              // Continue streaming to existing reasoning part
              currentReasoning.text += part.text;
            }
            // Trigger event on reasoning chunk
            onNewChunk?.();
            break;

          case "tool-call":
            currentToolCall = {
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input
            };
            contents.push(currentToolCall);
            currentToolCall = contents[contents.length - 1] as any;
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
      (error, info) => {
        console.error('SSE error:', error);
        if (info.recoverable) {
          // The send never took effect (the stream never opened — the route rejected before
          // committing the message). Remove the optimistic rows we added and let the caller restore
          // the input, rather than leaving a phantom that disappears on the next reload.
          thread.value?.messages.splice(rollbackTo);
          onRecoverableFailure?.(error);
        } else {
          // The reply failed mid-stream after the message was committed — keep it and show the
          // error inline (rolling it back here would duplicate the stored message on a resend).
          pushErrorMessage(error);
        }
        isStreaming.value = false;
      },
      () => {
        // onDone callback - streaming completed successfully
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
    const rollbackTo = thread.value.messages.length;
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
        rollbackTo,
        (error) => onSendFailed?.(message, error),
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      thread.value?.messages.splice(rollbackTo);
      onSendFailed?.(message, error instanceof Error ? error.message : 'Failed to send message');
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
    // optimistic, so a failed greeting just rolls that one row back (no input to restore).
    const rollbackTo = thread.value.messages.length;
    isStreaming.value = true;

    try {
      return streamResponse({ chatId: sessionId.value, message: '{{{Greeting}}}' }, rollbackTo);
    } catch (error) {
      console.error('Failed to request greeting:', error);
      thread.value?.messages.splice(rollbackTo);
      isStreaming.value = false;
    }
  };

  return { sendMessage, requestGreeting };
}
