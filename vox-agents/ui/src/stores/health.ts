import { ref } from 'vue';
import { api } from '../api/client';
import type { HealthStatus } from '@/utils/types';

const pollIntervalMs = 5000;

export const healthStatus = ref<HealthStatus | null>(null);

let healthRequest: Promise<void> | null = null;
let pollInterval: number | null = null;
let pollingConsumers = 0;

/** Fetch service health, reusing a request already in progress. */
export function fetchHealth(): Promise<void> {
  if (healthRequest) return healthRequest;

  healthRequest = api.getHealth().then((status) => {
    healthStatus.value = status;
  }).catch(() => {
    healthStatus.value = {
      status: 'error',
      timestamp: new Date().toISOString(),
      service: 'vox-agents',
      version: 'Unknown'
    };
  }).finally(() => {
    healthRequest = null;
  });

  return healthRequest;
}

/** Run one health polling tick. */
function pollHealth(): void {
  void fetchHealth();
}

/** Start health polling for one mounted consumer and return its cleanup handle. */
export function startHealthPolling(): () => void {
  pollingConsumers++;
  void fetchHealth();

  if (pollInterval === null) {
    pollInterval = window.setInterval(pollHealth, pollIntervalMs);
  }

  let released = false;

  /** Release this caller's health polling ownership once. */
  return () => {
    if (released) return;
    released = true;
    pollingConsumers = Math.max(0, pollingConsumers - 1);
    if (pollingConsumers > 0 || pollInterval === null) return;
    window.clearInterval(pollInterval);
    pollInterval = null;
  };
}
