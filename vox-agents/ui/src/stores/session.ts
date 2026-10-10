/**
 * Minimal session store for tracking game session status.
 * Provides reactive session state and automatic polling when active.
 */

import { ref } from 'vue';
import { api } from '../api/client';
import type {
  SessionStatusResponse
} from '@/utils/types';
import { createPoller } from '@/utils/polling';
import { errorMessage } from '@/utils/errors';

// Session status state
export const sessionStatus = ref<SessionStatusResponse | null>(null);
export const loading = ref(false);
export const error = ref<string | null>(null);

// Polling interval reference
let statusRequest: Promise<SessionStatusResponse> | null = null;
const activeSessionStates = new Set(['starting', 'running', 'recovering', 'stopping']);

/** Return whether a status response still needs active polling. */
function isActiveSession(response: SessionStatusResponse): boolean {
  return !!response.active && !!response.session && activeSessionStates.has(response.session.state);
}

/** Keep the interval aligned with current status and mounted polling owners. */
function syncPolling(response: SessionStatusResponse): void {
  if (isActiveSession(response)) {
    sessionPoller.start();
  } else {
    sessionPoller.stop();
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
    error.value = errorMessage(caught, 'Failed to fetch session status');
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

const sessionPoller = createPoller(() => {
  void fetchSessionStatus().catch(() => undefined);
}, 2000);

/** Start status loading for one mounted consumer and return its cleanup handle. */
export function startSessionPolling(): () => void {
  const release = sessionPoller.acquire();
  // The first response decides whether this session needs an interval at all. This stop() assumes a
  // single consumer (SessionView): with concurrent consumers it would halt a live interval, and a
  // failed fetch below would leave nothing to restart it.
  sessionPoller.stop();
  void fetchSessionStatus().catch(() => undefined);
  return release;
}

/**
 * Stop the current session
 */
async function runSessionAction<T>(
  action: () => Promise<T>
): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    await action();
    await fetchFreshSessionStatus();
  } catch (caught) {
    error.value = errorMessage(caught, 'Session action failed');
    throw caught;
  } finally {
    loading.value = false;
  }
}

/** Stop the current session. */
export function stopSession(): Promise<void> {
  return runSessionAction(() => api.stopSession());
}

/**
 * Pause the current session (no new LLM runs; the game stalls in place)
 */
export function pauseSession(): Promise<void> {
  return runSessionAction(() => api.pauseSession());
}

/**
 * Resume a paused session
 */
export function resumeSession(): Promise<void> {
  return runSessionAction(() => api.resumeSession());
}
