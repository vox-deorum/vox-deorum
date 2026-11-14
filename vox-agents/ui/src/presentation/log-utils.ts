/**
 * Log data structures and preprocessing utilities
 */

import type { LogEntry } from '../utils/types';

/** Fixed fields that are not considered params */
const FIXED_LOG_FIELDS = [
  'timestamp',
  'level',
  'message',
  'context',
  'source',
  'transport' // Excluded from params display
] as const;

/**
 * Extract params from raw log data
 * All fields not in FIXED_LOG_FIELDS are considered params
 * @param rawLog - Raw log data from the server
 * @returns Processed LogEntry with params extracted
 */
export function extractLogParams(rawLog: any): LogEntry {
  const entry: LogEntry = {
    timestamp: rawLog.timestamp,
    level: rawLog.level,
    message: rawLog.message,
    source: rawLog.source,
    context: rawLog.context
  };

  // Extract all non-fixed fields as params.
  const params: Record<string, any> = {};

  for (const [key, value] of Object.entries(rawLog)) {
    if (!FIXED_LOG_FIELDS.includes(key as any)) {
      params[key] = value;
    }
  }

  // Only add params if there are any
  if (Object.keys(params).length > 0) {
    entry.params = params;
  }

  return entry;
}

/**
 * Get emoji icon for log level
 * @param level - The log level
 * @returns Emoji representing the log level
 */
export function getLevelEmoji(level: string): string {
  const emojis: Record<string, string> = {
    error: '❌',
    warn: '⚠️',
    info: 'ℹ️',
    debug: '🐛'
  };
  return emojis[level] || '📝';
}

/**
 * Format timestamp for display
 * @param timestamp - ISO timestamp string
 * @returns Formatted time string with milliseconds
 */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${time}.${ms}`;
}

/** Log level hierarchy for filtering */
export const levelHierarchy: Record<LogEntry['level'], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Filter logs based on level and source
 * @param logs - Array of log entries
 * @param minLevel - Minimum level to show
 * @param selectedSources - Array of sources to show (empty means show all)
 * @returns Filtered log entries
 */
export function filterLogs(
  logs: LogEntry[],
  minLevel: LogEntry['level'],
  selectedSources: string[]
): LogEntry[] {
  return logs.filter(log => {
    // Filter by level hierarchy
    const logLevel = levelHierarchy[log.level];
    const minLevelValue = levelHierarchy[minLevel];
    if (logLevel < minLevelValue) return false;

    // Filter by source if specific sources are selected
    if (selectedSources.length > 0) {
      const logSource = log.source || 'agents'; // Default to 'agents' if no source
      if (!selectedSources.includes(logSource)) return false;
    }

    return true;
  });
}

/** Minimum-level choices for the log level filter, lowest first. */
export const levelOptions: { label: string; value: LogEntry['level'] }[] = [
  { label: 'Debug', value: 'debug' },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warn' },
  { label: 'Error', value: 'error' }
];

/**
 * Get the table row class for a log level, so warnings and errors stand out
 * @param level - The log level
 * @returns Space-separated row classes
 */
export function getLogRowClass(level: string): string {
  if (level === 'error') return 'table-row error';
  if (level === 'warn') return 'table-row warning';
  return 'table-row';
}

/**
 * Check whether a log entry mentions the search text in its message or context
 * @param log - The log entry
 * @param query - Lowercased search text; empty matches everything
 */
export function logMatchesQuery(log: LogEntry, query: string): boolean {
  if (!query) return true;
  return `${log.context ?? ''} ${log.message ?? ''}`.toLowerCase().includes(query);
}
