import { api } from '../api/client';
import type { AgentInfo } from '@/utils/types';

// The server's agent registry is fixed for its lifetime, so one successful load serves the page.
let catalogue: AgentInfo[] | null = null;
let catalogueRequest: Promise<AgentInfo[]> | null = null;

/** Load the agent catalogue once per page. Concurrent callers share one request; a failed request is not cached, so the next call retries. */
export function loadAgentCatalogue(): Promise<AgentInfo[]> {
  if (catalogue) return Promise.resolve(catalogue);
  if (catalogueRequest) return catalogueRequest;

  catalogueRequest = api.getAgents().then((response) => {
    catalogue = response.agents ?? [];
    return catalogue;
  }).finally(() => {
    catalogueRequest = null;
  });

  return catalogueRequest;
}

/** Return the cached catalogue without a request, or null before the first successful load. */
export function cachedAgentCatalogue(): AgentInfo[] | null {
  return catalogue;
}
