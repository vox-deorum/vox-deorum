/** Check ordinary page geometry for varied story counts and lengths in the real browser reader. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import type { IssueDocument, IssueItem } from '../../../../src/newspaper/contracts/issue.js';
import type { RendererFamily } from '../../../../src/newspaper/contracts/design.js';
import { defaultRenderProfile } from '../../../../src/newspaper/renderer/layout.js';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { startNewspaperHost, readerDirectory } from '../../../../src/newspaper/export/http.js';
import { createNewspaperIssue } from '../../../helpers/newspaper-fixtures.js';

/** One rendered story, relative to its story list. */
interface StoryBox {
  id: string;
  left: number;
  right: number;
  top: number;
  contentBottom: number;
}

/** Story geometry for the visible page. */
interface StoryLayout {
  width: number;
  overflow: boolean;
  stories: StoryBox[];
}

/** Largest gap allowed between one story's end and the next story below it: the separator margin plus rounding. */
const separatorAllowance = 32;

/** Story counts and body lengths, including a short lead followed by longer stories. */
const storyCases = [
  { name: 'one story', sentences: [3] },
  { name: 'two stories', sentences: [1, 6] },
  { name: 'three stories', sentences: [1, 6, 2] },
  { name: 'a short lead before longer stories', sentences: [1, 6, 2, 3] },
  { name: 'five stories', sentences: [2, 3, 1, 6, 1] },
  { name: 'a long lead and six stories', sentences: [9, 1, 1, 4, 2, 5] },
];

/** Build one story whose body repeats a sentence the requested number of times. */
function createStory(id: string, sentences: number): IssueItem {
  const sentence = ' Recorded figures moved between the two observations, and the provincial account notes the change.';
  return {
    id, tags: [], seriesKeys: [],
    headline: [{ type: 'text', text: `Report ${id}` }],
    body: [[
      { type: 'text', text: 'Reports from ' },
      { type: 'link', text: 'Babylon', target: { type: 'civilization', civilizationId: '6' } },
      { type: 'text', text: sentence.repeat(sentences) },
    ]],
    sourceNote: [{ type: 'text', text: 'Source observation' }],
  };
}

/** Built-in design ids that carry each renderer family. */
const designIds: Record<RendererFamily, string> = { inscription: 'oral-accounts', broadsheet: 'victorian', feed: 'wire' };

/** Build a one-page ordinary issue whose stories have the given lengths. */
function createOrdinaryIssue(sentences: number[], family: RendererFamily = 'broadsheet'): IssueDocument {
  const issue = createNewspaperIssue();
  issue.publication = { title: 'The Civic Chronicle', designId: designIds[family], designVersion: '1', presentation: { schemaVersion: 1, rendererFamily: family } };
  issue.items = sentences.map((count, index) => createStory(`story-${index + 1}`, count));
  issue.pages = [{ id: 'front', label: 'Front Page', layout: 'ordinary', itemIds: issue.items.map(item => item.id) }];
  return issue;
}

/** Read every story box on the visible page relative to the inside of its story list. */
function readStories(page: Page): Promise<StoryLayout> {
  return page.locator('[data-vd-region=page]:not([hidden]) .vd-storylist').evaluate(list => {
    const origin = list.getBoundingClientRect();
    const style = getComputedStyle(list);
    const left = origin.left + parseFloat(style.borderLeftWidth);
    const right = origin.right - parseFloat(style.borderRightWidth);
    const region = list.closest<HTMLElement>('[data-vd-region=page]')!;
    return {
      width: right - left,
      overflow: region.scrollWidth > region.clientWidth,
      stories: Array.from(list.querySelectorAll<HTMLElement>(':scope > article'), article => {
        const box = article.getBoundingClientRect();
        const content = article.querySelector('.vd-story-content')!.getBoundingClientRect();
        return {
          id: article.dataset.itemId!,
          left: box.left - left,
          right: box.right - left,
          top: box.top - origin.top,
          contentBottom: content.bottom - origin.top,
        };
      }),
    };
  });
}

