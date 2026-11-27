/**
 * Browser client for newspaper replay, saved issues, votes, and preferences.
 *
 * Requests and responses use the shared browser-safe replay and archive
 * contracts. Archive and coverage calls always carry the run and receiver scope.
 */
import type { z } from 'zod';
import { newspaperArchiveScopeSchema, type NewspaperArchiveScope } from '../../../../mcp-server/dist/newspaper/protocol.js';
import {
  latestRecordingSchema,
  replayAdvanceSummaryResponseSchema,
  replayEvidenceResponseSchema,
  replayPreferencesRequestSchema,
  replaySettingsSchema,
  replayStateSchema,
  type ReplaySettings,
  type ReplayState,
  type ReplayAdvanceSummaryResponse,
  type ReplayEvidenceResponse,
} from '../../../src/newspaper/contracts/replay.js';
import {
  archiveIssueSchema,
  archiveListSchema,
  archiveVoteRequestSchema,
  type ArchiveIssue,
  type ArchiveList,
} from '../../../src/newspaper/contracts/archive.js';
import {
  checkCoverageSchema,
  runCoverageSchema,
  type CheckCoverage,
  type RunCoverage,
} from '../../../src/newspaper/contracts/coverage.js';

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
    throw new ReplayApiError(`Replay host returned a non-JSON response (${response.status}). Open the newspaper from the preview command or the Vox Deorum server.`, response.status);
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

/** Look up the newest archived recording without changing the active run. */
export async function getLatestRecording(): Promise<string | null> {
  const result = latestRecordingSchema.parse(await request('GET', '/latest-recording'));
  return result.databasePath;
}

/** Open, resume, or branch a replay run with validated serialized settings. */
export async function configureReplay(settings: ReplaySettings): Promise<ReplayState> {
  return replayStateSchema.parse(await request('PUT', '', replaySettingsSchema.parse(settings)));
}

/** Inspect the current evidence window without changing the cutoff. */
export async function inspectReplay(scope?: NewspaperArchiveScope): Promise<ReplayEvidenceResponse> {
  return replayEvidenceResponseSchema.parse(await request('POST', '/evidence', scope && newspaperArchiveScopeSchema.parse(scope)));
}

/** Advance one publication interval without downloading evidence or the full audit. */
export async function advanceReplay(scope?: NewspaperArchiveScope): Promise<ReplayAdvanceSummaryResponse> {
  return replayAdvanceSummaryResponseSchema.parse(await request('POST', '/advance?view=summary', scope && newspaperArchiveScopeSchema.parse(scope)));
}

/** List generated issues for the active run and receiver. */
export async function listReplayIssues(runId: string, receiverPlayerID: number): Promise<ArchiveList> {
  return archiveListSchema.parse(await request('GET', `/issues?${scopeQuery(runId, receiverPlayerID)}`));
}

/** Read one saved issue with its article provenance and current votes. */
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

/** Read where each authored template stopped on its way to print across the run. */
export async function getReplayCoverage(runId: string, receiverPlayerID: number): Promise<RunCoverage> {
  return runCoverageSchema.parse(await request('GET', `/coverage?${scopeQuery(runId, receiverPlayerID)}`));
}

/** Read every candidate the editor saw at one check cutoff, with its outcome and score. */
export async function getCheckCoverage(turn: number, runId: string, receiverPlayerID: number): Promise<CheckCoverage> {
  return checkCoverageSchema.parse(await request('GET', `/coverage/${turn}?${scopeQuery(runId, receiverPlayerID)}`));
}
