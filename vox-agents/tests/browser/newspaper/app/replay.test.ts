/** Exercise shared newspaper reading and recording generation in an installed browser. */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page, Route } from 'playwright-core';
import { createNewspaperPreview } from '../../../../src/newspaper/cli/preview.js';
import type { ArchiveIssue } from '../../../../src/newspaper/contracts/archive.js';
import type { ReplaySettings, ReplayState } from '../../../../src/newspaper/contracts/replay.js';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { readerDirectory, startNewspaperHost } from '../../../../src/newspaper/export/http.js';
import { mountReplayRoutes } from '../../../../src/newspaper/replay/http.js';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import { createNewspaperIssue } from '../../../helpers/newspaper-fixtures.js';
import { createReplayRecording, writeReplayPublicationCatalogue } from '../../../helpers/newspaper-replay.js';

/** Make an unfinished run ready to check its next cutoff. */
function session(): ReplayState {
  return {
    settings: { databasePath: 'controlled.db', receiverPlayerID: 0, fromTurn: 10, toTurn: 15, publicationInterval: 5, durationUnit: 'recordedTurns', comparisonTurns: 0 },
    runId: 'run-1', outputPath: 'controlled-output.db', preferences: { frequencyStandardTurns: 5, llmEnabled: false },
    speed: { multiplier: 1, source: 'assumedStandard', recordedName: null, label: 'Controlled pace' },
    publicationIntervalTurns: 5, comparisonTurns: 0, cursor: { cutoffTurn: 10, previousCheckTurn: 9, finished: false },
  };
}

/** Create an edition with independent article provenance for the browser to display. */
function savedIssue(): ArchiveIssue {
  const issue = createNewspaperIssue();
  return {
    issue,
    index: { issueId: issue.issueId, runId: 'run-1', receiverPlayerID: 0, cutoffTurn: 12, title: issue.publication.title, itemCount: 1 },
    votes: {},
    decision: {
      checkId: 'controlled-check', cutoffTurn: 12, configurationId: 'controlled', configurationSnapshot: {}, seed: 'controlled', editor: 'heuristic', status: 'published',
      candidateScores: [], selectedVariants: {}, designId: 'wire', layouts: {}, evidence: [], diplomacyInference: [], triggerAudit: [], evidenceRequest: { cutoffTurn: 12, previousCheckTurn: 11, receiverPlayerID: 0 },
      feedback: { revision: '0', windowItemIds: [], votes: {}, tagCounts: {}, seriesAdjustments: {}, tagAdjustments: {}, coefficients: { series: 1, tag: 1, bound: 10, window: 50 } },
    },
    articles: [{
      id: 'shared-item', issueId: issue.issueId, turn: 12, tags: ['economy'], seriesKeys: [], templateIds: ['controlled-template'], triggerIds: ['controlled-trigger'],
      importance: 5, headline: issue.items[0].headline, evidenceSummary: 'Controlled evidence summary', sources: [{ table: 'PlayerSummaries', id: 3, turn: 12, createdAt: 123 }], fingerprint: 'controlled/12',
    }],
  };
}

/** Fulfill a request with the real host's transport. */
async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, json: body });
}

/** Open the saved mode and wait for the currently selected edition. */
async function openRecorded(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Recorded', exact: true }).click();
  await page.locator('#replay-generate:enabled').waitFor();
}

/** Open Recording and a nested set of options when needed. */
async function recordingOptions(page: Page, nested?: 'Advanced' | 'Saved run'): Promise<void> {
  const settings = page.locator('#recording-details');
  if ((await settings.getAttribute('open')) === null) await settings.locator(':scope > summary').click();
  if (nested) {
    const summary = settings.locator('summary').filter({ hasText: nested });
    if (!(await summary.evaluate(node => (node.parentElement as HTMLDetailsElement).open))) await summary.click();
  }
}

/** Tap two votes before either request can be acknowledged. */
async function voteTwice(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('[data-vd-region="page"]:not([hidden])')!;
    root.querySelector<HTMLButtonElement>('[data-vd-vote-value="up"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-vd-vote-value="down"]')!.click();
  });
}

