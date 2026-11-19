import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { createReplayRecording, writeReplayPublicationCatalogue } from '../../../helpers/newspaper-replay.js';
import { parseNewspaperOptions, type NewspaperCliOptions } from '../../../../src/newspaper/cli/options.js';
import { newspaperReportHtml, runNewspaperReplay, type NewspaperRunManifest } from '../../../../src/newspaper/cli/replay.js';
import type { ArchiveIssue } from '../../../../src/newspaper/contracts/archive.js';
import { issueDocumentSchema } from '../../../../src/newspaper/contracts/issue.js';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { readerDirectory } from '../../../../src/newspaper/export/http.js';
import * as renderer from '../../../../src/newspaper/cli/render.js';

/** A valid one-pixel PNG so the saved report can display a real image. */
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Read the published archives saved by a completed replay run. */
async function savedArchives(manifest: NewspaperRunManifest): Promise<ArchiveIssue[]> {
  const session = new ReplaySession();
  try {
    await session.configure({ ...manifest.session!.settings, mode: 'resume' });
    const archives: ArchiveIssue[] = [];
    for (const check of manifest.checks) if (check.issueId) archives.push(await session.getIssue(check.issueId));
    return archives;
  } finally { await session.close(); }
}

/** Copy a saved issue to a later turn whose first article links back to the first article of the original. */
function laterIssueLinkingTo(earlier: ArchiveIssue): ArchiveIssue {
  const later = structuredClone(earlier);
  const turn = earlier.issue.cutoff.turn + 100;
  const rename = (id: string) => `${id}/later`;
  later.issue.issueId = rename(earlier.issue.issueId);
  later.issue.cutoff = { turn, label: `Turn ${turn}` };
  later.issue.items = later.issue.items.map(item => ({ ...item, id: rename(item.id) }));
  later.issue.pages = later.issue.pages.map(page => ({ ...page, itemIds: page.itemIds.map(rename) }));
  later.articles = later.articles.map(article => ({ ...article, id: rename(article.id) }));
  later.issue.items[0].earlierReport = {
    label: 'Earlier report',
    target: { type: 'article', issueId: earlier.issue.issueId, itemId: earlier.issue.items[0].id },
    summary: [[{ type: 'text', text: 'Earlier summary' }]],
  };
  return later;
}

/** Count the disclosures still open at a position in the report markup. */
function enclosingDisclosures(html: string, index: number): number {
  const before = html.slice(0, index);
  return before.split('<details').length - before.split('</details>').length;
}

