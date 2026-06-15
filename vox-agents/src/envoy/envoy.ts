/**
 * @module envoy/envoy
 *
 * Generic base envoy agent for chat-based interactions.
 * Parameterized over TParameters to allow specialization for different game contexts.
 */

import { ModelMessage, StepResult, Tool } from "ai";
import { VoxAgent, AgentParameters } from "../infra/vox-agent.js";
import { EnvoyThread, MessageWithMetadata, SpecialMessageConfig } from "../types/index.js";
import { VoxContext } from "../infra/vox-context.js";
import { formatToolResultOutput, stripTurnMarker } from "../utils/models/text-cleaning.js";
import { audienceID, roleOf } from "../utils/diplomacy/transcript-utils.js";

/** Identity (civ + leader) of a conversation participant, derived from typed parameters. */
export interface ParticipantIdentity {
  /** Civilization name, e.g. "Germany". */
  name: string;
  /** Leader name, e.g. "Bismarck". */
  leader: string;
}

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
   * Returns the map of special message tokens to their configurations.
   * Special messages are triple-brace-enclosed tokens (e.g., "{{{Greeting}}}") that
   * trigger specific agent behavior without appearing as user messages.
   * Override in concrete subclasses to define supported special messages.
   */
  protected abstract getSpecialMessages(): Record<string, SpecialMessageConfig>;

  /**
   * Checks if the current interaction is in special message mode.
   * Returns true when the last message is a recognized special message token.
   */
  protected isSpecialMode(input: EnvoyThread): boolean {
    return this.findLastSpecialMessage(input) !== undefined;
  }

  /**
   * Checks if the very last message in the thread is a special message.
   * Returns the config if it is, undefined otherwise.
   */
  protected findLastSpecialMessage(input: EnvoyThread): SpecialMessageConfig | undefined {
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

      // Replace tool-result messages with a plain text summary
      if (message.role === 'tool' && Array.isArray(message.content)) {
        const texts = message.content
          .filter(part => part.type === 'tool-result')
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
   * Formats a description of the audience — the participant the agent is speaking to
   * (the non-voiced endpoint). The role comes from the thread's free-form descriptor;
   * the civ identity is derived from the typed parameters (never from a stored civ field
   * or the `agent`). Returns e.g. "a diplomat representing Bismarck of Germany" or, for an
   * observer with no civ, just the role.
   */
  protected formatUserDescription(parameters: TParameters, input: EnvoyThread): string {
    const audience = audienceID(input);
    const role = roleOf(input, audience)?.trim();
    if (!role) return 'an unknown participant';
    const parts = [role];
    const identity = this.getParticipantIdentity(parameters, audience);
    if (identity && identity.name !== 'Observer') {
      parts.push(`representing ${identity.leader ? `${identity.leader} of ` : ''}${identity.name}`);
    }
    return parts.join(' ');
  }

  /**
   * Identity (civ + leader) of a conversation participant by playerID, derived from the
   * agent's typed parameters ONLY — never from `EnvoyThread.agent` (which is just the
   * voiced seat's id) or a stored civ field. Returns undefined when the participant has no
   * civ identity in these parameters (e.g. the observer, or a counterpart not visible).
   */
  protected abstract getParticipantIdentity(parameters: TParameters, playerID: number): ParticipantIdentity | undefined;

  /**
   * Convenience: identity of the seat this agent voices (its own `parameters.playerID`).
   */
  protected getSelfIdentity(parameters: TParameters): ParticipantIdentity {
    return this.getParticipantIdentity(parameters, parameters.playerID) ?? { name: 'Unknown', leader: 'Unknown' };
  }
}
