/**
 * Minimal session store for tracking game session status.
 * Provides reactive session state and automatic polling when active.
 */

import { ref } from 'vue';
import { api } from '../api/client';
import type {
  PauseSessionResponse,
  ResumeSessionResponse,
  SessionStatusResponse,
  StopSessionResponse
} from '@/utils/types';

// Session status state
export const sessionStatus = ref<SessionStatusResponse | null>(null);
export const loading = ref(false);
export const error = ref<string | null>(null);

// Polling interval reference
let pollInterval: number | null = null;
let statusRequest: Promise<SessionStatusResponse> | null = null;
let pollingConsumers = 0;
const activeSessionStates = new Set(['starting', 'running', 'recovering', 'stopping']);

type SessionActionResponse = StopSessionResponse | PauseSessionResponse | ResumeSessionResponse;

/** Return whether a status response still needs active polling. */
function isActiveSession(response: SessionStatusResponse): boolean {
  return !!response.active && !!response.session && activeSessionStates.has(response.session.state);
}

/** Keep the interval aligned with current status and mounted polling owners. */
function syncPolling(response: SessionStatusResponse): void {
  if (pollingConsumers > 0 && isActiveSession(response)) {
    startPolling();
  } else {
    stopPolling();
  }
}

/** Start one session status request and publish its response. */
function requestSessionStatus(): Promise<SessionStatusResponse> {
  error.value = null;
  statusRequest = api.getSessionStatus().then((response) => {
    sessionStatus.value = response;
    syncPolling(response);
    return response;
  }).catch((caught) => {
    error.value = caught instanceof Error ? caught.message : 'Failed to fetch session status';
    throw caught;
  }).finally(() => {
    statusRequest = null;
  });
  return statusRequest;
}

/** Fetch current session status, reusing an ordinary request already in progress. */
export function fetchSessionStatus(): Promise<SessionStatusResponse> {
  return statusRequest ?? requestSessionStatus();
}

/** Fetch status after every earlier request has settled so mutations get a fresh read. */
export async function fetchFreshSessionStatus(): Promise<SessionStatusResponse> {
  while (statusRequest) {
    try {
      await statusRequest;
    } catch {
      // The fresh request still needs to run if an earlier polling request failed.
    }
  }
  return requestSessionStatus();
}

/**
 * Start polling for session status updates
 */
function startPolling(): void {
  if (pollInterval !== null || pollingConsumers === 0) return;

  pollInterval = window.setInterval(() => {
    void fetchSessionStatus().catch(() => undefined);
  }, 2000);
}

/**
 * Stop polling for session status
 */
function stopPolling(): void {
  if (pollInterval !== null) {
    window.clearInterval(pollInterval);
    pollInterval = null;
  }
}

/** Start status loading for one mounted consumer and return its cleanup handle. */
export function startSessionPolling(): () => void {
  pollingConsumers++;
  void fetchSessionStatus().catch(() => undefined);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    pollingConsumers = Math.max(0, pollingConsumers - 1);
    if (pollingConsumers === 0) stopPolling();
  };
}

/**
 * Stop the current session
 */
async function runSessionAction(
  action: () => Promise<SessionActionResponse>,
  fallbackMessage: string
): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    await action();
    await fetchFreshSessionStatus();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : fallbackMessage;
    throw caught;
  } finally {
    loading.value = false;
  }
}

/** Stop the current session. */
export function stopSession(): Promise<void> {
  return runSessionAction(() => api.stopSession(), 'Failed to stop session');
}

/**
 * Pause the current session (no new LLM runs; the game stalls in place)
 */
export function pauseSession(): Promise<void> {
  return runSessionAction(() => api.pauseSession(), 'Failed to pause session');
}

/**
 * Resume a paused session
 */
export function resumeSession(): Promise<void> {
  return runSessionAction(() => api.resumeSession(), 'Failed to resume session');
}
