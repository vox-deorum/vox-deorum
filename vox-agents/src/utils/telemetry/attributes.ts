/**
 * @module utils/telemetry/attributes
 *
 * Shared helpers for reading OpenTelemetry span attributes off telemetry-DB span rows.
 */

import type { Span, SpanAttributes } from './schema.js';

/**
 * Safely parse the JSON attributes bag from a span record. Attributes are stored either as a JSON
 * string (SQLite) or an already-parsed object; returns an empty bag when absent or unparseable.
 */
export function parseSpanAttributes(span: Span): SpanAttributes {
  if (!span.attributes) return {};
  try {
    return typeof span.attributes === 'string'
      ? JSON.parse(span.attributes)
      : span.attributes as SpanAttributes;
  } catch {
    return {};
  }
}