describe('newspaper replay command artifacts', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let options: NewspaperCliOptions;
  beforeEach(async () => {
    recording = await createReplayRecording();
    const catalogue = await writeReplayPublicationCatalogue(recording.filename);
    options = parseNewspaperOptions(['--database', recording.filename, '--output', path.join(path.dirname(recording.filename), 'examples'),
      '--config', catalogue, '--player', '0', '--from', '6', '--to', '18', '--render-turns', '7'])!;
  });
  afterEach(async () => { vi.restoreAllMocks(); await recording.cleanup(); });

  it('should persist sequential editorial checks, original articles and resumable history without changing the source', async () => {
    const result = await runNewspaperReplay(options);
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8')) as NewspaperRunManifest;
    expect(manifest).toEqual(result);
    expect(manifest.status).toBe('complete');
    expect(manifest.checks.map(check => check.turn)).toEqual([6, 14, 18]);
    expect(manifest.counts.published).toBeGreaterThan(0);
    expect(manifest.counts.checks).toBe(manifest.counts.published + manifest.counts.skipped);
    expect(manifest.missingRenderTurns).toEqual([{ turn: 7, reason: expect.any(String) }]);
    expect(manifest.images).toEqual([]);
    const session = new ReplaySession();
    try {
      await session.configure({ ...manifest.session!.settings, mode: 'resume' });
      for (const summary of manifest.checks) {
        const audit = JSON.parse(await readFile(path.join(options.output, summary.audit), 'utf8'));
        expect(audit).toMatchObject({ status: summary.status, decision: { cutoffTurn: summary.turn, configurationId: summary.configurationId } });
        if (summary.issue) {
          const issue = issueDocumentSchema.parse(JSON.parse(await readFile(path.join(options.output, summary.issue), 'utf8')));
          const archive = await session.getIssue(summary.issueId!);
          expect(issue).toEqual(archive.issue);
          expect(audit.articles).toEqual(archive.articles);
          expect(archive.articles.map(article => article.id)).toEqual(archive.issue.items.map(item => item.id));
          const html = await readFile(path.join(options.output, 'index.html'), 'utf8');
          expect(html).toContain(`href="${summary.audit}"`);
          expect(html).toContain(`id="turn-${summary.turn}"`);
          for (const item of issue.items) expect(html.split(`id="article-${encodeURIComponent(item.id)}"`)).toHaveLength(2);
          archive.issue.items[0].body = [[{ type: 'text', text: '<script>alert("unsafe")</script>' }]];
          archive.issue.items[0].byline = [{ type: 'text', text: 'By the <Arts> desk' }];
          const escaped = newspaperReportHtml(manifest, [archive]);
          expect(escaped).toContain('&lt;script&gt;');
          expect(escaped).toContain('By the &lt;Arts&gt; desk');
          expect(escaped).not.toContain('<script>alert');
        }
      }
    } finally { await session.close(); }
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
    const db = new Database(path.join(options.output, 'replay.sqlite'), { readonly: true });
    try { expect(db.prepare('SELECT COUNT(*) AS count FROM OfflineReplayChecks').get()).toEqual({ count: manifest.counts.checks }); }
    finally { db.close(); }
  });

  it('should show rendered pages before any disclosure and keep diagnostics and issue text collapsed', async () => {
    const manifest = await runNewspaperReplay({ ...options, renderTurns: [] });
    const [earlier] = await savedArchives(manifest);
    const later = laterIssueLinkingTo(earlier);
    const image = { turn: later.issue.cutoff.turn, pageId: later.issue.pages[0].id, file: 'later-page-1.png' };
    const html = newspaperReportHtml({ ...manifest, images: [image] }, [earlier, later]);
    const imageAt = html.indexOf(`src="${image.file}"`);
    expect(imageAt).toBeGreaterThan(-1);
    expect(imageAt).toBeLessThan(html.indexOf('<details'));
    expect(enclosingDisclosures(html, imageAt)).toBe(0);
    expect(html.indexOf(`id="turn-${later.issue.cutoff.turn}"`)).toBeLessThan(html.indexOf(`id="turn-${earlier.issue.cutoff.turn}"`));
    for (const check of manifest.checks) expect(enclosingDisclosures(html, html.indexOf(`href="${check.audit}"`))).toBeGreaterThan(0);
    for (const item of [...earlier.issue.items, ...later.issue.items]) {
      const parts = html.split(`id="article-${encodeURIComponent(item.id)}"`);
      expect(parts).toHaveLength(2);
      expect(enclosingDisclosures(html, parts[0].length)).toBeGreaterThan(0);
    }
    for (const archive of [earlier, later]) expect(html).toContain(`href="issue-${archive.issue.cutoff.turn}.json"`);
    expect(enclosingDisclosures(html, html.indexOf('href="run.json"'))).toBe(0);
    expect(html).toContain(`href="#article-${encodeURIComponent(earlier.issue.items[0].id)}"`);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('should open collapsed sections when a reader follows issue and earlier report links', async context => {
    let browser: Awaited<ReturnType<typeof launchInstalledBrowser>>;
    try { browser = await launchInstalledBrowser(); }
    catch (error) { context.skip(String(error)); return; }
    try {
      const manifest = await runNewspaperReplay({ ...options, renderTurns: [] });
      const [earlier] = await savedArchives(manifest);
      const later = laterIssueLinkingTo(earlier);
      const image = { turn: later.issue.cutoff.turn, pageId: later.issue.pages[0].id, file: 'later-page-1.png' };
      await writeFile(path.join(options.output, image.file), onePixelPng);
      await writeFile(path.join(options.output, 'index.html'), newspaperReportHtml({ ...manifest, images: [image] }, [earlier, later]));
      const url = pathToFileURL(path.join(options.output, 'index.html')).href;
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const earlierArticle = page.locator(`[id="article-${encodeURIComponent(earlier.issue.items[0].id)}"]`);
      const laterText = page.locator(`[id="turn-${later.issue.cutoff.turn}"] > details > summary`);
      const earlierLink = page.locator(`[id="turn-${later.issue.cutoff.turn}"] a[href="#article-${encodeURIComponent(earlier.issue.items[0].id)}"]`);
      await page.goto(url);
      expect(await page.locator('details[open]').count()).toBe(0);
      expect(await page.locator(`img[src="${image.file}"]`).evaluate(element => element.getBoundingClientRect().top < innerHeight)).toBe(true);
      expect(await earlierArticle.isVisible()).toBe(false);

      await laterText.click();
      await earlierLink.click();
      await earlierArticle.waitFor({ state: 'visible', timeout: 5_000 });
      expect(await earlierArticle.evaluate(element => element.getBoundingClientRect().top < innerHeight)).toBe(true);

      await page.evaluate(() => { for (const details of document.querySelectorAll('details')) details.open = false; });
      await laterText.click();
      await earlierLink.click();
      await earlierArticle.waitFor({ state: 'visible', timeout: 5_000 });

      const direct = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await direct.goto(`${url}#turn-${earlier.issue.cutoff.turn}`);
      await direct.locator(`[id="turn-${earlier.issue.cutoff.turn}"] a[href="issue-${earlier.issue.cutoff.turn}.json"]`).waitFor({ state: 'visible', timeout: 5_000 });
    } finally { await browser.close(); }
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  }, 60_000);

  it('should reject a reused output directory and leave its saved artifacts unchanged', async () => {
    await runNewspaperReplay({ ...options, renderTurns: [] });
    const before = await readFile(path.join(options.output, 'run.json'));
    await expect(runNewspaperReplay(options)).rejects.toThrow();
    expect(await readFile(path.join(options.output, 'run.json'))).toEqual(before);
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should preserve a failed run report when the configuration directory is missing', async () => {
    await expect(runNewspaperReplay({ ...options, config: path.join(options.output, 'missing-config') })).rejects.toThrow();
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8'));
    expect(manifest).toMatchObject({ status: 'failed', error: expect.any(String), counts: { checks: 0 } });
    expect(await readFile(path.join(options.output, 'index.html'), 'utf8')).toContain('href="run.json"');
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should record failure when session cleanup fails after publication', async () => {
    const cleanupError = new Error('Controlled cleanup failure');
    const close = ReplaySession.prototype.close;
    vi.spyOn(ReplaySession.prototype, 'close').mockImplementationOnce(async function (this: ReplaySession) {
      await close.call(this);
      throw cleanupError;
    });
    await expect(runNewspaperReplay({ ...options, renderTurns: [] })).rejects.toBe(cleanupError);
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8'));
    expect(manifest).toMatchObject({ status: 'failed', error: cleanupError.message });
    expect(manifest.counts.published).toBeGreaterThan(0);
    for (const check of manifest.checks) {
      expect(JSON.parse(await readFile(path.join(options.output, check.audit), 'utf8')).decision.cutoffTurn).toBe(check.turn);
      if (check.issue) expect(issueDocumentSchema.parse(JSON.parse(await readFile(path.join(options.output, check.issue), 'utf8'))).issueId).toBe(check.issueId);
    }
    expect(await readFile(path.join(options.output, 'index.html'), 'utf8')).toContain(manifest.error);
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should preserve the original failure when cleanup also fails', async () => {
    const primaryError = new Error('Controlled replay failure');
    const advance = ReplaySession.prototype.advance;
    vi.spyOn(ReplaySession.prototype, 'advance')
      .mockImplementationOnce(function (this: ReplaySession) { return advance.call(this); })
      .mockRejectedValueOnce(primaryError);
    const close = ReplaySession.prototype.close;
    const closing = vi.spyOn(ReplaySession.prototype, 'close').mockImplementationOnce(async function (this: ReplaySession) {
      await close.call(this);
      throw new Error('Controlled cleanup failure');
    });
    await expect(runNewspaperReplay({ ...options, renderTurns: [] })).rejects.toBe(primaryError);
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8'));
    expect(manifest).toMatchObject({ status: 'failed', error: primaryError.message });
    expect(closing).toHaveBeenCalledOnce();
    expect(manifest.counts.published).toBeGreaterThan(0);
    for (const check of manifest.checks) {
      expect(JSON.parse(await readFile(path.join(options.output, check.audit), 'utf8')).decision.cutoffTurn).toBe(check.turn);
      if (check.issue) expect(issueDocumentSchema.parse(JSON.parse(await readFile(path.join(options.output, check.issue), 'utf8'))).issueId).toBe(check.issueId);
    }
    expect(await readFile(path.join(options.output, 'index.html'), 'utf8')).toContain(primaryError.message);
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should retain completed PNG records and report links when a later render fails', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    vi.spyOn(renderer, 'renderNewspaperExamples').mockImplementationOnce(async (issues, directory, _signal, images = []) => {
      const issue = issues[0].issue;
      const image = { turn: issue.cutoff.turn, pageId: issue.pages[0].id, file: `issue-${issue.cutoff.turn}-page-1.png` };
      await writeFile(path.join(directory, image.file), png);
      images.push(image);
      throw new Error('Next page failed to render.');
    });
    await expect(runNewspaperReplay({ ...options, renderTurns: [6] })).rejects.toThrow();
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8')) as NewspaperRunManifest;
    expect(manifest.status).toBe('failed');
    expect(manifest.images).toHaveLength(1);
    expect(await readFile(path.join(options.output, manifest.images[0].file))).toEqual(png);
    const html = await readFile(path.join(options.output, 'index.html'), 'utf8');
    expect(html).toContain(`src="${manifest.images[0].file}"`);
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should retain a failed checkpoint and close the session when cancelled after a check', async () => {
    const controller = new AbortController();
    const advance = ReplaySession.prototype.advance;
    vi.spyOn(ReplaySession.prototype, 'advance').mockImplementationOnce(async function (this: ReplaySession, scope?: unknown, requireScope = false) {
      const result = await advance.call(this, scope, requireScope);
      controller.abort(new Error('Cancelled after one check.'));
      return result;
    });
    const close = vi.spyOn(ReplaySession.prototype, 'close');
    await expect(runNewspaperReplay(options, controller.signal)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    const manifest = JSON.parse(await readFile(path.join(options.output, 'run.json'), 'utf8')) as NewspaperRunManifest;
    expect(manifest).toMatchObject({ status: 'failed', counts: { checks: 1 }, session: { cursor: { cutoffTurn: 6 } } });
    const resumed = new ReplaySession();
    try {
      await resumed.configure({ ...manifest.session!.settings, mode: 'resume' });
      expect((await resumed.advance()).session.cursor.cutoffTurn).toBe(14);
    } finally { await resumed.close(); }
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it.skipIf(!existsSync(path.join(readerDirectory, 'export.html')))('should capture published issue pages as PNGs and link them from the saved report', async context => {
    try { await (await launchInstalledBrowser()).close(); }
    catch (error) { context.skip(String(error)); return; }
    const manifest = await runNewspaperReplay({ ...options, to: 6, renderTurns: [6] });
    const issue = issueDocumentSchema.parse(JSON.parse(await readFile(path.join(options.output, 'issue-6.json'), 'utf8')));
    expect(manifest.images.map(image => image.pageId)).toEqual(issue.pages.map(page => page.id));
    expect(manifest.images.length).toBeGreaterThan(0);
    const html = await readFile(path.join(options.output, 'index.html'), 'utf8');
    for (const image of manifest.images) {
      expect(image.turn).toBe(6);
      const png = await readFile(path.join(options.output, image.file));
      expect(png.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
      expect(png.readUInt32BE(16)).toBeGreaterThan(0);
      expect(png.readUInt32BE(20)).toBeGreaterThan(0);
      expect(html).toContain(`href="${image.file}"`);
      expect(html).toContain(`src="${image.file}"`);
    }
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  }, 60_000);
});
