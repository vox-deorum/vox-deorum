/** Exercise browser vote ordering and saved article inspection against controlled HTTP responses. */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page, Route } from 'playwright-core';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { readerDirectory, startNewspaperHost } from '../../../../src/newspaper/export/http.js';
import type { ReplaySettings, ReplayState } from '../../../../src/newspaper/contracts/replay.js';
import type { ArchiveIssue } from '../../../../src/newspaper/contracts/archive.js';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import { mountReplayRoutes } from '../../../../src/newspaper/replay/http.js';
import { createNewspaperIssue } from '../../../helpers/newspaper-fixtures.js';
import { createReplayRecording } from '../../../helpers/newspaper-replay.js';

/** Create one run that already has a saved issue and can advance again. */
function session(): ReplayState {
  return {
    settings: { databasePath: 'controlled.db', receiverPlayerID: 0, fromTurn: 10, toTurn: 30, publicationInterval: 5, durationUnit: 'recordedTurns', comparisonTurns: 0 },
    runId: 'run-1', outputPath: 'controlled-output.db', preferences: { frequencyStandardTurns: 5, llmEnabled: false },
    speed: { multiplier: 1, source: 'assumedStandard', recordedName: null, label: 'Controlled pace' },
    publicationIntervalTurns: 5, comparisonTurns: 0, cursor: { cutoffTurn: 10, previousCheckTurn: 9, finished: false },
  };
}

/** Create stored article metadata independently of prose shown on the reading surface. */
function savedIssue(): ArchiveIssue {
  const issue = createNewspaperIssue();
  issue.publication.title = 'Controlled edition';
  return {
    issue,
    index: { issueId: issue.issueId, runId: 'run-1', receiverPlayerID: 0, cutoffTurn: 12, title: issue.publication.title, itemCount: 1 },
    votes: {},
    decision: {
      checkId: 'controlled-check', cutoffTurn: 12, configurationId: 'controlled', configurationSnapshot: {}, seed: 'controlled', editor: 'heuristic', status: 'published',
      candidateScores: [], selectedVariants: {}, designId: 'modern', layouts: {}, evidence: [], diplomacyInference: [], triggerAudit: [], evidenceRequest: { cutoffTurn: 12, previousCheckTurn: 11, receiverPlayerID: 0 },
      feedback: { revision: '0', windowItemIds: [], votes: {}, tagCounts: {}, seriesAdjustments: {}, tagAdjustments: {}, coefficients: { series: 1, tag: 1, bound: 10, window: 50 } },
    },
    articles: [{
      id: 'shared-item', issueId: issue.issueId, turn: 12, tags: ['economy'], seriesKeys: [], templateIds: ['controlled-template'], triggerIds: ['controlled-trigger'],
      importance: 5, headline: issue.items[0].headline, evidenceSummary: 'Controlled evidence summary', sources: [{ table: 'PlayerSummaries', id: 3, turn: 12, createdAt: 123 }], fingerprint: 'controlled/12',
    }],
  };
}

/** Fulfill a browser request with the same JSON transport used by the real host. */
async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Read the controlled archive issue through the visible browser controls. */
async function openIssue(page: Page): Promise<void> {
  await page.locator('#archive-button').click();
  await page.locator('#archive-list button').filter({ hasText: 'Controlled edition' }).click();
  await page.waitForFunction(() => document.querySelector<HTMLElement>('#reader-root')?.dataset.issueId === 'issue-1');
  await page.waitForFunction(() => document.querySelector('#issue-view')?.textContent?.includes('Controlled edition'));
}

/** Send two quick user vote actions before either response is acknowledged. */
async function voteTwice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('[data-vd-region="page"]:not([hidden])')!;
    root.querySelector<HTMLButtonElement>('[data-vd-vote-value="up"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-vd-vote-value="down"]')!.click();
  });
}

