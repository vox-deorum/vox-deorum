import * as z from "zod";

/** Delimiter framing event-pipe messages between the bridge service and MCP server. */
export const eventPipeDelimiter = "!@#$%^!";

/**
 * Response shape of Bridge Service Lua calls. The single source of truth for both the
 * `LuaResponse` type used by BridgeManager and the output schema of tools that expose
 * Lua calls verbatim (call-lua-function).
 */
export const LuaResponseSchema = z.object({
  success: z.boolean(),
  result: z.any().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.string().optional(),
  }).optional(),
});
