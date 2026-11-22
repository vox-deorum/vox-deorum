/** Check ordinary page geometry for varied story counts and lengths in the real browser reader. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import type { IssueDocument, IssueItem } from '../../../../src/newspaper/contracts/issue.js';
import type { RendererFamily } from '../../../../src/newspaper/contracts/design.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
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
const designIds: Record<RendererFamily, string> = { inscription: 'oral-accounts', broadsheet: 'victorian', feed: 'wire', folio: 'egypt' };

/** Historical formats whose ordinary editions pair briefs below the lead. */
const pairedDesigns = ['street-gazette', 'port-register', 'cable-desk', 'clay-chronicle', 'palm-leaf-register', 'court-dispatch'] as const;

/** Build a one-page ordinary issue whose stories have the given lengths. */
function createOrdinaryIssue(sentences: number[], family: RendererFamily = 'broadsheet'): IssueDocument {
  const issue = createNewspaperIssue();
  issue.publication = { title: 'The Civic Chronicle', designId: designIds[family], designVersion: '1', presentation: { schemaVersion: 1, rendererFamily: family } };
  issue.items = sentences.map((count, index) => createStory(`story-${index + 1}`, count));
  issue.pages = [{ id: 'front', label: 'Front Page', layout: 'ordinary', hasLead: true, itemIds: issue.items.map(item => item.id) }];
  return issue;
}

/** Use the stock paper and fonts and include an illustration in the lead and a paired brief. */
async function createPairedIssue(designId: typeof pairedDesigns[number], sentences: number[]): Promise<IssueDocument> {
  const issue = createOrdinaryIssue(sentences, 'folio');
  const design = (await loadEditorialConfig()).designs.find(candidate => candidate.id === designId)!;
  issue.publication = { title: design.title, designId, designVersion: design.version, presentation: design.presentation };
  for (const item of issue.items.slice(0, 2)) {
    item.image = { assetId: 'victorian.harbour', altText: 'Harbour illustration' };
  }
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

  it('should give four equal briefs two rows on wide paper and stack them on narrow paper', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      const issue = createOrdinaryIssue([1, 6, 2, 3]);
      issue.pages[0].hasLead = false;
      const narrow = await exportStories(page, issue, 760);
      const wide = await exportStories(page, issue, 1000);
      expect(await page.locator('.vd-story--lead').count()).toBe(0);
      expect(visualOrder(wide.stories)).toEqual(issue.pages[0].itemIds);
      const [first, second, third, fourth] = wide.stories;
      expect(second.top).toBeCloseTo(first.top, 1);
      expect(second.left).toBeGreaterThanOrEqual(first.right);
      expect(fourth.top).toBeCloseTo(third.top, 1);
      expect(third.top).toBeGreaterThanOrEqual(Math.max(first.contentBottom, second.contentBottom));
      expect(fourth.left).toBeCloseTo(second.left, 1);
      expect(visualOrder(narrow.stories)).toEqual(issue.pages[0].itemIds);
      expect(narrow.stories.filter(story => story.left < 1 && story.right > narrow.width - 1)).toHaveLength(4);
    } finally { await page.close(); }
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

  it.for(pairedDesigns)('should pair %s briefs only when there is room on an ordinary page', async (designId, context) => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const count of [1, 2, 4, 6]) {
        const issue = await createPairedIssue(designId, [5, 6, 2, 3, 4, 1].slice(0, count));
        const ids = issue.pages[0].itemIds;
        for (const width of [760, 761, 1200]) {
          const layout = await exportStories(page, issue, width);
          const [lead, ...briefs] = layout.stories;
          const label = `${designId}, ${count} stories at ${width}px`;
          expect(layout.overflow, label).toBe(false);
          expect(visualOrder(layout.stories), label).toEqual(ids);
          expect(lead.left, label).toBeCloseTo(0, 1);
          expect(lead.right, label).toBeCloseTo(layout.width, 1);
          let previousBottom = lead.contentBottom;
          for (let i = 0; i < briefs.length;) {
            const left = briefs[i++];
            expect(left.left, label).toBeCloseTo(0, 1);
            expect(left.top, label).toBeGreaterThanOrEqual(previousBottom);
            if (width > 760 && i < briefs.length) {
              const right = briefs[i++];
              expect(right.top, label).toBeCloseTo(left.top, 1);
              expect(right.left, label).toBeGreaterThan(left.right);
              expect(right.right, label).toBeCloseTo(layout.width, 1);
              previousBottom = Math.max(left.contentBottom, right.contentBottom);
            } else {
              if (width > 760) expect(left.right, label).toBeLessThanOrEqual(layout.width / 2 + 1);
              else expect(left.right, label).toBeCloseTo(layout.width, 1);
              previousBottom = left.contentBottom;
            }
          }
          if (count === 4 && width === 1200) {
            const leadStory = page.locator('.vd-story--lead');
            const prose = (await leadStory.locator('.vd-prose').boundingBox())!;
            if (designId === 'port-register') {
              const heading = (await leadStory.locator('.vd-headline').boundingBox())!;
              expect(heading.x + heading.width, label).toBeLessThan(prose.x);
            } else if (designId === 'court-dispatch') {
              const art = (await leadStory.locator('.vd-story-art').boundingBox())!;
              expect(art.x, label).toBeGreaterThan(prose.x + prose.width);
            }
          }
        }
      }
    } finally { await page.close(); }
  }, 60_000);

  it.for(['victorian', ...pairedDesigns] as const)('should give the %s reader the same story geometry as export', async (designId, context) => {
    if (!browser) { context.skip(unavailable); return; }
    const lengths = [1, 6, 2, 3];
    const issue = designId === 'victorian' ? createOrdinaryIssue(lengths) : await createPairedIssue(designId, lengths);
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.route('**/newspaper/fixtures/victorian-ordinary.json', route => route.fulfill({ json: issue }));
      for (const width of designId === 'victorian' ? [1200, 1000, 600] : [1200, 760]) {
        await page.goto(`${host.url}/newspaper/?fixture=victorian-ordinary`);
        await page.locator(`#reader-root[data-issue-id="${issue.issueId}"]`).waitFor();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.locator('#reader-root').evaluate((root, width) => {
          root.style.flex = '0 0 auto';
          root.style.width = `${width}px`;
          root.style.padding = '0';
        }, width);
        await page.waitForFunction(width => Math.abs(document.querySelector('.vd-publication')!.getBoundingClientRect().width - width) < 0.01, width);
        const interactive = await readStories(page);
        await page.goto(`${host.url}/newspaper/export.html`);
        expect(await exportStories(page, issue, width), `at ${width}`).toEqual(interactive);
      }
    } finally { await page.close(); }
  }, 60_000);

  it.for(['inscription', 'broadsheet'] as const)('should keep an unpaired brief in the left %s slot', async (family, context) => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createOrdinaryIssue([1, 1, 1, 1], family);
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      const { stories } = await exportStories(page, issue, 1200);
      expect(stories[3].left).toBeCloseTo(stories[1].left, 1);
      expect(stories[3].right).toBeCloseTo(stories[1].right, 1);
    } finally { await page.close(); }
  });

  it('should keep the opening letter inside a short lead', async context => {
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
          if (width > 760 && image.id === 'story-1') {
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
