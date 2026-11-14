/** Exercise real layout, scrolling, votes, and bounded DDS capture with installed browsers. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { launchInstalledBrowser, NewspaperBrowser } from '../../../../src/newspaper/renderer/browser.js';
import { startNewspaperHost, readerDirectory } from '../../../../src/newspaper/host/http.js';
import { renderIssue } from '../../../../src/newspaper/renderer/render.js';
import { defaultRenderProfile } from '../../../../src/newspaper/ui/layout.js';
import { texconvExecutablePath, validateDds } from '../../../../src/newspaper/renderer/dds.js';
import { parseIssueDocument } from '../../../../src/newspaper/contracts/validation.js';

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

  it('should keep line geometry stable between interactive and export modes and retain local votes and scroll', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
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
      const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, 'victorian-ordinary.json'), 'utf8')));
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

  it('should preserve link placement in every fixture at the supported viewport sizes', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      for (const [width, height] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
        await page.setViewportSize({ width, height });
        for (const fixture of ['victorian-ordinary', 'victorian-breaking', 'victorian-analysis', 'modern-ordinary']) {
          const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, `${fixture}.json`), 'utf8')));
          await page.goto(`${host.url}/newspaper/?fixture=${fixture}`);
          await page.waitForFunction(() => document.querySelector('#state-view')?.textContent?.includes('activePageId'));
          const interactive = await page.locator('[data-vd-region=page]:not([hidden])').evaluate(region => {
            const origin = region.getBoundingClientRect();
            return Array.from(region.querySelectorAll('.vd-inline-link'), element => Array.from(element.getClientRects(), rect => ({
              x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
            })));
          });
          await page.goto(`${host.url}/newspaper/export.html`);
          await page.evaluate(async ({ issue, profile }) => (window as any).voxDeorumNewspaperExport.mount(issue, profile), {
            issue, profile: { ...defaultRenderProfile, viewportWidth: width, viewportHeight: height },
          });
          const exported = await page.locator('[data-vd-region=page]:not([hidden])').evaluate(region => {
            const origin = region.getBoundingClientRect();
            return Array.from(region.querySelectorAll('.vd-inline-link'), element => Array.from(element.getClientRects(), rect => ({
              x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
            })));
          });
          expect(exported, `${fixture} at ${width}x${height}`).toEqual(interactive);
        }
      }
    } finally { await page.close(); }
  }, 120_000);

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

  it.skipIf(!existsSync(texconvExecutablePath))('should export bounded complete textures at both raster scales', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = parseIssueDocument(JSON.parse(await readFile(path.join(fixtures, 'victorian-ordinary.json'), 'utf8')));
    const worker = new NewspaperBrowser(async () => browser!);
    for (const rasterScale of [1, 2]) {
      const bundle = await renderIssue(worker, host.url, issue, { ...defaultRenderProfile, rasterScale, maxTextureHeight: 512 }, directory);
      expect(bundle.pages).toHaveLength(issue.pages.length);
      for (const region of [bundle.header, ...bundle.pages]) {
        for (const strip of region.strips) {
          const bytes = await readFile(path.join(directory, strip.fileName));
          expect(validateDds(bytes, strip.pixelWidth, strip.pixelHeight).format).toBe('BC1_UNORM');
          expect(strip.pixelWidth).toBeLessThanOrEqual(bundle.profile.maxTextureWidth);
          expect(strip.pixelHeight).toBeLessThanOrEqual(bundle.profile.maxTextureHeight);
        }
      }
    }
    await worker.close();
  }, 120_000);
});
