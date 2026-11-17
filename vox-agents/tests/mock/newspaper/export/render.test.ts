/** Exercise real layout, scrolling, votes, and bounded DDS capture with installed browsers. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { launchInstalledBrowser, NewspaperBrowser } from '../../../../src/newspaper/export/browser.js';
import { startNewspaperHost, readerDirectory } from '../../../../src/newspaper/export/http.js';
import { renderIssue } from '../../../../src/newspaper/export/render.js';
import { defaultRenderProfile } from '../../../../src/newspaper/renderer/layout.js';
import { texconvExecutablePath, validateDds } from '../../../../src/newspaper/export/dds.js';
import { parseIssueDocument } from '../../../../src/newspaper/renderer/validation.js';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import { mountReplayRoutes } from '../../../../src/newspaper/replay/http.js';
import { createReplayRecording } from '../../../helpers/newspaper-replay.js';

const fixtures = fileURLToPath(new URL('../../../../newspaper/fixtures/', import.meta.url));

describe.skipIf(!existsSync(path.join(readerDirectory, 'index.html')))('newspaper browser integration', () => {
  let browser: Browser | undefined;
  let unavailable: string | undefined;
  let host: Awaited<ReturnType<typeof startNewspaperHost>>;
  let directory: string;

  beforeAll(async () => {
    try { browser = await launchInstalledBrowser(); }
    catch (error) { unavailable = String(error); }
    host = await startNewspaperHost({ fixtureDirectory: fixtures });
    directory = await mkdtemp(path.join(tmpdir(), 'vd-newspaper-render-'));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await host?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('should inspect recording evidence and source references when fixture loading fails and no issue exists', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const recording = await createReplayRecording();
    const session = new ReplaySession();
    const replayHost = await startNewspaperHost({
      /** Host the real replay parser and session alongside the compiled application shell. */
      mountApplicationRoutes: app => mountReplayRoutes(app, () => session),
    });
    const page = await browser.newPage();
    try {
      await page.route('**/newspaper/fixtures/*.json', route => route.fulfill({ status: 404, body: '{}' }));
      /** Show lifecycle flags returned by the evidence API alongside the recorded rows. */
      await page.route('**/api/newspaper/replay/evidence', async route => {
        const response = await route.fetch();
        const result = await response.json();
        result.evidence.limitations = ['cityLifecycleUnresolved', 'cityLifecycleOrderUnknown'];
        await route.fulfill({ response, json: result });
      });
      await page.goto(`${replayHost.url}/newspaper/`);
      await page.locator('#reader-root [role=alert]').waitFor();
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')!.disabled);
      await page.locator('[name=databasePath]').fill(recording.filename);
      await page.locator('[name=fromTurn]').fill('10');
      await page.locator('[name=toTurn]').fill('18');
      await page.locator('[name=publicationEnabled]').selectOption('false');
      await page.getByRole('button', { name: 'Open recording', exact: true }).click();
      await page.locator('[data-replay=inspect]:enabled').waitFor();
      await page.locator('[data-replay=inspect]').click();
      const source = page.locator('#evidence-view button').first();
      await source.click();
      const inspected = JSON.parse((await page.locator('#source-view').textContent())!);
      expect(await page.locator('[data-evidence-limitations] li').allTextContents()).toEqual([
        'cityLifecycleUnresolved', 'cityLifecycleOrderUnknown'
      ]);
      expect(inspected.source).toEqual({ table: 'PlayerSummaries', id: 3, turn: 10, createdAt: 1010 });
      expect(inspected.values.OutgoingTradeRoutes).toEqual({ 'Home => Port (Civ1)': { FromGold: 0, ToFood: -1 } });
      expect((await session.getState()).cursor.cutoffTurn).toBeNull();
      await page.locator('[data-replay=advance]').click();
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')!.disabled);
      expect((await session.getState()).cursor.cutoffTurn).toBe(10);
      await page.locator('[data-replay=advance]').click();
      await page.waitForFunction(() => !document.querySelector<HTMLFieldSetElement>('#replay-form fieldset')!.disabled);
      expect((await session.getState()).cursor.cutoffTurn).toBe(15);
      expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
    } finally {
      await page.close();
      await session.close();
      await replayHost.close();
      await recording.cleanup();
    }
  }, 60_000);

  it('should keep line geometry stable between interactive and export modes and retain local votes and scroll', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, 'victorian-ordinary.json'), 'utf8')));
    issue.items[0].body.push([{
      type: 'link',
      text: 'Inspect the overseas harbour returns and the merchants trading between our cities. '.repeat(8),
      target: { type: 'screen', screen: 'trade' },
    }]);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.route('**/newspaper/fixtures/victorian-ordinary.json', route => route.fulfill({ json: issue }));
      await page.goto(`${host.url}/newspaper/?fixture=victorian-ordinary`);
      await page.waitForFunction(() => document.querySelector('#state-view')?.textContent?.includes('activePageId'));
      const firstTab = page.locator('[role=tab]').first();
      const secondTab = page.locator('[role=tab]').nth(1);
      const votes = page.locator('[data-vd-region=page]:not([hidden]) [data-vd-vote-value=up]');
      const item = await votes.first().getAttribute('data-vd-vote-item');
      await votes.first().click();
      expect(await votes.first().getAttribute('aria-pressed')).toBe('true');
      await secondTab.click();
      const shared = page.locator(`[data-vd-region=page]:not([hidden]) [data-vd-vote-item="${item}"][data-vd-vote-value=up]`);
      expect(await shared.getAttribute('aria-pressed')).toBe('true');
      await shared.click();
      await firstTab.click();
      expect(await votes.first().getAttribute('aria-pressed')).toBe('false');
      await page.locator('[data-vd-region=page]:not([hidden])').evaluate(element => { element.scrollTop = 120; });
      const saved = await page.locator('[data-vd-region=page]:not([hidden])').evaluate(element => element.scrollTop);
      expect(saved).toBeGreaterThan(0);
      await page.waitForFunction(() => {
        const state = JSON.parse(document.querySelector('#state-view')!.textContent!);
        return state.scrollByPage[state.activePageId] > 0;
      });
      await secondTab.click();
      await firstTab.click();
      expect(await page.locator('[data-vd-region=page]:not([hidden])').evaluate(element => element.scrollTop)).toBe(saved);
      const interactive = await page.locator('[data-vd-region=page]:not([hidden]) .vd-inline-link').evaluateAll(elements => elements.map(element => Array.from(element.getClientRects(), rect => ({ width: rect.width, height: rect.height }))));
      expect(interactive.some(rects => rects.length > 1)).toBe(true);
      await page.goto(`${host.url}/newspaper/export.html`);
      await page.evaluate(async ({ issue, profile }) => {
        await (window as any).voxDeorumNewspaperExport.mount(issue, profile);
      }, { issue, profile: defaultRenderProfile });
      const exported = await page.locator('[data-vd-region=page]:not([hidden]) .vd-inline-link').evaluateAll(elements => elements.map(element => Array.from(element.getClientRects(), rect => ({ width: rect.width, height: rect.height }))));
      expect(exported).toEqual(interactive);
      const measurement = await page.evaluate(() => (window as any).voxDeorumNewspaperExport.measurePage());
      expect(measurement.actions.some((action: any) => action.rects.length > 1)).toBe(true);
      expect(measurement.capture.size.height).toBeGreaterThan(defaultRenderProfile.viewportHeight);
    } finally { await page.close(); }
  }, 60_000);

  it('should reflow every fixture without overflow and keep export links at the reader positions', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      for (const width of [360, 600, 900, 1200, 600.5]) {
        for (const fixture of ['victorian-ordinary', 'victorian-breaking', 'victorian-analysis', 'modern-ordinary']) {
          const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, `${fixture}.json`), 'utf8')));
          await page.goto(`${host.url}/newspaper/?fixture=${fixture}`);
          await page.waitForFunction(() => document.querySelector('#state-view')?.textContent?.includes('activePageId'));
          await page.locator('#reader-root').evaluate((root, width) => {
            root.style.cssText = `flex:0 0 auto;width:${width}px;padding:0;`;
          }, width);
          await page.waitForFunction(width => Math.abs(document.querySelector('.vd-publication')!.getBoundingClientRect().width - width) < 0.01, width);
          const interactive = [];
          for (const section of issue.pages) {
            await page.locator(`[role=tab][data-vd-page-id="${section.id}"]`).click();
            const measured = await page.locator('[data-vd-region=page]:not([hidden])').evaluate(region => {
              const origin = region.getBoundingClientRect();
              return { overflow: region.scrollWidth > region.clientWidth, links: Array.from(region.querySelectorAll('.vd-inline-link'), element => Array.from(element.getClientRects(), rect => ({
                x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
              }))) };
            });
            expect(measured.overflow, `${fixture}/${section.id} at ${width}`).toBe(false);
            interactive.push(measured.links);
          }
          await page.goto(`${host.url}/newspaper/export.html`);
          await page.evaluate(async ({ issue, profile }) => (window as any).voxDeorumNewspaperExport.mount(issue, profile), {
            issue, profile: { ...defaultRenderProfile, paperWidth: width },
          });
          for (const [index, section] of issue.pages.entries()) {
            const measured = await page.evaluate(async pageId => {
              const bridge = (window as any).voxDeorumNewspaperExport;
              await bridge.selectPage(pageId);
              return bridge.measurePage();
            }, section.id);
            const exported = await page.locator('[data-vd-region=page]:not([hidden])').evaluate(region => {
              const origin = region.getBoundingClientRect();
              return Array.from(region.querySelectorAll('.vd-inline-link'), element => Array.from(element.getClientRects(), rect => ({
                x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
              })));
            });
            expect(exported, `${fixture}/${section.id} at ${width}`).toEqual(interactive[index]);
            expect(measured.capture.size.width).toBe(width);
            for (const rect of [...measured.actions.flatMap((action: any) => action.rects), ...measured.voteSlots.map((slot: any) => slot.rect)]) {
              expect(rect.x).toBeGreaterThanOrEqual(0);
              expect(rect.y).toBeGreaterThanOrEqual(0);
              expect(rect.x + rect.width).toBeLessThanOrEqual(width + 0.01);
              expect(rect.y + rect.height).toBeLessThanOrEqual(measured.capture.size.height + 0.01);
            }
            const overflow = await page.locator('[data-vd-region=page]:not([hidden])').evaluate(region => region.scrollWidth > region.clientWidth);
            expect(overflow, `export ${fixture}/${section.id} at ${width}`).toBe(false);
          }
          const header = await page.evaluate(() => (window as any).voxDeorumNewspaperExport.measureHeader());
          for (const tab of header.tabs) expect(tab.rect.x + tab.rect.width).toBeLessThanOrEqual(width + 0.01);
        }
      }
    } finally { await page.close(); }
  }, 180_000);

  it('should resize the default reader in place while retaining votes and the selected page', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${host.url}/newspaper/?fixture=victorian-ordinary`);
      await page.waitForFunction(() => document.querySelector('#state-view')?.textContent?.includes('activePageId'));
      const secondTab = page.locator('[role=tab]').nth(1);
      await secondTab.click();
      const pageId = await secondTab.getAttribute('data-vd-page-id');
      const vote = page.locator('[data-vd-region=page]:not([hidden]) [data-vd-vote-value=up]').first();
      await vote.click();
      for (const width of [360, 361, 600, 900, 1400]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForFunction(width => {
          const root = document.querySelector('#reader-root')!;
          const publication = document.querySelector('.vd-publication')!;
          const style = getComputedStyle(root);
          const available = root.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return Math.abs(publication.getBoundingClientRect().width - Math.min(1200, available)) < 0.01;
        }, width);
        expect(await secondTab.getAttribute('aria-selected')).toBe('true');
        expect(await vote.getAttribute('aria-pressed')).toBe('true');
        expect(await page.locator('[data-vd-region=page]:not([hidden])').getAttribute('data-vd-page-id')).toBe(pageId);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    } finally { await page.close(); }
  }, 60_000);

  it('should retain canonical capture geometry for each display zoom', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, 'victorian-analysis.json'), 'utf8')));
      await page.goto(`${host.url}/newspaper/export.html`);
      let baseline: unknown;
      for (const displayScale of [1, 1.2, 1.5, 2]) {
        const measured = await page.evaluate(async ({ issue, profile }) => {
          const bridge = (window as any).voxDeorumNewspaperExport;
          await bridge.mount(issue, profile);
          const result = await bridge.measurePage();
          return { capture: result.capture, actions: result.actions.map(({ actionId, ...action }: any) => action), voteSlots: result.voteSlots };
        }, { issue, profile: { ...defaultRenderProfile, paperWidth: 600.5, displayScale } });
        baseline ??= measured;
        expect(measured).toEqual(baseline);
      }
    } finally { await page.close(); }
  }, 60_000);

  it('should retain votes cast while fixture media is still loading in the inspector', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    let releaseFonts!: () => void;
    const fontsReady = new Promise<void>(resolve => { releaseFonts = resolve; });
    try {
      await page.route('**/*.ttf', async route => { await fontsReady; await route.continue(); });
      await page.goto(`${host.url}/newspaper/?fixture=victorian-ordinary`, { waitUntil: 'domcontentloaded' });
      const vote = page.locator('[data-vd-region=page]:not([hidden]) [data-vd-vote-value=up]').first();
      await vote.waitFor({ state: 'attached' });
      const itemId = await vote.getAttribute('data-vd-vote-item');
      await vote.evaluate(element => (element as HTMLElement).click());
      releaseFonts();
      await page.waitForLoadState('networkidle');
      expect(await vote.getAttribute('aria-pressed')).toBe('true');
      const state = JSON.parse((await page.locator('#state-view').textContent())!);
      expect(state.votes[itemId!]).toBe('up');
    } finally { releaseFonts(); await page.close(); }
  }, 60_000);

  it('should keep long tabs inside the captured header and preserve the reader through icon captures', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, 'victorian-ordinary.json'), 'utf8')));
      issue.pages = Array.from({ length: 6 }, (_, index) => ({
        ...issue.pages[0], id: `section-${index}`, label: `Section ${index} with a lengthy descriptive label`,
      }));
      issue.pages[0].label = 'Unbroken'.repeat(30);
      await page.goto(`${host.url}/newspaper/export.html`);
      const result = await page.evaluate(async ({ issue, profile }) => {
        const bridge = (window as any).voxDeorumNewspaperExport;
        await bridge.mount(issue, profile);
        const header = await bridge.measureHeader();
        await bridge.mountVoteIcon('vote-victorian-up-neutral');
        await bridge.mountVoteIcon('vote-victorian-up-selected');
        await bridge.selectPage(issue.pages[1].id);
        const measured = await bridge.measurePage();
        const afterIcons = await bridge.measureHeader();
        bridge.dispose();
        const root = document.getElementById('newspaper-export-root')!;
        return { header, afterIcons, activePageId: measured.region.pageId, empty: root.childElementCount === 0,
          mounted: root.classList.contains('vd-newspaper') };
      }, { issue, profile: { ...defaultRenderProfile, textScale: 3 } });
      expect(result.header.tabs).toHaveLength(6);
      for (const tab of result.header.tabs) {
        expect(tab.rect.x).toBeGreaterThanOrEqual(0);
        expect(tab.rect.x + tab.rect.width).toBeLessThanOrEqual(result.header.capture.size.width);
        expect(tab.rect.y + tab.rect.height).toBeLessThanOrEqual(result.header.capture.size.height);
      }
      expect(result.afterIcons.capture).toEqual(result.header.capture);
      expect(result.activePageId).toBe(issue.pages[1].id);
      expect(result.empty).toBe(true);
      expect(result.mounted).toBe(false);
    } finally { await page.close(); }
  }, 60_000);

  it.skipIf(!existsSync(texconvExecutablePath))('should reproduce the lossless browser pixels across fractional-width strips', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, 'victorian-ordinary.json'), 'utf8')));
    const profile = { ...defaultRenderProfile, paperWidth: 600.5, rasterScale: 2, maxTextureHeight: 512 };
    const sources = new Map<string, Buffer>();
    const worker = new NewspaperBrowser(async () => {
      const captureBrowser = await launchInstalledBrowser();
      const newContext = captureBrowser.newContext.bind(captureBrowser);
      /** Keep the original screenshot bytes so conversion can be compared without repainting. */
      captureBrowser.newContext = async options => {
        const context = await newContext(options);
        context.on('page', page => {
          const screenshot = page.screenshot.bind(page);
          /** Record each lossless source before the export worker removes its temporary file. */
          page.screenshot = async options => {
            const png = await screenshot(options);
            if (options?.path) sources.set(path.basename(String(options.path)), png);
            return png;
          };
        });
        return context;
      };
      return captureBrowser;
    });
    const started = performance.now();
    const bundle = await renderIssue(worker, host.url, issue, profile, directory, 'B8G8R8A8_UNORM');
    const durationMs = performance.now() - started;
    await worker.close();
    const artifactDirectory = path.resolve('../.tmp/newspaper-responsive');
    await mkdir(artifactDirectory, { recursive: true });
    const page = await browser.newPage({ viewport: { width: profile.viewportWidth, height: profile.viewportHeight }, deviceScaleFactor: profile.rasterScale });
    let totalBytes = 0;
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      await page.evaluate(async ({ issue, profile }) => (window as any).voxDeorumNewspaperExport.mount(issue, profile), { issue, profile });
      for (const region of [bundle.header, ...bundle.pages]) {
        const measured = await page.evaluate(async pageId => {
          const bridge = (window as any).voxDeorumNewspaperExport;
          if (pageId) { await bridge.selectPage(pageId); return bridge.measurePage(); }
          return bridge.measureHeader();
        }, 'pageId' in region ? region.pageId : null);
        expect(region.strips.length).toBeGreaterThan(1);
        const source = await page.screenshot({ type: 'png', fullPage: true, clip: {
          x: measured.capture.origin.x, y: measured.capture.origin.y,
          width: region.strips[0].pixelWidth / profile.rasterScale, height: measured.capture.size.height,
        } });
        /** Decode PNG pixels through the browser's canvas implementation. */
        const decodePng = async (png: Buffer): Promise<Buffer> => Buffer.from(await page.evaluate(async png => {
          const response = await fetch(`data:image/png;base64,${png}`);
          const image = await createImageBitmap(await response.blob());
          const canvas = document.createElement('canvas');
          canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const rgba = context.getImageData(0, 0, image.width, image.height).data;
          let binary = '';
          for (let offset = 0; offset < rgba.length; offset += 32768) binary += String.fromCharCode(...rgba.subarray(offset, offset + 32768));
          return btoa(binary);
        }, png.toString('base64')), 'base64');
        const stitched: Buffer[] = [];
        for (const strip of region.strips) {
          const bytes = await readFile(path.join(directory, strip.fileName));
          totalBytes += bytes.length;
          expect(validateDds(bytes, strip.pixelWidth, strip.pixelHeight).format).toBe('B8G8R8A8_UNORM');
          const rgba = Buffer.from(bytes.subarray(128));
          for (let index = 0; index < rgba.length; index += 4) {
            const blue = rgba[index]; rgba[index] = rgba[index + 2]; rgba[index + 2] = blue;
          }
          const inputPixels = await decodePng(sources.get(strip.fileName.replace(/\.dds$/, '.png'))!);
          expect(createHash('sha256').update(rgba).digest('hex')).toBe(createHash('sha256').update(inputPixels).digest('hex'));
          const visibleRows = Math.round(strip.visibleHeight * profile.rasterScale);
          stitched.push(rgba.subarray(0, strip.pixelWidth * visibleRows * 4));
          await copyFile(path.join(directory, strip.fileName), path.join(artifactDirectory, strip.fileName));
        }
        const expectedPixels = await decodePng(source);
        const actualPixels = Buffer.concat(stitched);
        expect(actualPixels.length).toBe(expectedPixels.length);
        // Independent Chromium paints can vary image interpolation by one channel value.
        let maxDifference = 0;
        for (let index = 0; index < actualPixels.length; index++) maxDifference = Math.max(maxDifference, Math.abs(actualPixels[index] - expectedPixels[index]));
        expect(maxDifference).toBeLessThanOrEqual(1);
      }
      await page.evaluate(async pageId => (window as any).voxDeorumNewspaperExport.selectPage(pageId), issue.pages[0].id);
      const firstPage = await page.evaluate(() => (window as any).voxDeorumNewspaperExport.measurePage());
      await page.screenshot({ path: path.join(artifactDirectory, 'reader-600.png'), type: 'png', fullPage: true, clip: {
        x: 0, y: 0, width: profile.paperWidth, height: firstPage.capture.origin.y + firstPage.capture.size.height,
      } });
      await writeFile(path.join(artifactDirectory, 'baseline.json'), JSON.stringify({ profile, durationMs: Math.round(durationMs), regionDdsBytes: totalBytes, bundle }, null, 2));
    } finally { await page.close(); }
  }, 120_000);

  it.skipIf(!existsSync(texconvExecutablePath))('should export bounded complete textures at both raster scales', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, 'victorian-ordinary.json'), 'utf8')));
    const worker = new NewspaperBrowser();
    for (const rasterScale of [1, 2]) {
      const bundle = await renderIssue(worker, host.url, issue, { ...defaultRenderProfile, rasterScale, maxTextureHeight: 512 }, directory);
      expect(bundle.pages).toHaveLength(issue.pages.length);
      for (const region of [bundle.header, ...bundle.pages]) {
        for (const strip of region.strips) {
          const bytes = await readFile(path.join(directory, strip.fileName));
          expect(validateDds(bytes, strip.pixelWidth, strip.pixelHeight).format).toBe('B8G8R8A8_UNORM');
          expect(strip.pixelWidth).toBeLessThanOrEqual(bundle.profile.maxTextureWidth);
          expect(strip.pixelHeight).toBeLessThanOrEqual(bundle.profile.maxTextureHeight);
        }
      }
    }
    await worker.close();
  }, 120_000);
});