/** Mount an issue through the export bridge at one paper width and read its story boxes. */
async function exportStories(page: Page, issue: IssueDocument, paperWidth: number): Promise<StoryLayout> {
  await page.evaluate(async ({ issue, profile }) => {
    await window.voxDeorumNewspaperExport!.mount(issue, profile);
  }, { issue, profile: { ...defaultRenderProfile, paperWidth } });
  return readStories(page);
}

/**
 * Return the largest empty space under any story that the stories beside it do not explain.
 * Stories that start together form a row; the next story below may start only after the tallest of them.
 */
function strandedSpace(stories: StoryBox[]): number {
  let worst = 0;
  for (const story of stories) {
    const below = stories.filter(other => other.top > story.top + 1
      && other.left < story.right - 1 && other.right > story.left + 1);
    if (below.length === 0) continue;
    const next = Math.min(...below.map(other => other.top));
    const rowBottom = Math.max(...stories.filter(other => Math.abs(other.top - story.top) <= 1).map(other => other.contentBottom));
    worst = Math.max(worst, next - rowBottom);
  }
  return worst;
}

/** Return story ids in visual reading order: top to bottom, then left to right within a row. */
function visualOrder(stories: StoryBox[]): string[] {
  return [...stories].sort((a, b) => Math.abs(a.top - b.top) <= 1 ? a.left - b.left : a.top - b.top).map(story => story.id);
}

