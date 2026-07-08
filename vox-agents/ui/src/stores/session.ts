/**
 * Minimal session store for tracking game session status.
 * Provides reactive session state and automatic polling when active.
 */

import { ref } from 'vue';
import { apiClient } from '../api/client';
import type { SessionStatusResponse } from '@/utils/types';

// Session status state
export const sessionStatus = ref<SessionStatusResponse | null>(null);
export const loading = ref(false);
export const error = ref<string | null>(null);

// Polling interval reference
let pollInterval: number | null = null;

/**
 * Fetch current session status from the server
 */
export async function fetchSessionStatus() {
  try {
    error.value = null;
    const response = await apiClient.getSessionStatus();
    sessionStatus.value = response;

    // Start or stop polling based on session state
    // Poll during active states: starting, running, recovering, stopping
    const activeStates = ['starting', 'running', 'recovering', 'stopping'];
    if (response.active && response.session && activeStates.includes(response.session.state)) {
      startPolling();
    } else {
      stopPolling();
    }

    return response;
  } catch (err: any) {
    error.value = err.message || 'Failed to fetch session status';
    console.error('Error fetching session status:', err);
    throw err;
  }
}

/**
 * Start polling for session status updates
 */
export function startPolling() {
  // Don't start if already polling
  if (pollInterval) return;

  // Poll every 2 seconds
  pollInterval = setInterval(async () => {
    try {
      const response = await apiClient.getSessionStatus();
      sessionStatus.value = response;

      // Stop polling if session is no longer in an active state
      const activeStates = ['starting', 'running', 'recovering', 'stopping'];
      if (!response.active || !response.session || !activeStates.includes(response.session.state)) {
        stopPolling();
      }
    } catch (err) {
      console.error('Error polling session status:', err);
    }
  }, 2000);
}

/**
 * Stop polling for session status
 */
export function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Stop the current session
 */
export async function stopSession() {
  loading.value = true;
  error.value = null;

  try {
    await apiClient.stopSession();
    await fetchSessionStatus();
  } catch (err: any) {
    error.value = err.message || 'Failed to stop session';
    throw err;
  } finally {
    loading.value = false;
  }
}

/**
 * Pause the current session (no new LLM runs; the game stalls in place)
 */
export async function pauseSession() {
  loading.value = true;
  error.value = null;

  try {
    await apiClient.pauseSession();
    await fetchSessionStatus();
  } catch (err: any) {
    error.value = err.message || 'Failed to pause session';
    throw err;
  } finally {
    loading.value = false;
  }
}

/**
 * Resume a paused session
 */
export async function resumeSession() {
  loading.value = true;
  error.value = null;

  try {
    await apiClient.resumeSession();
    await fetchSessionStatus();
  } catch (err: any) {
    error.value = err.message || 'Failed to resume session';
    throw err;
  } finally {
    loading.value = false;
  }
}

/**
 * Clean up on unmount
 */
export function cleanup() {
  stopPolling();
}