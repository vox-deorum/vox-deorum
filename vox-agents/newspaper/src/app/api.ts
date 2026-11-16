/**
 * Browser client for newspaper replay, saved issues, votes, and preferences.
 *
 * Requests and responses use the shared browser-safe replay and archive
 * contracts. Archive calls always carry the run and receiver scope.
 */
import type { z } from 'zod';
import { newspaperArchiveScopeSchema, type NewspaperArchiveScope } from '../../../../mcp-server/dist/newspaper/protocol.js';
import {
  replayEvidenceResponseSchema,
  replayPreferencesRequestSchema,
  replaySettingsSchema,
  replayStateSchema,
  type ReplaySettings,
  type ReplayState,
  type ReplayEvidenceResponse,
} from '../../../src/newspaper/contracts/replay.js';
import {
  archiveIssueSchema,
  archiveListSchema,
  archiveVoteRequestSchema,
  type ArchiveIssue,
  type ArchiveList,
} from '../../../src/newspaper/contracts/archive.js';

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

/** Build the query that scopes archive reads to one run and receiver. */
function scopeQuery(runId: string, receiverPlayerID: number): string {
  return new URLSearchParams({ runId, receiverPlayerID: String(receiverPlayerID) }).toString();
}

/** Read the server-owned session after a browser refresh. */
export async function getReplayState(): Promise<ReplayState> {
  return replayStateSchema.parse(await request('GET'));
}

/** Open, resume, or branch a replay run with validated serialized settings. */
export async function configureReplay(settings: ReplaySettings): Promise<ReplayState> {
  return replayStateSchema.parse(await request('PUT', '', replaySettingsSchema.parse(settings)));
}

/** Inspect the current evidence window without changing the cutoff. */
export async function inspectReplay(scope?: NewspaperArchiveScope): Promise<ReplayEvidenceResponse> {
  return replayEvidenceResponseSchema.parse(await request('POST', '/evidence', scope && newspaperArchiveScopeSchema.parse(scope)));
}

/** Advance one publication interval and receive evidence and any editorial check. */
export async function advanceReplay(scope?: NewspaperArchiveScope): Promise<ReplayEvidenceResponse> {
  return replayEvidenceResponseSchema.parse(await request('POST', '/advance', scope && newspaperArchiveScopeSchema.parse(scope)));
}

/** List generated issues for the active run and receiver. */
export async function listReplayIssues(runId: string, receiverPlayerID: number): Promise<ArchiveList> {
  return archiveListSchema.parse(await request('GET', `/issues?${scopeQuery(runId, receiverPlayerID)}`));
}

/** Read one saved issue with the votes and decision stored for its run. */
export async function getReplayIssue(issueId: string, runId: string, receiverPlayerID: number): Promise<ArchiveIssue> {
  return archiveIssueSchema.parse(await request('GET', `/issues/${encodeURIComponent(issueId)}?${scopeQuery(runId, receiverPlayerID)}`));
}

/** Save one reader vote and return the scoped session that owns it. */
export async function saveReplayVote(input: z.infer<typeof archiveVoteRequestSchema>): Promise<ReplayState> {
  return replayStateSchema.parse(await request('PUT', '/votes', archiveVoteRequestSchema.parse(input)));
}

/** Save receiver preferences and return the scoped session that owns them. */
export async function saveReplayPreferences(input: z.infer<typeof replayPreferencesRequestSchema>): Promise<ReplayState> {
  return replayStateSchema.parse(await request('PUT', '/preferences', replayPreferencesRequestSchema.parse(input)));
}
