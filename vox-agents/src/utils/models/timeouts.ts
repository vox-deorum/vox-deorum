/** Environment overrides for model response deadlines, in milliseconds. */
type ModelTimeoutVariable = 'LLM_FIRST_TOKEN_TIMEOUT_MS' | 'LLM_STREAM_TIMEOUT_MS';

/** Every timeout override, for validating a whole environment at once. */
const modelTimeoutVariables: ModelTimeoutVariable[] = ['LLM_FIRST_TOKEN_TIMEOUT_MS', 'LLM_STREAM_TIMEOUT_MS'];

/** Largest delay a Node.js timer accepts. */
const maxTimerDelay = 2 ** 31 - 1;

/** Parse an optional positive millisecond duration that fits a Node.js timer. */
function parseModelTimeout(name: ModelTimeoutVariable, raw: string | undefined): number | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const milliseconds = Number(value);
  if (!/^\d+$/.test(value) || milliseconds < 1 || milliseconds > maxTimerDelay) {
    throw new Error(`${name} must be a positive integer in milliseconds, at most ${maxTimerDelay}.`);
  }
  return milliseconds;
}

/** Read one override from the current process environment. */
export function readModelTimeout(name: ModelTimeoutVariable): number | undefined {
  return parseModelTimeout(name, process.env[name]);
}

/** Reject malformed overrides up front, so a typo stops startup or a settings save instead of every model call. */
export function validateModelTimeouts(env: Record<string, string | undefined> = process.env): void {
  for (const name of modelTimeoutVariables) parseModelTimeout(name, env[name]);
}

/**
 * HTTP client deadlines for a custom endpoint, widened by the overrides. Slow servers can hold
 * back headers until the model loads and reads the prompt, so the header wait follows the same
 * first-output fallback as streamTextWithConcurrency: first-token, then streaming, then default.
 */
export function httpTimeouts(defaultMs: number): { headersTimeout: number; bodyTimeout: number } {
  const firstToken = readModelTimeout('LLM_FIRST_TOKEN_TIMEOUT_MS');
  const stream = readModelTimeout('LLM_STREAM_TIMEOUT_MS');
  return {
    headersTimeout: firstToken ?? stream ?? defaultMs,
    bodyTimeout: Math.max(firstToken ?? defaultMs, stream ?? defaultMs),
  };
}
