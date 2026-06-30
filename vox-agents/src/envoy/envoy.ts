/**
 * @module envoy/envoy
 *
 * Generic base envoy agent for chat-based interactions.
 * Parameterized over TParameters to allow specialization for different game contexts.
 */

import { ModelMessage, StepResult, Tool } from "ai";
import { VoxAgent, AgentParameters } from "../infra/vox-agent.js";
import { EnvoyThread, MessageWithMetadata, ParticipantIdentity } from "../types/index.js";
import { VoxContext } from "../infra/vox-context.js";
import { formatToolResultOutput, stripTurnMarker } from "../utils/models/text-cleaning.js";
import { audienceID, identityOf, roleOf } from "../utils/diplomacy/transcript-utils.js";
import { sendMessageToolName } from "../utils/diplomacy/send-message-tool-name.js";

/**
 * Default special messages shared by all envoy agents. Maps a triple-brace-enclosed
 * token (e.g., "{{{Greeting}}}") to the instruction prompt that becomes the hint add-on
 * when that token is the last message. Override `getSpecialMessages` to extend or replace.
 */
export const specialMessages: Record<string, string> = {
  "{{{Greeting}}}": "Send a one-sentence greeting appropriate to your diplomatic relationship, adjusting tone to the situation.",
};

/**
 * Generic base envoy agent that can chat with the user.
 * Accepts and returns EnvoyThread for maintaining conversation context.
 * Subclasses specialize for specific parameter types (e.g., LiveEnvoy for StrategistParameters).
 *
 * @abstract
 * @class
 */
