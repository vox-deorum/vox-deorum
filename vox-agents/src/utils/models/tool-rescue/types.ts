/**
 * @module utils/models/tool-rescue/types
 *
 * Shared types for the tool-rescue middleware family.
 */

/**
 * Terminology preset for the prompt-mode tool-call instructions. The literal
 * doubles as the JSON name field emitted in the wire format (`{ "<framing>":
 * "<name>", "arguments": {...} }`). `'tool'` is the default used by every
 * prompt-mode model; `'action'` is used by Oracle prompt-mode replay to
 * reproduce the original turn's terminology.
 */
export type ToolCallFraming = 'tool' | 'action';

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
  /**
   * Terminology preset for the injected tool-call instructions and the
   * rewritten conversation history. Defaults to `'tool'`. Oracle prompt-mode
   * replay sets `'action'` to reproduce the original turn's terminology.
   */
  framing?: ToolCallFraming;
  /**
   * Called once during `transformParams` for every prompt-mode injection with
   * the resolved `framing`, an explicit fact recorded separately from prompt
   * content. Lets the caller record the framing state to telemetry without
   * inferring it from the presence of any stored prompt.
   */
  onToolFraming?: (info: { framing: ToolCallFraming }) => void;
}
