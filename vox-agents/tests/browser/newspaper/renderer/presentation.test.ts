/** Check stored presentation values against the real browser reader. */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { startNewspaperHost, readerDirectory } from '../../../../src/newspaper/export/http.js';
import { createNewspaperIssue } from '../../../helpers/newspaper-fixtures.js';

describe.skipIf(!existsSync(`${readerDirectory}/export.html`))('stored newspaper presentation', () => {
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

  it('should apply saved presentation colors, fonts and ornaments through a configured design identity', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createNewspaperIssue();
    issue.publication.designId = 'early-account';
    issue.publication.presentation = {
      schemaVersion: 1, rendererFamily: 'broadsheet',
      tokens: { paperColor: '#f0e0c0', inkColor: '#202020', accentColor: '#554433', bodyFontAssetId: 'font-libre-caslon-400', headingFontAssetId: 'font-bodoni-moda-700', mastheadFontAssetId: 'font-unifrakturmaguntia-400' },
      assets: { ornamentAssetId: 'victorian.scrollwork' },
    };
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      await page.evaluate(async issueInput => {
        await window.voxDeorumNewspaperExport!.mount(issueInput, {
          viewportWidth: 1280, viewportHeight: 720, paperWidth: 1200, displayScale: 1,
          textScale: 1, rasterScale: 1, maxTextureWidth: 4096, maxTextureHeight: 2048, scrollbarGutter: 16,
        });
      }, issue);
      const styles = await page.evaluate(() => {
        const root = document.getElementById('newspaper-export-root')!;
        const style = getComputedStyle(root);
        return {
          family: root.dataset.design,
          paper: getComputedStyle(root.querySelector('.vd-publication')!).backgroundColor,
          ink: style.color,
          accent: style.getPropertyValue('--vd-accent'),
          font: style.fontFamily,
          headingFont: getComputedStyle(root.querySelector('.vd-headline')!).fontFamily,
          mastheadFont: getComputedStyle(root.querySelector('.vd-title')!).fontFamily,
          fontsLoaded: document.fonts.check(`16px ${style.fontFamily}`),
          faces: [...document.fonts].filter(font => font.family.startsWith('vd-reader-')).map(font => ({ family: font.family, weight: font.weight, style: font.style, status: font.status })),
        };
      });
      expect(styles).toMatchObject({ family: 'broadsheet', paper: 'rgb(240, 224, 192)', ink: 'rgb(32, 32, 32)', accent: '#554433', fontsLoaded: true });
      expect(styles.font).toContain('-body');
      expect(styles.headingFont).toContain('-display');
      expect(styles.mastheadFont).toContain('-masthead');
      expect(styles.headingFont).not.toBe(styles.mastheadFont);
      expect(styles.faces.filter(face => face.family.endsWith('-body')).map(({ weight, style }) => ({ weight, style }))).toEqual(expect.arrayContaining([
        { weight: '400', style: 'normal' }, { weight: '700', style: 'normal' }, { weight: '400', style: 'italic' },
      ]));
      expect(styles.faces.filter(face => face.family.endsWith('-display')).map(({ weight, style }) => ({ weight, style }))).toEqual(expect.arrayContaining([
        { weight: '400', style: 'normal' }, { weight: '700', style: 'normal' }, { weight: '900', style: 'normal' }, { weight: '400', style: 'italic' },
      ]));
      expect(styles.faces.every(face => face.status === 'loaded')).toBe(true);
      await expect(page.locator('.vd-masthead .vd-ornament').getAttribute('src')).resolves.toContain('assets/designs/victorian/scrollwork.svg');
      await page.evaluate(() => window.voxDeorumNewspaperExport!.dispose());
      expect(await page.locator('#newspaper-export-root').getAttribute('style')).not.toContain('--vd-paper:');
      expect(await page.evaluate(() => [...document.fonts].filter(font => font.family.startsWith('vd-reader-')).length)).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('should preserve the family masthead when the snapshot only selects a display font', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createNewspaperIssue();
    issue.publication.presentation = { schemaVersion: 1, rendererFamily: 'broadsheet', tokens: { headingFontAssetId: 'font-bodoni-moda-700' } };
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      await page.evaluate(async issueInput => window.voxDeorumNewspaperExport!.mount(issueInput, {
        viewportWidth: 1280, viewportHeight: 720, paperWidth: 1200, displayScale: 1,
        textScale: 1, rasterScale: 1, maxTextureWidth: 4096, maxTextureHeight: 2048, scrollbarGutter: 16,
      }), issue);
      expect(await page.locator('.vd-title').evaluate(element => getComputedStyle(element).fontFamily)).toContain('UnifrakturMaguntia');
      expect(await page.locator('.vd-headline').first().evaluate(element => getComputedStyle(element).fontFamily)).toContain('-display');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('should underline named body text and named links in the exported paper', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createNewspaperIssue();
    issue.items[0].body = [[
      { type: 'text', text: 'Napoleon', isName: true },
      { type: 'text', text: ' visits ' },
      { type: 'link', text: 'Paris', isName: true, target: { type: 'city', cityId: '1' } },
      { type: 'text', text: ' on turn 12.' },
    ]];
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      await page.evaluate(async issueInput => window.voxDeorumNewspaperExport!.mount(issueInput, {
        viewportWidth: 1280, viewportHeight: 720, paperWidth: 1200, displayScale: 1,
        textScale: 1, rasterScale: 1, maxTextureWidth: 4096, maxTextureHeight: 2048, scrollbarGutter: 16,
      }), issue);
      const body = page.locator('.vd-prose').first();
      expect(await body.locator('.vd-name').evaluateAll(names => names.map(name => ({
        label: name.textContent, tag: name.tagName, decoration: getComputedStyle(name).textDecorationLine,
      })))).toEqual([
        { label: 'Napoleon', tag: 'SPAN', decoration: 'underline' },
        { label: 'Paris', tag: 'A', decoration: 'underline' },
      ]);
      expect(await body.locator('.vd-number').textContent()).toBe('12');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('should draw stored masthead and place the byline after the article prose', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createNewspaperIssue();
    issue.publication.motto = 'All power to the Party';
    issue.items[0].subheadline = [{ type: 'text', text: 'A report from the provinces' }];
    issue.items[0].byline = [{ type: 'text', text: 'By the provincial desk' }];
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      await page.evaluate(async issueInput => window.voxDeorumNewspaperExport!.mount(issueInput, {
        viewportWidth: 1280, viewportHeight: 720, paperWidth: 1200, displayScale: 1,
        textScale: 1, rasterScale: 1, maxTextureWidth: 4096, maxTextureHeight: 2048, scrollbarGutter: 16,
      }), issue);
      expect(await page.locator('.vd-masthead .vd-title + .vd-motto').textContent()).toBe(issue.publication.motto);
      expect(await page.locator('.vd-prose ~ .vd-byline').first().textContent())
        .toBe('By the provincial desk');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('should keep a readable fallback and release instance faces when registered font files cannot load', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createNewspaperIssue();
    issue.publication.presentation = { schemaVersion: 1, rendererFamily: 'feed', tokens: { bodyFontAssetId: 'font-inter-400', headingFontAssetId: 'font-inter-800' } };
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/assets/fonts/*.ttf', route => route.abort());
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      await page.evaluate(async issueInput => window.voxDeorumNewspaperExport!.mount(issueInput, {
        viewportWidth: 1280, viewportHeight: 720, paperWidth: 1200, displayScale: 1,
        textScale: 1, rasterScale: 1, maxTextureWidth: 4096, maxTextureHeight: 2048, scrollbarGutter: 16,
      }), issue);
      const rendered = await page.evaluate(() => {
        const root = document.getElementById('newspaper-export-root')!;
        const headline = root.querySelector('.vd-headline')!;
        return {
          bodyFont: getComputedStyle(root).fontFamily,
          headingFont: getComputedStyle(headline).fontFamily,
          width: headline.getBoundingClientRect().width,
          faces: [...document.fonts].filter(font => font.family.startsWith('vd-reader-')).map(font => ({ weight: font.weight, style: font.style, status: font.status })),
        };
      });
      expect(rendered.bodyFont).toContain('Arial, sans-serif');
      expect(rendered.headingFont).toContain('Arial, sans-serif');
      expect(rendered.width).toBeGreaterThan(0);
      expect(rendered.faces).toEqual(expect.arrayContaining([{ weight: '800', style: 'normal', status: 'error' }]));
      expect(errors).toEqual([]);
      await page.evaluate(() => window.voxDeorumNewspaperExport!.dispose());
      expect(await page.evaluate(() => [...document.fonts].filter(font => font.family.startsWith('vd-reader-')).length)).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);

});
