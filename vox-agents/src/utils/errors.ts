/**
 * @module utils/errors
 *
 * Shared helpers for turning caught values into readable error text.
 */

/** Return an error's message, or `fallback` (default `String(error)`) for non-Error values. */
export function errorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error) return error.message;
  return fallback ?? String(error);
}
