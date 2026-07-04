/**
 * @module utils/models/tool-rescue/types
 *
 * Shared types for the tool-rescue middleware family.
 */

/**
 * Terminology preset for the prompt-mode tool-call instructions. The literal
 * doubles as the JSON name field emitted in the wire format (`{ "<framing>":
 * "<name>", "arguments": {...} }`). `'tool'` is the default used by every
 * prompt-mode model; `'action'` is used by the claude-code provider (its CLI
 * persona reasons in terms of actions, and it keeps the game tools read as
 * terminologically distinct from the CLI's own native tools).
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
   * rewritten conversation history. Defaults to `'tool'`. The claude-code
   * provider sets `'action'` so its native CLI tools and the JSON-invoked game
   * tools don't both read as "tools".
   */
  framing?: ToolCallFraming;
  /**
   * Called once during `transformParams` for every prompt-mode injection with
   * the resolved `framing` (an explicit fact, recorded separately from prompt
   * content) and, only when `framing === 'action'`, the injected prompt in
   * **vanilla `'tool'` wording**. Lets the caller record the framing state and
   * the pre-adaptation prompt to telemetry without inferring one from the other,
   * so the adaptation is verifiable and Oracle can read a vanilla prompt.
   */
  onToolFraming?: (info: { framing: ToolCallFraming; toolPrompt?: string }) => void;
  /**
   * If true, and the step forces tool use (`toolChoice.type === 'required'`) and no
   * real `output` schema already occupies `responseFormat`, a JSON `responseFormat` is
   * set so the provider constrained-decodes the reply to the tool-call contour. The wire
   * schema is object-wrapped (`{ "<framing>s": [{ "<framing>": "<name>", "arguments":
   * {...} }] }`, built by `buildToolCallArraySchema`), because a constrained-decoding
   * provider realizes `responseFormat` as a forced tool whose `input_schema.type` must be
   * `'object'`; the rescue unwraps that array transparently. The provider emits the payload
   * as ordinary text, which the existing rescue then parses into tool calls, turning the
   * best-effort parse into a parse of schema-valid text. Only enable for providers whose
   * `responseFormat` triggers constrained decoding (claude-code); others ignore it or 400.
   */
  structuredToolCalls?: boolean;
}
