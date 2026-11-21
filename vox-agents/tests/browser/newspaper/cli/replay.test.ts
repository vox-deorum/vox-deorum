import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReplayCliOptions, laterIssueLinkingTo, savedArchives } from '../../../helpers/newspaper-cli-replay.js';
import { createReplayRecording } from '../../../helpers/newspaper-replay.js';
import type { NewspaperCliOptions } from '../../../../src/newspaper/cli/options.js';
import { newspaperReportHtml, runNewspaperReplay } from '../../../../src/newspaper/cli/replay.js';
import { issueDocumentSchema } from '../../../../src/newspaper/contracts/issue.js';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { readerDirectory } from '../../../../src/newspaper/export/http.js';

/** A valid one-pixel PNG so the saved report can display a real image. */
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

describe('newspaper replay command artifacts', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let options: NewspaperCliOptions;

  beforeEach(async () => {
    recording = await createReplayRecording('Epic', [6]);
    options = await createReplayCliOptions(recording.filename);
  });
  afterEach(async () => { await recording.cleanup(); });

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