export abstract class Envoy<TParameters extends AgentParameters = AgentParameters>
  extends VoxAgent<TParameters, EnvoyThread, EnvoyThread> {

  /**
   * Manually post-process LLM results and send back the output.
   */
  public async getOutput(
    _parameters: TParameters,
    input: EnvoyThread,
    _finalText: string
  ): Promise<EnvoyThread> {
    return input;
  }

  /**
   * Determines whether the agent should stop execution.
   * Adds response messages to the thread with metadata and limits tool-call loops.
   */
  public stopCheck(
    parameters: TParameters,
    input: EnvoyThread,
    lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    context: VoxContext<TParameters>
  ): boolean {
    // Add the messages to the record with metadata
    const currentTurn = parameters.turn;
    const currentDatetime = new Date();

    lastStep.response.messages.forEach(element => {
      // Strip LLM-echoed turn markers from assistant text so convertToModelMessages
      // can add the correct programmatic one on the next read.
      if (element.role === 'assistant') {
        if (typeof element.content === 'string') {
          element.content = stripTurnMarker(element.content);
        } else if (Array.isArray(element.content)) {
          for (const part of element.content) {
            if (part.type === 'text') {
              part.text = stripTurnMarker(part.text);
            }
          }
        }
      }

      input.messages.push({
        message: element,
        metadata: {
          datetime: currentDatetime,
          turn: currentTurn
        }
      });
    });

    return super.stopCheck(parameters, input, lastStep, allSteps, context);
  }

  // Special messages
  /**
   * Returns the map of special message tokens to their instruction prompts.
   * Special messages are triple-brace-enclosed tokens (e.g., "{{{Greeting}}}") that
   * trigger specific agent behavior without appearing as user messages.
   * Defaults to the shared greeting; override in subclasses to extend or replace.
   */
  protected getSpecialMessages(): Record<string, string> {
    return specialMessages;
  }

  /**
   * Returns the agent-specific behavioral nudge appended after the always-present hint in
   * normal mode. In special message mode the special prompt takes its place instead.
   * Defaults to none; override in concrete subclasses.
   */
  protected getDefaultAddon(_parameters: TParameters, _input: EnvoyThread): string {
    return "";
  }

  /**
   * Checks if the current interaction is in special message mode.
   * Returns true when the last message is a recognized special message token.
   */
  protected isSpecialMode(input: EnvoyThread): boolean {
    return this.findLastSpecialMessage(input) !== undefined;
  }

  /**
   * Checks if the very last message in the thread is a special message.
   * Returns its instruction prompt if it is, undefined otherwise.
   */
  protected findLastSpecialMessage(input: EnvoyThread): string | undefined {
    if (input.messages.length === 0) return undefined;
    const last = input.messages[input.messages.length - 1];
    if (typeof last.message.content === 'string') {
      return this.getSpecialMessages()[last.message.content];
    }
    return undefined;
  }

  /**
   * Filters out special messages from message history before sending to LLM.
   * Ensures special message tokens don't appear as visible conversation turns.
   */
  protected filterSpecialMessages(messages: MessageWithMetadata[]): MessageWithMetadata[] {
    const specialMessages = this.getSpecialMessages();
    return messages.filter(msg => {
      if (msg.message.role === 'user' && typeof msg.message.content === 'string') {
        return !(msg.message.content in specialMessages);
      }
      return true;
    });
  }

  /**
   * Whether to prepend `[Turn N]` to string-content messages.
   * LiveEnvoy uses turn markers; Telepathist disables them.
   */
  protected includeTurnPrefix: boolean = true;

  // Utilities
  /**
   * Converts an array of MessageWithMetadata to ModelMessage array for LLM context.
   * Filters out tool-result messages and non-text parts from assistant messages
   * to reduce token usage. Only textual conversation content is preserved.
   */
  protected convertToModelMessages(messages: MessageWithMetadata[]): ModelMessage[] {
    const result: ModelMessage[] = [];
    for (const item of messages) {
      const message = { ...item.message };

      // Replace tool-result messages with a plain text summary. Drop the send-message tool-result
      // ("Message delivered." confirmation): the spoken reply is the tool-call's Message argument,
      // already shown by the kept assistant tool-call part, so the confirmation carries no content
      // and would only add a stray "user" line. If dropping it empties the tool message, skip it.
      if (message.role === 'tool' && Array.isArray(message.content)) {
        const texts = message.content
          .filter(part => part.type === 'tool-result')
          .filter(part => part.toolName !== sendMessageToolName)
          .map(part => formatToolResultOutput(part))
          .filter((t): t is string => t !== undefined);
        if (texts.length === 0) continue;
        result.push({ role: 'user', content: texts.join('\n') });
        continue;
      }

      // For assistant messages with array content, keep text + tool-call, drop reasoning
      if (message.role === 'assistant' && Array.isArray(message.content)) {
        const kept = message.content.filter(
          (part) => part.type === 'text' || part.type === 'tool-call'
        ).map(part => {
          if (this.includeTurnPrefix && part.type === 'text') part.text = `[Turn ${item.metadata.turn}] ${part.text}`;
          return part;
        });
        if (kept.length === 0) continue;
        message.content = kept;
      }

      // Format turn into string messages for context
      if (this.includeTurnPrefix && typeof message.content === 'string' && !message.content.startsWith("[Turn"))
          message.content = `[Turn ${item.metadata.turn}] ${message.content}`;

      result.push(message);
    }
    return result;
  }

  /**
   * Describes the audience — the participant the agent is speaking to (the non-voiced
   * endpoint) — combining its free-form role descriptor with its civ identity, both stored on
   * the thread at open time (e.g. "the leader of Rome"). The civ identity is resolved once at
   * thread-open time and is a hard invariant: its absence means corrupted thread state, so we
   * throw rather than silently emit a roleless ("the leader") or generic descriptor. The role
   * is free-form and may legitimately be absent, in which case we fall back to the civ alone.
   */
  protected formatUserDescription(input: EnvoyThread): string {
    const id = audienceID(input);
    const role = roleOf(input, id)?.trim();
    const civ = identityOf(input, id)?.name?.trim();
    if (!civ) throw new Error(`Audience seat ${id} on thread ${input.id} has no civ identity`);
    return role ? `${role} of ${civ}` : `a representative of ${civ}`;
  }

  /**
   * Convenience: identity of the seat this agent voices (`input.agent`), read from the thread.
   */
  protected getSelfIdentity(input: EnvoyThread): ParticipantIdentity {
    return identityOf(input, input.agent) ?? { name: 'Unknown', leader: 'Unknown' };
  }
}
