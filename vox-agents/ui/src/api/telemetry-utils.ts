/**
 * Utility functions for telemetry data formatting and processing
 */

import type { Span } from '../utils/types';

/**
 * Clone a span with an attributes bag that is safe for UI consumers to read.
 * Telemetry HTTP responses can contain SQLite's JSON string representation.
 */
export function parseSpanAttributes(span: Span): Span {
  if (!span.attributes) return { ...span, attributes: {} };
  if (typeof span.attributes !== 'string') return { ...span };
  try {
    const attributes = JSON.parse(span.attributes);
    return typeof attributes === 'object' && attributes !== null && !Array.isArray(attributes)
      ? { ...span, attributes }
      : { ...span, attributes: {} };
  } catch {
    return { ...span, attributes: {} };
  }
}

/**
 * Format duration in milliseconds for display
 */
export function formatDuration(ms: number): string {
  if (ms < 0.001) return `${(ms * 1000000).toFixed(0)}ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format nanosecond timestamp for display
 */
export function formatTimestamp(nanos: number): string {
  const date = new Date(nanos / 1000000); // Convert nanoseconds to milliseconds
  return date.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Format ISO date string for display
 */
export function formatISODate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

/**
 * Get status severity for PrimeVue Tag component
 * Based on OpenTelemetry StatusCode enum:
 * 0 = UNSET, 1 = OK, 2 = ERROR
 */
export function getStatusSeverity(statusCode: number): 'success' | 'danger' | 'warning' {
  switch (statusCode) {
    case 1: // OK
      return 'success';
    case 2: // ERROR
      return 'danger';
    default: // UNSET (0) or unknown
      return 'warning';
  }
}

/**
 * Get status text label
 * Based on OpenTelemetry StatusCode enum:
 * 0 = UNSET, 1 = OK, 2 = ERROR
 */
export function getStatusText(statusCode: number): string {
  switch (statusCode) {
    case 0:
      return 'UNSET';
    case 1:
      return 'OK';
    case 2:
      return 'ERROR';
    default:
      return 'UNKNOWN';
  }
}

/** Who picked an agent's model tier, keyed by the span's `triage.source` attribute. */
const triageSourceLabels: Record<string, string> = {
  evaluator: 'triage',
  caller: 'caller',
  shortcut: 'rule',
  failed: 'failure',
};

/**
 * One tag for an agent span's model tier and who picked it (e.g. "Tier small by triage"), with the
 * baseline tier and any triage note as its tooltip. Undefined when the span carries no tier.
 */
export function getTriageTag(span: Span): { label: string; severity: 'secondary' | 'warn'; tooltip?: string } | undefined {
  const { 'triage.tier': tier, 'triage.source': source, 'triage.baseline': baseline, 'triage.note': note } =
    (span.attributes ?? {}) as Record<string, unknown>;
  if (typeof tier !== 'string') return undefined;
  const by = typeof source === 'string' ? triageSourceLabels[source] ?? source : undefined;
  const tooltip = [
    typeof baseline === 'string' ? `Baseline tier: ${baseline}` : undefined,
    typeof note === 'string' ? `Note: ${note}` : undefined,
  ].filter(Boolean).join('\n');
  return {
    label: by ? `Tier ${tier} by ${by}` : `Tier ${tier}`,
    severity: source === 'failed' ? 'warn' : 'secondary',
    tooltip: tooltip || undefined,
  };
}

/**
 * Format file size in bytes for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * Build span hierarchy tree structure
 */
export interface SpanNode extends Span {
  children: SpanNode[];
  depth: number;
}

export function buildSpanTree(spans: Span[]): SpanNode[] {
  if (spans.length === 0) return [];

  // Create a map for quick lookup
  const spanMap = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // First pass: create all nodes
  spans.forEach(span => {
    spanMap.set(span.spanId, {
      ...span,
      children: [],
      depth: 0
    });
  });

  // Second pass: build hierarchy
  spans.forEach(span => {
    const node = spanMap.get(span.spanId)!;

    if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
      const parent = spanMap.get(span.parentSpanId)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Third pass: calculate depths recursively
  const calculateDepth = (node: SpanNode, depth: number = 0) => {
    node.depth = depth;
    node.children.forEach(child => calculateDepth(child, depth + 1));
  };

  roots.forEach(root => calculateDepth(root, 0));

  // Sort children by start time
  const sortChildren = (node: SpanNode) => {
    node.children.sort((a, b) => a.startTime - b.startTime);
    node.children.forEach(sortChildren);
  };

  roots.forEach(sortChildren);
  roots.sort((a, b) => a.startTime - b.startTime);

  return roots;
}

/**
 * Flatten span tree for display with expansion state
 */
export function flattenSpanTree(roots: SpanNode[], expandedSpans: Set<string>): SpanNode[] {
  const result: SpanNode[] = [];

  const flatten = (node: SpanNode) => {
    result.push(node);
    if (expandedSpans.has(node.spanId)) {
      node.children.forEach(flatten);
    }
  };

  roots.forEach(flatten);
  return result;
}

/**
 * Format token count with thousands separator
 */
export function formatTokenCount(count: number | undefined): string {
  if (count === undefined) return '-';
  return count.toLocaleString('en-US');
}