describe.skipIf(!existsSync(path.join(readerDirectory, 'export.html')) || !existsSync(path.join(readerDirectory, 'index.html')))('ordinary newspaper layout', () => {
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

  it('should start each story directly after the stories it follows for one to six stories of varied length', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const { name, sentences } of storyCases) {
        const issue = createOrdinaryIssue(sentences);
        const ids = issue.pages[0].itemIds;
        for (const width of [1000, 1200]) {
          const layout = await exportStories(page, issue, width);
          const label = `${name} at ${width}`;
          expect(layout.stories.map(story => story.id), label).toEqual(ids);
          expect(visualOrder(layout.stories), label).toEqual(ids);
          expect(layout.overflow, label).toBe(false);
          expect(strandedSpace(layout.stories), label).toBeLessThanOrEqual(separatorAllowance);
          for (const story of layout.stories) expect(story.right, label).toBeLessThanOrEqual(layout.width + 0.01);
          if (ids.length >= 3) {
            const sharesRow = layout.stories.some(story => layout.stories.some(other => other !== story
              && Math.abs(other.top - story.top) <= 1 && other.left >= story.right - 1));
            expect(sharesRow, `${label} uses the second column`).toBe(true);
          }
        }
        const narrow = await exportStories(page, issue, 600);
        expect(narrow.stories.map(story => story.id), `${name} at 600`).toEqual(ids);
        expect(narrow.overflow, `${name} at 600`).toBe(false);
        expect(strandedSpace(narrow.stories), `${name} at 600`).toBeLessThanOrEqual(separatorAllowance);
        for (const [index, story] of narrow.stories.entries()) {
          expect(story.left, `${name} at 600`).toBeCloseTo(0, 1);
          expect(story.right, `${name} at 600`).toBeCloseTo(narrow.width, 1);
          if (index > 0) expect(story.top).toBeGreaterThan(narrow.stories[index - 1].contentBottom);
        }
      }
    } finally { await page.close(); }
  }, 120_000);

  it('should give the interactive reader the same story geometry as export', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createOrdinaryIssue([1, 6, 2, 3]);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.route('**/newspaper/fixtures/victorian-ordinary.json', route => route.fulfill({ json: issue }));
      for (const width of [1200, 1000, 600]) {
        await page.goto(`${host.url}/newspaper/?fixture=victorian-ordinary`);
        await page.locator(`#reader-root[data-issue-id="${issue.issueId}"]`).waitFor();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.locator('#reader-root').evaluate((root, width) => {
          root.style.cssText = `flex:0 0 auto;width:${width}px;padding:0;`;
        }, width);
        await page.waitForFunction(width => Math.abs(document.querySelector('.vd-publication')!.getBoundingClientRect().width - width) < 0.01, width);
        const interactive = await readStories(page);
        await page.goto(`${host.url}/newspaper/export.html`);
        expect(await exportStories(page, issue, width), `at ${width}`).toEqual(interactive);
      }
    } finally { await page.close(); }
  }, 60_000);

  it('should keep the opening letter in the first column of a short lead', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createOrdinaryIssue([1, 6, 2, 3]);
    issue.items[0].body = [[{ type: 'text', text: 'Our civilization and India concluded a deal at turn 116. Review the exchange in the diplomatic overview as you consider the next step in this relationship.' }]];
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      await exportStories(page, issue, 1000);
      const position = await page.locator('.vd-story--lead .vd-prose').evaluate(prose => {
        const text = prose.querySelector('p')!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const initial = range.getBoundingClientRect();
        const column = prose.getBoundingClientRect();
        return { right: initial.right - column.left, width: column.width };
      });
      expect(position.right).toBeGreaterThan(0);
      expect(position.right).toBeLessThan(position.width / 2);
    } finally { await page.close(); }
  }, 60_000);

  it('should retain most of a registered illustration in full-width stories without changing brief or narrow image sizes', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createOrdinaryIssue([1, 3, 2, 3]);
    for (const item of issue.items) item.image = { assetId: 'victorian.harbour', altText: 'Harbour illustration' };
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const width of [1000, 1200, 600]) {
        await exportStories(page, issue, width);
        await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('.vd-story-art img'))
          .every(image => image.complete && image.naturalWidth > 0));
        const images = await page.locator('[data-vd-region=page]:not([hidden])').evaluate(region => {
          const origin = region.getBoundingClientRect();
          return Array.from(region.querySelectorAll<HTMLImageElement>('.vd-story-art img'), image => {
            const box = image.getBoundingClientRect();
            const naturalRatio = image.naturalWidth / image.naturalHeight;
            const displayedRatio = box.width / box.height;
            return {
              id: image.closest<HTMLElement>('article')!.dataset.itemId,
              width: box.width, height: box.height,
              left: box.left - origin.left, right: box.right - origin.left,
              bottom: box.bottom - origin.top,
              pageWidth: region.clientWidth, pageHeight: region.scrollHeight,
              retainedArea: Math.min(naturalRatio / displayedRatio, displayedRatio / naturalRatio),
            };
          });
        });
        expect(images).toHaveLength(4);
        for (const image of images) {
          const label = `${image.id} at ${width}`;
          expect(image.left, label).toBeGreaterThanOrEqual(0);
          expect(image.right, label).toBeLessThanOrEqual(image.pageWidth + 0.01);
          expect(image.bottom, label).toBeLessThanOrEqual(image.pageHeight + 0.01);
          if (width > 760 && ['story-1', 'story-4'].includes(image.id!)) {
            expect(image.retainedArea, label).toBeGreaterThanOrEqual(0.7);
            expect(image.width / image.height, label).toBeCloseTo(2, 1);
          } else {
            expect(image.height, label).toBeCloseTo(230, 1);
          }
        }
      }
    } finally { await page.close(); }
  }, 60_000);

  it('should keep the feed as one full-width column', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createOrdinaryIssue([1, 6, 2, 3], 'feed');
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const width of [1200, 600]) {
        const layout = await exportStories(page, issue, width);
        expect(layout.stories.map(story => story.id)).toEqual(issue.pages[0].itemIds);
        for (const [index, story] of layout.stories.entries()) {
          expect(story.left).toBeCloseTo(0, 1);
          expect(story.right).toBeCloseTo(layout.width, 1);
          if (index > 0) expect(story.top).toBeGreaterThanOrEqual(layout.stories[index - 1].contentBottom);
        }
        const separators = await page.locator('.vd-story').evaluateAll(stories => stories.map(story => {
          const style = getComputedStyle(story);
          return { topBorder: parseFloat(style.borderTopWidth), margin: parseFloat(style.marginTop) };
        }));
        for (const separator of separators) {
          expect(separator.topBorder, `no doubled feed separator at ${width}`).toBe(0);
          expect(separator.margin, `continuous feed at ${width}`).toBe(0);
        }
      }
    } finally { await page.close(); }
  }, 60_000);
});