/** Wait for the current computation to finish or stop. */
async function settled(page: Page): Promise<void> {
  await page.locator('#replay-generate:enabled').waitFor();
  expect(await page.locator('[data-replay-error]').isVisible()).toBe(false);
}

describe.skipIf(!existsSync(path.join(readerDirectory, 'index.html')))('replay browser workflow', () => {
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

  for (const kind of ['preview', 'built'] as const) {
  it(`should generate, stop, continue and resume from the ${kind} host`, async context => {
    if (!browser) { context.skip(unavailable); return; }
    const recording = await createReplayRecording();
    const state = kind === 'built' ? new ReplaySession() : undefined;
    const replayHost = state
      ? await startNewspaperHost({ mountApplicationRoutes: app => mountReplayRoutes(app, () => state) })
      : await createNewspaperPreview({ port: 0 });
    const origin = replayHost.url;
    const url = `${origin}${state ? '/newspaper/' : '/preview.html'}`;
    const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
    const output = path.join(path.dirname(recording.filename), 'run.sqlite');
    const catalogue = await writeReplayPublicationCatalogue(recording.filename);
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    const second = new Promise<void>(resolve => { releaseSecond = resolve; });
    let held = 0;
    const cutoffs: number[] = [];
    const configurations: ReplaySettings[] = [];
    await page.route('**/api/newspaper/replay/advance?view=summary', async route => {
      held += 1;
      if (held === 1) await first;
      if (held === 2) await second;
      const response = await route.fetch();
      const value = await response.json();
      cutoffs.push(value.session.cursor.cutoffTurn);
      await route.fulfill({ response, json: value });
    });
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/newspaper/replay' && request.method() === 'PUT') configurations.push(request.postDataJSON());
    });
    try {
      await page.goto(url);
      await page.locator('#reader-root[data-issue-id^=preview-] .vd-headline').first().waitFor();
      const design = page.locator('#preview-design');
      await page.locator('#preview-tint').selectOption('#b22222');
      await design.focus();
      await page.keyboard.press('ArrowDown');
      await page.locator('#reader-root[data-issue-id^=preview-] .vd-headline').first().waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await openRecorded(page);
      await recordingOptions(page, 'Saved run');
      await page.locator('[name=databasePath]').fill(recording.filename);
      await page.locator('[name=outputPath]').fill(output);
      await page.locator('[name=fromTurn]').fill('6');
      await page.locator('[name=toTurn]').fill('23');
      await recordingOptions(page, 'Advanced');
      await page.locator('[name=editorialConfigDirectory]').fill(catalogue);
      const firstRequest = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/advance'));
      await page.locator('#replay-generate').click();
      await firstRequest;
      await page.locator('#replay-stop').click();
      releaseFirst();
      await settled(page);
      expect(cutoffs).toEqual([6]);
      await page.locator('.vd-headline').filter({ hasText: 'War declared' }).first().waitFor();
      const firstId = await page.locator('#recorded-edition').inputValue();
      const vote = page.locator('[data-vd-region=page]:not([hidden]) [data-vd-vote-value=up]').first();
      await vote.click();
      expect(await vote.getAttribute('aria-pressed')).toBe('true');

      await page.locator('#replay-continue').click();
      await page.getByRole('button', { name: 'Mockups', exact: true }).click();
      await page.locator('#reader-root[data-issue-id^=preview-]').waitFor();
      await openRecordedWhileGenerating(page);
      await page.locator(`#reader-root[data-issue-id="${firstId}"]`).waitFor();
      await page.locator('#recorded-edition').focus();
      releaseSecond();
      await settled(page);
      expect(cutoffs).toEqual([6, 14, 22, 23]);
      expect(await page.locator('#recorded-edition').inputValue()).toBe(firstId);
      expect(await page.locator('#recorded-edition').evaluate(node => node === document.activeElement)).toBe(true);
      expect(await page.locator('#replay-diagnostics').getAttribute('open')).toBeNull();

      await page.locator('#replay-diagnostics > summary').click();
      await page.locator('[data-replay=inspect]').click();
      await page.locator('#evidence-view').getByText('Inspected cutoff: turn 23.').waitFor();
      await page.locator('#page-items summary').filter({ hasText: 'War declared' }).click();
      await page.locator('[data-article-sources]').waitFor();
      await recordingOptions(page, 'Saved run');
      const runId = await page.locator('[name=runId]').inputValue();
      expect(runId).toBeTruthy();
      await page.locator('#replay-resume').click();
      await settled(page);
      expect(configurations.at(-1)).toMatchObject({ mode: 'resume', runId, outputPath: output });
      expect(cutoffs).toHaveLength(4);
      await page.locator('#recorded-edition').selectOption(firstId);
      await page.locator(`#reader-root[data-issue-id="${firstId}"]`).waitFor();
      expect(await vote.getAttribute('aria-pressed')).toBe('true');
      expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
    } finally {
      releaseFirst();
      releaseSecond();
      await page.close();
      await state?.close();
      await replayHost.close();
      await recording.cleanup();
    }
  }, 60_000);
  }

  it('should drain queued votes in order before advancing even after switching to mockups', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    const state = session();
    const detail = savedIssue();
    const requests: string[] = [];
    let releaseVote!: () => void;
    const votePending = new Promise<void>(resolve => { releaseVote = resolve; });
    await page.route('**/api/newspaper/replay**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/votes')) {
        const input = route.request().postDataJSON();
        requests.push(`vote:${input.value}`);
        if (requests.length === 1) await votePending;
        detail.votes[input.itemId] = input.value;
        return json(route, state);
      }
      if (pathname.endsWith('/advance')) {
        requests.push(`advance:${detail.votes['shared-item']}`);
        expect(route.request().postDataJSON()).toEqual({ runId: 'run-1', receiverPlayerID: 0 });
        state.cursor = { cutoffTurn: 15, previousCheckTurn: 10, finished: true };
        return json(route, { session: state, check: { status: 'skipped', reason: 'Controlled quiet turn' } });
      }
      if (pathname.endsWith('/issues')) return json(route, { issues: [detail.index] });
      if (pathname.includes('/issues/')) return json(route, detail);
      return json(route, state);
    });
    try {
      await page.goto(`${host.url}/newspaper/`);
      await openRecorded(page);
      await page.locator('#reader-root[data-issue-id="issue-1"]').waitFor();
      const firstRequest = page.waitForRequest(request => request.url().endsWith('/votes'));
      await voteTwice(page);
      await firstRequest;
      await page.locator('#replay-continue').click();
      await page.getByRole('button', { name: 'Mockups', exact: true }).click();
      await page.locator('#reader-root[data-issue-id^=preview-]').waitFor();
      expect(requests).toEqual(['vote:1']);
      releaseVote();
      await openRecordedWhileGenerating(page);
      await settled(page);
      expect(requests).toEqual(['vote:1', 'vote:-1', 'advance:-1']);
      expect(await page.locator('#replay-status').textContent()).toContain('No editions published');
      await page.locator('#replay-diagnostics > summary').click();
      await page.locator('#check-view').getByText('Turn 15: Controlled quiet turn').waitFor();
      await page.locator('[data-vd-region=page]:not([hidden]) [data-vd-vote-value=down][aria-pressed=true]').waitFor();
    } finally {
      releaseVote();
      await page.close();
    }
  }, 60_000);

  it('should keep later rapid votes after a failure and restore server values', async context => {
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
      await openRecorded(page);
      await page.locator('#reader-root[data-issue-id="issue-1"]').waitFor();
      await page.getByRole('tab', { name: 'Analysis' }).click();
      await voteTwice(page);
      await page.locator('#reader-note').getByText(/Controlled save failure/).waitFor();
      await expect.poll(() => issueReads).toBe(2);
      expect(await page.getByRole('tab', { name: 'Analysis' }).getAttribute('aria-selected')).toBe('true');
      expect(votes).toBe(2);
      expect(detail.votes['shared-item']).toBe(-1);
    } finally { await page.close(); }
  }, 60_000);
});

/** Switch back to recorded reading without waiting for the active batch to finish. */
async function openRecordedWhileGenerating(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Recorded', exact: true }).click();
  await page.locator('#recorded-edition').waitFor();
}
