import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceReplay,
  configureReplay,
  getReplayIssue,
  getReplayState,
  inspectReplay,
  listReplayIssues,
  ReplayApiError,
  saveReplayPreferences,
  saveReplayVote,
} from '../../../../newspaper/src/app/api.js';
import type { ReplaySettings } from '../../../../src/newspaper/contracts/replay.js';
import { createNewspaperIssue } from '../../../helpers/newspaper-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

/** Build one valid replay session whose scope can be checked without a server. */
function replayState() {
  return {
    settings: {
      databasePath: 'recording.db',
      receiverPlayerID: 4,
      fromTurn: 10,
      toTurn: 30,
      publicationInterval: 5,
      durationUnit: 'recordedTurns',
      comparisonTurns: 10,
      mode: 'new',
      outputPath: 'C:/newspaper/store',
      runId: 'run-1',
      frequencyStandardTurns: 5,
      llmEnabled: false,
    },
    speed: { multiplier: 1, source: 'assumedStandard', recordedName: null, label: 'Standard assumption' },
    publicationIntervalTurns: 5,
    comparisonTurns: 10,
    cursor: { cutoffTurn: 15, previousCheckTurn: 14, finished: false },
    runId: 'run-1',
    outputPath: 'C:/newspaper/store',
    preferences: { frequencyStandardTurns: 5, llmEnabled: false },
  };
}

/** Build a complete editorial decision record for saved issue and check responses. */
function decisionRecord() {
  return {
    checkId: 'check-1',
    cutoffTurn: 12,
    configurationId: 'defaults',
    configurationSnapshot: {},
    seed: 'seed-1',
    editor: 'heuristic',
    status: 'published',
    candidateScores: [],
    merges: [],
    selectedVariants: {},
    designId: 'modern',
    layouts: { front: 'ordinary' },
    evidence: [],
    diplomacyInference: [], triggerAudit: [], evidenceRequest: { cutoffTurn: 12, previousCheckTurn: 11, receiverPlayerID: 4 },
    feedback: {
      revision: '1',
      windowItemIds: [],
      votes: {},
      tagCounts: {},
      seriesAdjustments: {},
      tagAdjustments: {},
      coefficients: { series: 0.5, tag: 0.25, bound: 1, window: 50 },
    },
  };
}

/** Build the empty evidence envelope accepted by the shared MCP contract. */
function replayEvidence() {
  return {
    request: { receiverPlayerID: 4, cutoffTurn: 15, previousCheckTurn: 14 },
    players: [],
    cities: [],
    comparisons: { players: [], cities: [] },
    events: [],
  };
}

