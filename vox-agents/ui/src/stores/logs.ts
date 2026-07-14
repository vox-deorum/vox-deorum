/**
 * Background log streaming service
 * Maintains a single SSE connection for log streaming
 * Provides reactive log data for UI components
 */

import { ref, shallowRef } from 'vue';
import { api } from '../api/client';
import type { LogEntry } from '@/utils/types';

// Reactive state
export const logs = shallowRef<LogEntry[]>([]);
export const isConnected = ref(false);
export const lastHeartbeat = ref<Date | null>(null);

// Configuration
const MAX_LOGS = 1000;

// Internal state
let cleanupSse: (() => void) | null = null;
  
/**
 * Add a new log entry to the store
 */
function addLog(log: LogEntry) {
  const currentLogs = logs.value;

  // Create new array with the new log
  let newLogs = [...currentLogs, log];

  // Trim to max size if needed
  if (newLogs.length > MAX_LOGS) {
    newLogs = newLogs.slice(-MAX_LOGS);
  }

  // Update using shallowRef for better performance
  logs.value = newLogs;
}

/**
 * Clear all logs from the store
 */
export function clearLogs() {
  logs.value = [];
}

/**
 * Connect to the log stream
 */
function connect() {
  // Clean up existing connection if any
  if (cleanupSse) {
    cleanupSse();
    cleanupSse = null;
  }

  // Establish new SSE connection
  cleanupSse = api.streamLogs(
    (log) => {
      addLog(log);
      isConnected.value = true;
    },
    (error) => {
      console.error('Log stream error:', error);
      isConnected.value = false;
    },
    () => {
      // Heartbeat callback
      lastHeartbeat.value = new Date();
      isConnected.value = true;
    }
  );

  // Initial connection established
  isConnected.value = true;
}

/**
 * Disconnect from the log stream
 */
export function disconnect() {
  if (cleanupSse) {
    cleanupSse();
    cleanupSse = null;
  }

  isConnected.value = false;
}

// Start connection immediately when module is loaded
connect();

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', disconnect);
}
