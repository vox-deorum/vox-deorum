import { replayStateSchema, replayEvidenceResponseSchema, type ReplaySettings, type ReplayState, type ReplayEvidenceResponse } from '../../../src/newspaper/contracts/replay.js';

/** Preserve HTTP status so controls can distinguish an empty session from an unavailable host. */
export class ReplayApiError extends Error {
  /** Carry the server's response status alongside its readable error. */
  constructor(message: string, readonly status: number) { super(message); }
}

/** Send one local replay request and surface the server's JSON error envelope. */
async function request(method: string, suffix = '', body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/newspaper/replay${suffix}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new ReplayApiError(`Replay host returned a non-JSON response (${response.status}). Start the normal VD server and open its /newspaper/ page.`, response.status);
  }
  if (!response.ok) throw new ReplayApiError(result.error ?? `Replay request failed (${response.status}).`, response.status);
  return result;
}

/** Read the server-owned session after a browser refresh. */
export async function getReplayState(): Promise<ReplayState> {
  return replayStateSchema.parse(await request('GET'));
}

/** Open or replace a replay recording with validated serialized settings. */
export async function configureReplay(settings: ReplaySettings): Promise<ReplayState> {
  return replayStateSchema.parse(await request('PUT', '', settings));
}

/** Inspect the current evidence window without changing the cutoff. */
export async function inspectReplay(): Promise<ReplayEvidenceResponse> {
  return replayEvidenceResponseSchema.parse(await request('POST', '/evidence'));
}

/** Advance one publication interval and receive evidence for the accepted cutoff. */
export async function advanceReplay(): Promise<ReplayEvidenceResponse> {
  return replayEvidenceResponseSchema.parse(await request('POST', '/advance'));
}
