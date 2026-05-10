/**
 * @module utils/models/token-counter
 *
 * Local token counting utility using tiktoken for accurate token estimation.
 * Provides consistent token counting across different model types without relying on API responses.
 */

import { get_encoding } from 'tiktoken';
import { ModelMessage } from 'ai';
import { createLogger } from '../logger.js';

const logger = createLogger('TokenCounter');

/**
 * Count tokens in a string
 * @param text - The text to count tokens for
 * @returns The number of tokens
 */
export function countTokens(text: string): number {
  if (!text) return 0;

  try {
    const encoder = get_encoding("o200k_base");
    const tokens = encoder.encode(text);
    encoder.free();
    return tokens.length;
  } catch (error) {
    logger.error(`Error counting tokens:`, error);
    // Fallback to rough estimation (1 token ≈ 4 characters)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Count tokens in a message
 * @param message - The message to count tokens for
 * @returns The number of tokens
 */
export function countMessageTokens(message: ModelMessage, reasoningOnly: boolean): number {
  let totalTokens = 0;

  // Count role tokens (typically 1 token)
  if (!reasoningOnly) totalTokens += 1;

  // Count content tokens
  if (typeof message.content === 'string') {
    if (!reasoningOnly) totalTokens += countTokens(message.content);
  } else if (Array.isArray(message.content)) {
    // Handle multi-part content
    for (const part of message.content) {
      if (reasoningOnly) {
        if (part.type === 'reasoning') {
          totalTokens += countTokens(part.text as string);
        }
        continue;
      }
      switch (part.type) {
        case 'text':
          totalTokens += countTokens(part.text as string);
          break;
        
        case 'tool-call':
          if ('toolName' in part) {
            totalTokens += countTokens(part.toolName as string);
          }
          if ('input' in part && part.input) {
            totalTokens += countTokens(JSON.stringify(part.input));
          }
          break;
      }
    }
  }

  // Add message separator tokens (typically 3-4 tokens)
  if (!reasoningOnly) totalTokens += 3;

  return totalTokens;
}

/**
 * Count tokens in a list of messages
 * @param messages - The messages to count tokens for
 * @returns The total number of tokens
 */
export function countMessagesTokens(messages: ModelMessage[], reasoningOnly: boolean): number {
  if (!messages || messages.length === 0) return 0;

  let totalTokens = 0;
  for (const message of messages) {
    totalTokens += countMessageTokens(message, reasoningOnly);
  }

  return totalTokens;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}