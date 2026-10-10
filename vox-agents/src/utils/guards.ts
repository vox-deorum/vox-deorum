/**
 * @module utils/guards
 *
 * Small runtime type guards for reading untyped values (JSON, tool results, provider payloads).
 */

/** Return whether a value is a plain string-keyed object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Return the value as a string-keyed object, or undefined when it is not one. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
