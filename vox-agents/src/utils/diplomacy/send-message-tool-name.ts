/**
 * @module utils/diplomacy/send-message-tool-name
 *
 * The canonical `send-message` tool name, in a zero-dependency leaf module so every consumer
 * (the tool itself, the archival reducer in `transcript-utils.ts`, and the streamer in
 * `utils/models/send-message-stream.ts`) shares one literal. Kept free of imports on purpose: it
 * must stay importable from `transcript-utils.ts` without dragging in the tool's `VoxContext` /
 * OpenTelemetry deps, and a single source means a rename can never silently break archival or the
 * streamer.
 */

/**
 * The `send-message` tool name, exported as a camelCase constant (the repo's exported-constant
 * convention, matching `worldContext` / `communicationStyle`).
 */
export const sendMessageToolName = "send-message";
