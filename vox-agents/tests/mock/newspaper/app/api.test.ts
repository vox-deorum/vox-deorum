import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  advanceReplay,
  configureReplay,
  getCheckCoverage,
  getReplayCoverage,
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

  it('should scope and encode saved issue reads with stored votes and article provenance', async () => {
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
      articles: [article],
    });
    const detail = await getReplayIssue('issue/1', 'run-1', 4);

    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/newspaper/replay/issues/issue%2F1?runId=run-1&receiverPlayerID=4',
      { method: 'GET' },
    ]);
    expect(detail.votes).toEqual({ 'shared-item': -1 });
    expect(detail.index).toMatchObject({ runId: 'run-1', receiverPlayerID: 4 });
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

  it('should request a compact advance and return the published issue ID', async () => {
    const issueId = 'issue-1';
    const scope = { runId: 'run-1', receiverPlayerID: 4 };
    const fetchMock = stubJson({
      session: replayState(),
      check: {
        status: 'published',
        issueId,
      },
    });
    const result = await advanceReplay(scope);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/newspaper/replay/advance?view=summary');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(requestBody(fetchMock)).toEqual(scope);
    expect(result.check?.status).toBe('published');
    expect(result.check?.issueId).toBe(issueId);
    expect(result.session.cursor.cutoffTurn).toBe(15);
  });

  it('should accept evidence-only session state without publication scope or preferences', async () => {
    const { runId: _runId, outputPath: _outputPath, preferences: _preferences, ...state } = replayState();
    state.settings = { ...state.settings, publicationEnabled: false } as typeof state.settings;
    const fetchMock = stubJson({ session: state });
    const result = await advanceReplay();
    expect(result.session.runId).toBeUndefined();
    expect(result.session.preferences).toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual(['/api/newspaper/replay/advance?view=summary', { method: 'POST' }]);
  });
  it('should scope run coverage reads and parse template stages and rule funnels', async () => {
    const funnel = { partial: 0, matched: 0, unprintable: 0, ineligible: 0, zeroWeight: 0, noVariants: 0, candidates: 0 };
    const fetchMock = stubJson({
      checks: 2, published: 1, turns: { from: 10, to: 15 }, uncoveredIssues: 0,
      templates: [{
        id: 'siege-report', desk: 'cities-conflict', tags: ['cities'], rules: ['city-under-siege'], stage: 'not-fired',
        printed: 0, funnel, outcomes: {}, scoreTurn: null, bestScore: null, floor: null, printedTurns: [],
      }],
      rules: [{
        id: 'city-under-siege', subject: 'city', checks: 2, subjects: 40, fired: 0, firedChecks: 0,
        stops: [{ key: 'false:0', kind: 'false', guard: 0, source: 'city.is.besieged', reached: 40, count: 40 }],
      }],
    });
    const result = await getReplayCoverage('run-1', 4);

    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/newspaper/replay/coverage?runId=run-1&receiverPlayerID=4',
      { method: 'GET' },
    ]);
    expect(result.templates[0]).toMatchObject({ id: 'siege-report', stage: 'not-fired' });
    expect(result.rules[0].stops[0]).toMatchObject({ guard: 0, count: 40 });
  });

  it('should read one check cutoff and preserve a missing-coverage status', async () => {
    const fetchMock = stubJson({
      turn: 15, status: 'published', printedFloor: 58, rules: {}, templates: {},
      candidates: [{ id: 'c1', template: 'siege-report', subject: 'city:3', rules: ['city-under-siege'], importance: 3, score: 41, outcome: 'outranked' }],
    });
    const result = await getCheckCoverage(15, 'run-1', 4);
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/newspaper/replay/coverage/15?runId=run-1&receiverPlayerID=4',
      { method: 'GET' },
    ]);
    expect(result.candidates[0]).toMatchObject({ outcome: 'outranked', score: 41 });

    stubJson({ error: 'No coverage for this check' }, 404);
    const error = await getCheckCoverage(10, 'run-1', 4).catch(error => error);
    expect(error).toBeInstanceOf(ReplayApiError);
    expect(error.status).toBe(404);
  });
});
