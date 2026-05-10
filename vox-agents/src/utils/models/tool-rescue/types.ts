/**
 * @module utils/models/tool-rescue/types
 *
 * Shared types for the tool-rescue middleware family.
 */

/**
 * Configuration options for tool rescue
 */
export interface ToolRescueOptions {
  /**
   * If true, instructs the model to respond in tool/arguments JSON format
   * by adding a system prompt with instructions
   */
  prompt?: boolean;
  /**
   * If true, merges the tool prompt into the first existing system message
   * rather than prepending a new one. Required for models that only accept
   * a single system message at position 0 (e.g. Qwen).
   */
  systemPromptFirst?: boolean;
}