/** Stub fetch with one JSON response and return the call mock. */
function stubJson(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Read the JSON request body sent to a stub. */
function requestBody(fetchMock: ReturnType<typeof stubJson>): unknown {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe('replay browser API', () => {
  it.each([200, 404, 500])('should report a non-JSON host response with HTTP status %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Host page</html>', {
      status, headers: { 'Content-Type': 'text/html' }
    })));
    const error = await getReplayState().catch(error => error);
    expect(error).toBeInstanceOf(ReplayApiError);
    expect(error.status).toBe(status);
    expect(error.message).toEqual(expect.any(String));
  });

  it('should preserve the JSON error envelope and status', async () => {
    const message = 'Recording unavailable';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: message }, { status: 409 })));
    const error = await getReplayState().catch(error => error);
    expect(error).toBeInstanceOf(ReplayApiError);
    expect(error).toMatchObject({ message, status: 409 });
  });

  it('should send branch open settings to the replay root without dropping run fields', async () => {
    const fetchMock = stubJson(replayState());
    const settings: ReplaySettings = {
      databasePath: 'recording.db',
      receiverPlayerID: 4,
      fromTurn: 10,
      toTurn: 30,
      publicationInterval: 5,
      comparisonTurns: 0,
      durationUnit: 'recordedTurns',
      mode: 'branch',
      branchFromRunId: 'run-0',
      runId: 'run-1',
      outputPath: 'C:/newspaper/store',
      editorialConfigDirectory: 'C:/newspaper/config',
      frequencyStandardTurns: 7,
      llmEnabled: true,
    };
    const state = await configureReplay(settings);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/newspaper/replay');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
    expect(requestBody(fetchMock)).toEqual(settings);
    expect(state).toMatchObject({ runId: 'run-1', outputPath: 'C:/newspaper/store' });
    expect(state.preferences).toEqual({ frequencyStandardTurns: 5, llmEnabled: false });
  });

  it('should scope generated issue listings by run and receiver', async () => {
    const fetchMock = stubJson({ issues: [{
      issueId: 'issue-1', runId: 'run-1', receiverPlayerID: 4,
      cutoffTurn: 15, title: 'The Daily Deorum', itemCount: 1,
    }] });
    const result = await listReplayIssues('run-1', 4);

    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/newspaper/replay/issues?runId=run-1&receiverPlayerID=4',
      { method: 'GET' },
    ]);
    expect(result.issues[0]).toMatchObject({ issueId: 'issue-1', receiverPlayerID: 4, itemCount: 1 });
  });

  it('should scope and encode saved issue reads with stored votes and decision', async () => {
    const issue = createNewspaperIssue();
    const article = {
      id: 'shared-item', issueId: issue.issueId, turn: 12, tags: ['economy'], seriesKeys: [],
      templateIds: ['trade-report'], triggerIds: ['trade-change'], importance: 5,
      headline: issue.items[0].headline, evidenceSummary: 'Observed trade change', sources: [{ table: 'PlayerSummaries', id: 3, turn: 12, createdAt: 123 }], fingerprint: 'trade/12',
    };
    const fetchMock = stubJson({
      index: {
        issueId: issue.issueId, runId: 'run-1', receiverPlayerID: 4,
        cutoffTurn: 12, title: 'The Daily Deorum', itemCount: 1,
      },
      issue,
      votes: { 'shared-item': -1 },
      decision: decisionRecord(),
      articles: [article],
    });
    const detail = await getReplayIssue('issue/1', 'run-1', 4);

    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/newspaper/replay/issues/issue%2F1?runId=run-1&receiverPlayerID=4',
      { method: 'GET' },
    ]);
    expect(detail.votes).toEqual({ 'shared-item': -1 });
    expect(detail.index).toMatchObject({ runId: 'run-1', receiverPlayerID: 4 });
    expect(detail.decision).toMatchObject({ checkId: 'check-1' });
    expect(detail.articles).toEqual([article]);
  });

  it('should save a scoped vote with its numeric value and return the session', async () => {
    const fetchMock = stubJson(replayState());
    const input = { itemId: 'shared-item', value: -1 as const, runId: 'run-1', receiverPlayerID: 4 };
    const state = await saveReplayVote(input);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/newspaper/replay/votes');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
    expect(requestBody(fetchMock)).toEqual(input);
    expect(state.runId).toBe('run-1');
  });

  it('should save scoped preferences and return the updated session', async () => {
    const fetchMock = stubJson({
      ...replayState(),
      preferences: { frequencyStandardTurns: 8, llmEnabled: true },
    });
    const input = { frequencyStandardTurns: 8, llmEnabled: true, runId: 'run-1', receiverPlayerID: 4 };
    const state = await saveReplayPreferences(input);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/newspaper/replay/preferences');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
    expect(requestBody(fetchMock)).toEqual(input);
    expect(state.preferences).toEqual({ frequencyStandardTurns: 8, llmEnabled: true });
  });

  it('should scope an evidence read to the active run and receiver', async () => {
    const fetchMock = stubJson({ session: replayState(), evidence: replayEvidence() });
    const scope = { runId: 'run-1', receiverPlayerID: 4 };
    const result = await inspectReplay(scope);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/newspaper/replay/evidence');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(requestBody(fetchMock)).toEqual(scope);
    expect(result.evidence.request.receiverPlayerID).toBe(4);
  });

  it('should accept an advance that includes a published check', async () => {
    const issue = createNewspaperIssue();
    const scope = { runId: 'run-1', receiverPlayerID: 4 };
    const fetchMock = stubJson({
      session: replayState(),
      evidence: replayEvidence(),
      check: {
        status: 'published',
        issue,
        decision: decisionRecord(),
      },
    });
    const result = await advanceReplay(scope);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/newspaper/replay/advance');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(requestBody(fetchMock)).toEqual(scope);
    expect(result.check?.status).toBe('published');
    expect(result.check?.issue?.issueId).toBe('issue-1');
    expect(result.session.cursor.cutoffTurn).toBe(15);
  });

  it('should accept evidence-only session state without publication scope or preferences', async () => {
    const { runId: _runId, outputPath: _outputPath, preferences: _preferences, ...state } = replayState();
    state.settings = { ...state.settings, publicationEnabled: false } as typeof state.settings;
    const fetchMock = stubJson({ session: state, evidence: replayEvidence() });
    const result = await advanceReplay();
    expect(result.session.runId).toBeUndefined();
    expect(result.session.preferences).toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual(['/api/newspaper/replay/advance', { method: 'POST' }]);
  });
});