describe.skipIf(!existsSync(`${readerDirectory}/index.html`))('replay browser workflow', () => {
  let browser: Browser | undefined;
  let unavailable: string | undefined;
  let host: Awaited<ReturnType<typeof startNewspaperHost>>;
  beforeAll(async () => {
    try { browser = await launchInstalledBrowser(); }
    catch (error) { unavailable = String(error); }
    host = await startNewspaperHost();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await host?.close();
  });

  it('should retain the draft evidence-only purpose after a failed resume returns to New', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    let resumeRequest: unknown;
    await page.route('**/api/newspaper/replay', async route => {
      if (route.request().method() === 'PUT') {
        resumeRequest = route.request().postDataJSON();
      }
      return json(route, { error: 'Controlled missing run' }, 409);
    });
    try {
      await page.goto(`${host.url}/newspaper/`);
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')?.disabled);
      await page.locator('[name=databasePath]').fill('controlled.db');
      await page.locator('[name=publicationEnabled]').selectOption('false');
      await page.locator('[name=mode]').selectOption('resume');
      await page.locator('[name=runId]').fill('missing-run');
      expect(await page.locator('[name=publicationEnabled]').inputValue()).toBe('true');
      expect(await page.locator('[name=publicationEnabled]').isDisabled()).toBe(true);
      await page.locator('#replay-form [type=submit]').click();
      await page.waitForFunction(() => document.querySelector('[data-replay-error]')?.textContent?.includes('Controlled missing run'));
      expect(resumeRequest).toMatchObject({ mode: 'resume', publicationEnabled: true });
      await page.locator('[name=mode]').selectOption('new');
      expect(await page.locator('[name=publicationEnabled]').inputValue()).toBe('false');
      expect(await page.locator('[name=publicationEnabled]').isEnabled()).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('should inherit configured defaults for untouched new and branch forms and save deliberate overrides', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const recording = await createReplayRecording();
    const directory = await mkdtemp(path.join(tmpdir(), 'vd-browser-preferences-'));
    await writeFile(path.join(directory, 'defaults.json'), JSON.stringify({ frequencyStandardTurns: 3, llmEnabled: true }));
    const replaySession = new ReplaySession();
    const replayHost = await startNewspaperHost({ mountApplicationRoutes: app => mountReplayRoutes(app, () => replaySession) });
    const page = await browser.newPage();
    const opened: ReplaySettings[] = [];
    page.on('request', request => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/newspaper/replay') opened.push(request.postDataJSON());
    });
    try {
      await page.goto(`${replayHost.url}/newspaper/`);
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')?.disabled);
      await page.locator('[name=databasePath]').fill(recording.filename);
      await page.locator('[name=fromTurn]').fill('10');
      await page.locator('[name=toTurn]').fill('18');
      await page.locator('[name=outputPath]').fill(path.join(directory, 'publications.sqlite'));
      await page.locator('[name=editorialConfigDirectory]').fill(directory);
      expect(await page.locator('[name=frequencyStandardTurns]').inputValue()).toBe('');
      expect(await page.locator('[name=llmEnabled]').inputValue()).toBe('');
      await page.locator('#replay-form [type=submit]').click();
      await page.locator('[data-replay=advance]:enabled').waitFor();
      const original = await replaySession.getState();
      expect(original.preferences).toEqual({ frequencyStandardTurns: 3, llmEnabled: true });
      expect(opened[0]).not.toHaveProperty('frequencyStandardTurns');
      expect(opened[0]).not.toHaveProperty('llmEnabled');
      expect(await page.locator('[name=frequencyStandardTurns]').inputValue()).toBe('3');
      expect(await page.locator('[name=llmEnabled]').inputValue()).toBe('true');

      await page.locator('[name=mode]').selectOption('branch');
      expect(await page.locator('[name=frequencyStandardTurns]').inputValue()).toBe('');
      expect(await page.locator('[name=llmEnabled]').inputValue()).toBe('');
      await page.locator('[name=branchFromRunId]').fill(original.runId!);
      await page.locator('#replay-form [type=submit]').click();
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')?.disabled);
      const branch = await replaySession.getState();
      expect(branch.runId).not.toBe(original.runId);
      expect(branch.preferences).toEqual({ frequencyStandardTurns: 3, llmEnabled: true });
      expect(opened[1]).not.toHaveProperty('frequencyStandardTurns');
      expect(opened[1]).not.toHaveProperty('llmEnabled');

      for (const name of ['fromTurn', 'toTurn', 'comparisonTurns', 'durationUnit', 'speedMultiplierOverride', 'publicationEnabled', 'editorialConfigDirectory']) {
        expect(await page.locator(`[name=${name}]`).isDisabled()).toBe(true);
      }
      for (const name of ['databasePath', 'outputPath', 'runId', 'receiverPlayerID', 'frequencyStandardTurns', 'llmEnabled']) {
        expect(await page.locator(`[name=${name}]`).isEnabled()).toBe(true);
      }
      expect(await page.locator('[name=branchFromRunId]').inputValue()).toBe('');
      await page.locator('[name=mode]').selectOption('new');
      await page.locator('[name=publicationEnabled]').selectOption('false');
      await page.locator('[name=fromTurn]').fill('99');
      await page.locator('[name=toTurn]').fill('1');
      await page.locator('[name=publicationInterval]').fill('0');
      await page.locator('[name=comparisonTurns]').fill('-1');
      await page.locator('[name=speedMultiplierOverride]').fill('-1');
      await page.locator('[name=editorialConfigDirectory]').fill(path.join(directory, 'absent-config'));
      await page.locator('[name=mode]').selectOption('resume');
      expect(await page.locator('[name=publicationEnabled]').inputValue()).toBe('true');
      await page.locator('[name=frequencyStandardTurns]').fill('8');
      await page.locator('[name=llmEnabled]').selectOption('false');
      await page.locator('#replay-form [type=submit]').click();
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')?.disabled);
      expect(opened[2].mode).toBe('resume');
      expect(opened[2]).not.toHaveProperty('frequencyStandardTurns');
      expect(opened[2]).not.toHaveProperty('llmEnabled');
      expect(opened[2]).not.toHaveProperty('branchFromRunId');
      expect(opened[2]).not.toHaveProperty('speedMultiplierOverride');
      expect(opened[2]).not.toHaveProperty('editorialConfigDirectory');
      expect(opened[2].publicationEnabled).toBe(true);
      const resumed = await replaySession.getState();
      expect(resumed.runId).toBe(branch.runId);
      expect(resumed.settings).toEqual(branch.settings);
      expect(resumed.preferences).toEqual({ frequencyStandardTurns: 3, llmEnabled: true });

      await page.locator('[name=mode]').selectOption('new');
      expect(await page.locator('[name=frequencyStandardTurns]').inputValue()).toBe('');
      expect(await page.locator('[name=llmEnabled]').inputValue()).toBe('');
      expect(await page.locator('[name=branchFromRunId]').inputValue()).toBe('');
      expect(await page.locator('[name=fromTurn]').isEnabled()).toBe(true);
      expect(await page.locator('[name=editorialConfigDirectory]').isEnabled()).toBe(true);
      expect(await page.locator('[name=publicationEnabled]').inputValue()).toBe('true');
      await page.locator('[name=frequencyStandardTurns]').fill('7');
      await page.locator('[name=llmEnabled]').selectOption('false');
      await page.locator('#replay-form [type=submit]').click();
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')?.disabled);
      expect((await replaySession.getState()).preferences).toEqual({ frequencyStandardTurns: 7, llmEnabled: false });
      expect(opened[3]).toMatchObject({ frequencyStandardTurns: 7, llmEnabled: false });
      expect(opened[3]).not.toHaveProperty('branchFromRunId');

      await page.locator('[name=frequencyStandardTurns]').fill('4');
      await page.locator('[name=llmEnabled]').selectOption('true');
      await page.locator('[data-replay=save-preferences]').click();
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')?.disabled);
      expect((await replaySession.getState()).preferences).toEqual({ frequencyStandardTurns: 4, llmEnabled: true });
    } finally {
      await page.close();
      await replaySession.close();
      await replayHost.close();
      await recording.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('should keep queued votes across issue switches and finish them before the next check', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    const state = session();
    const detail = savedIssue();
    const requests: string[] = [];
    let releaseVote!: () => void;
    const firstVote = new Promise<void>(resolve => { releaseVote = resolve; });
    let votes = 0;
    await page.route('**/api/newspaper/replay**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/votes')) {
        const input = route.request().postDataJSON();
        requests.push(`vote:${input.value}`);
        votes += 1;
        if (votes === 1) await firstVote;
        detail.votes[input.itemId] = input.value;
        return json(route, state);
      }
      if (pathname.endsWith('/advance')) {
        requests.push(`advance:${detail.votes['shared-item']}`);
        expect(route.request().postDataJSON()).toEqual({ runId: 'run-1', receiverPlayerID: 0 });
        state.cursor.cutoffTurn = 15;
        return json(route, { session: state, evidence: { request: { receiverPlayerID: 0, cutoffTurn: 15, previousCheckTurn: 10 }, players: [], cities: [], comparisons: { players: [], cities: [] }, events: [] } });
      }
      if (pathname.endsWith('/issues')) return json(route, { issues: [detail.index] });
      if (pathname.includes('/issues/')) return json(route, detail);
      return json(route, state);
    });
    try {
      await page.goto(`${host.url}/newspaper/`);
      await page.locator('[data-replay="advance"]:enabled').waitFor();
      await openIssue(page);
      expect(await page.locator('#page-items').textContent()).toContain(detail.articles[0].templateIds[0]);
      expect(await page.locator('#page-items').textContent()).toContain(detail.articles[0].evidenceSummary);
      expect(JSON.parse((await page.locator('[data-article-sources]').first().textContent())!)).toEqual({ triggers: detail.articles[0].triggerIds, sources: detail.articles[0].sources });
      await voteTwice(page);
      await page.locator('#fixture-select').selectOption('modern-ordinary');
      await page.locator('[data-replay="advance"]').click();
      await page.waitForFunction(() => document.querySelector<HTMLElement>('#reader-root')?.inert === true);
      expect(requests).toEqual(['vote:1']);
      releaseVote();
      await page.waitForFunction(() => !document.querySelector<HTMLElement>('#reader-root')?.inert);
      expect(requests).toEqual(['vote:1', 'vote:-1', 'advance:-1']);
      await openIssue(page);
      expect(await page.locator('[data-vd-region="page"]:not([hidden]) [data-vd-vote-value="down"]').getAttribute('aria-pressed')).toBe('true');
    } finally {
      releaseVote();
      await page.close();
    }
  }, 60_000);

  it('should let later rapid votes finish after a failure and restore server values once the queue drains', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    const detail = savedIssue();
    let votes = 0;
    let issueReads = 0;
    await page.route('**/api/newspaper/replay**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/votes')) {
        votes += 1;
        if (votes === 1) return json(route, { error: 'Controlled save failure' }, 500);
        const input = route.request().postDataJSON();
        detail.votes[input.itemId] = input.value;
        return json(route, session());
      }
      if (pathname.endsWith('/issues')) return json(route, { issues: [detail.index] });
      if (pathname.includes('/issues/')) { issueReads += 1; return json(route, detail); }
      return json(route, session());
    });
    try {
      await page.goto(`${host.url}/newspaper/`);
      await page.locator('[data-replay="advance"]:enabled').waitFor();
      await openIssue(page);
      await voteTwice(page);
      await page.waitForFunction(() => document.querySelector('[data-replay-error]')?.textContent?.includes('Controlled save failure'));
      await page.waitForFunction(() => !document.querySelector<HTMLElement>('#reader-root')?.inert);
      await page.waitForFunction(() => document.querySelector('[data-vd-region="page"]:not([hidden]) [data-vd-vote-value="down"]')?.getAttribute('aria-pressed') === 'true');
      expect(votes).toBe(2);
      expect(issueReads).toBe(2);
      expect(detail.votes['shared-item']).toBe(-1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('should allow evidence-only session controls without inventing a publication scope', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    const state = session();
    delete state.runId;
    delete state.outputPath;
    delete state.preferences;
    state.settings.publicationEnabled = false;
    let advanced = false;
    await page.route('**/api/newspaper/replay**', async route => {
      if (new URL(route.request().url()).pathname.endsWith('/advance')) {
        expect(route.request().postData()).toBeNull();
        advanced = true;
        return json(route, { session: state, evidence: { request: { receiverPlayerID: 0, cutoffTurn: 15, previousCheckTurn: 10 }, players: [], cities: [], comparisons: { players: [], cities: [] }, events: [] } });
      }
      return json(route, state);
    });
    try {
      await page.goto(`${host.url}/newspaper/`);
      await page.locator('[data-replay="advance"]:enabled').waitFor();
      expect(await page.locator('[data-replay="save-preferences"]').isDisabled()).toBe(true);
      expect(await page.locator('[data-evidence-interval]').isVisible()).toBe(true);
      await page.locator('[data-replay="advance"]').click();
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')?.disabled);
      expect(advanced).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);
});
