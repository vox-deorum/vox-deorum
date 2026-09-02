/**
 * @module utils/models/providers/claude-code-discovery
 *
 * Reads the model catalog exposed by the locally signed-in Claude Code
 * runtime, instead of relying on a hard-coded provider model list.
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk';

/** The bounded wait for the Claude Code runtime to report its catalog. */
const claudeCodeDiscoveryTimeoutMs = 10_000;

/** The user-facing failure message shared by every lookup failure. */
const claudeCodeDiscoveryErrorMessage =
  'Could not read the model list from your local Claude Code sign-in. Check that Claude Code is installed and signed in, then try again.';

/** The in-flight or completed catalog lookup shared by concurrent callers. */
let cachedCatalog: Promise<string[]> | null = null;

/** Clears the cached Claude Code catalog so the next call queries the runtime again. */
export function resetClaudeCodeDiscovery(): void {
  cachedCatalog = null;
}

/**
 * Returns the raw model selector values offered by the local Claude Code
 * runtime, in catalog order. Concurrent calls share one lookup; a failed
 * lookup is not cached so the next call retries.
 */
export async function discoverClaudeCodeModelValues(): Promise<string[]> {
  if (cachedCatalog) return cachedCatalog;
  const lookup = fetchClaudeCodeCatalogValues().catch((error: unknown) => {
    cachedCatalog = null;
    throw error;
  });
  cachedCatalog = lookup;
  return lookup;
}

/** Starts one Claude Code runtime query, reads its catalog, and always closes the query. */
async function fetchClaudeCodeCatalogValues(): Promise<string[]> {
  let session: Query | undefined;
  try {
    session = query({ prompt: '', options: { settingSources: [] } });
    const models = await withDeadline(session.supportedModels(), claudeCodeDiscoveryTimeoutMs);
    return models.map((entry) => entry.value);
  } catch (error) {
    throw new Error(claudeCodeDiscoveryErrorMessage, { cause: error });
  } finally {
    if (session) terminateSession(session);
  }
}

/** Bounds an operation with a deadline whose timer is always cleared. */
async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Claude Code model discovery timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Stops the query's CLI subprocess, first asking it to interrupt any pending work. */
function terminateSession(session: Query): void {
  try {
    void session.interrupt?.().catch(() => undefined);
  } catch {
    // Interrupt is best-effort; close still tears the subprocess down.
  }
  try {
    session.close();
  } catch {
    // The subprocess may already be gone; nothing further is needed.
  }
}
