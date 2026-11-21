/** Check how stock designs reflow across editions in the export reader. */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import ordinary from '../../../../newspaper/fixtures/victorian-ordinary.json';
import breaking from '../../../../newspaper/fixtures/victorian-breaking.json';
import analysis from '../../../../newspaper/fixtures/victorian-analysis.json';
import sections from '../../../../newspaper/pages.json';
import { issueDocumentSchema, type IssueDocument } from '../../../../src/newspaper/contracts/issue.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { startNewspaperHost, readerDirectory } from '../../../../src/newspaper/export/http.js';
import { defaultRenderProfile } from '../../../../src/newspaper/renderer/layout.js';

/** Mount fixture stories with the catalogue masthead, type and section labels. */
async function designIssue(id: string, sample: unknown): Promise<IssueDocument> {
  const design = (await loadEditorialConfig()).designs.find(candidate => candidate.id === id)!;
  const issue = issueDocumentSchema.parse(sample);
  const front = issue.pages[0];
  issue.publication = { title: design.title, designId: id, designVersion: design.version, presentation: design.presentation };
  issue.pages = sections.map((section, index) => ({
    id: section.id,
    label: design.pageLabels[section.id] ?? section.label,
    layout: index === 0 ? front.layout : 'ordinary',
    itemIds: index === 0 ? front.itemIds : front.itemIds.slice(1),
  }));
  return issue;
}

/** Set the physical paper width before reading the rendered layout. */
async function mount(page: Page, issue: IssueDocument, paperWidth: number): Promise<void> {
  await page.evaluate(async ({ issue, profile }) => {
    await window.voxDeorumNewspaperExport!.mount(issue, profile);
  }, { issue, profile: { ...defaultRenderProfile, paperWidth } });
}

describe.skipIf(!existsSync(`${readerDirectory}/export.html`))('newspaper design editions', () => {
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

  it.for([
    'street-gazette', 'port-register', 'cable-desk', 'clay-chronicle', 'palm-leaf-register', 'court-dispatch',
    'city-extra', 'civic-index',
  ] as const)(
    'should preserve reading order and reflow every %s edition', async (id, context) => {
      if (!browser) { context.skip(unavailable); return; }
      const design = (await loadEditorialConfig()).designs.find(candidate => candidate.id === id)!;
      const page = await browser.newPage();
      try {
        await page.goto(`${host.url}/newspaper/export.html`);
        for (const sample of [ordinary, breaking, analysis]) {
          const issue = issueDocumentSchema.parse(sample);
          issue.publication = { title: design.title, designId: id, designVersion: design.version, presentation: design.presentation };
          const front = issue.pages[0];
          for (const paperWidth of [360, 1200]) {
            await page.evaluate(async ({ issue, profile }) => {
              await window.voxDeorumNewspaperExport!.mount(issue, profile);
            }, { issue, profile: { ...defaultRenderProfile, paperWidth } });
            const rendered = await page.locator('.vd-page:not([hidden])').evaluate(region => {
              const stories = Array.from(region.querySelectorAll<HTMLElement>('.vd-story'), story => ({
                id: story.dataset.itemId,
                left: story.getBoundingClientRect().left,
                right: story.getBoundingClientRect().right,
                top: story.getBoundingClientRect().top,
                bottom: story.getBoundingClientRect().bottom,
              }));
              const prose = region.querySelector('.vd-analysis-columns .vd-prose')?.getBoundingClientRect();
              const evidence = region.querySelector('.vd-evidence')?.getBoundingClientRect();
              return {
                stories,
                overflow: region.scrollWidth > region.clientWidth,
                evidenceBesideProse: Boolean(evidence && prose && evidence.left >= prose.right),
                evidenceBelowProse: Boolean(evidence && prose && evidence.top >= prose.bottom),
              };
            });
            const label = `${id} ${front.layout} at ${paperWidth}px`;
            const [lead, firstBrief, secondBrief] = rendered.stories;
            expect(rendered.overflow, label).toBe(false);
            expect(rendered.stories.map(story => story.id), label).toEqual(front.itemIds);
            if (paperWidth === 360 || (front.layout !== 'ordinary' && id !== 'city-extra' && id !== 'civic-index')) {
              for (let i = 1; i < rendered.stories.length; i++) {
                expect(rendered.stories[i].top, label).toBeGreaterThanOrEqual(rendered.stories[i - 1].bottom);
              }
            } else if (front.layout === 'ordinary' && id === 'city-extra') {
              expect(firstBrief.top, label).toBeGreaterThanOrEqual(lead.bottom);
              expect(firstBrief.top, label).toBeCloseTo(secondBrief.top, 1);
              expect(secondBrief.left, label).toBeGreaterThanOrEqual(firstBrief.right);
            } else if (front.layout === 'ordinary' && id === 'civic-index') {
              expect(firstBrief.top, label).toBeCloseTo(lead.top, 1);
              expect(firstBrief.left, label).toBeGreaterThan(lead.right);
              expect(secondBrief.top, label).toBeGreaterThanOrEqual(firstBrief.bottom);
              expect(secondBrief.left, label).toBeCloseTo(firstBrief.left, 1);
            }
            if (front.layout === 'analysis') {
              expect(paperWidth === 360 ? rendered.evidenceBelowProse : rendered.evidenceBesideProse, label).toBe(true);
            }
          }
        }
      } finally { await page.close(); }
    }, 60_000,
  );

  it('should keep the stock section tabs in aligned rows on narrow paper', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const [id, width] of [
        ['victorian', 360], ['secession-review', 360], ['shang', 360],
        ['teletext-bulletin', 360], ['oral-accounts', 360], ['oral-accounts', 1000],
      ] as const) {
        const issue = await designIssue(id, ordinary);
        if (id === 'teletext-bulletin') issue.publication.title = 'The International Teletext Bulletin for Constantinople';
        await mount(page, issue, width);
        if (id === 'teletext-bulletin') {
          expect(await page.locator('.vd-title').evaluate(title => title.scrollWidth <= title.clientWidth)).toBe(true);
        }
        const tabs = await page.locator('.vd-tab').evaluateAll(nodes => nodes.map(node => {
          const box = node.getBoundingClientRect();
          const text = node.firstChild!;
          const range = document.createRange();
          const wholeWords = Array.from((text.textContent ?? '').matchAll(/\S+/g)).every(word => {
            range.setStart(text, word.index);
            range.setEnd(text, word.index + word[0].length);
            return range.getClientRects().length === 1;
          });
          return { left: box.left, right: box.right, top: box.top, width: box.width, wholeWords, fits: node.scrollWidth <= node.clientWidth };
        }));
        const label = `${id} at ${width}px`;
        expect(tabs, label).toHaveLength(4);
        expect(tabs.every(tab => tab.fits && tab.wholeWords), label).toBe(true);
        if (width === 1000) {
          expect(tabs.every(tab => tab.top === tabs[0].top), label).toBe(true);
        } else {
          expect(tabs[0].top, label).toBe(tabs[1].top);
          expect(tabs[2].top, label).toBe(tabs[3].top);
          expect(tabs[2].top, label).toBeGreaterThan(tabs[1].top);
          expect(tabs[1].left, label).toBeGreaterThan(tabs[0].right);
          expect(tabs[2].left, label).toBeCloseTo(tabs[0].left);
          expect(tabs[3].left, label).toBeCloseTo(tabs[1].left);
          for (const tab of tabs) expect(tab.width, label).toBeCloseTo(tabs[0].width, 1);
        }
      }
    } finally { await page.close(); }
  }, 60_000);

  it.for([
    ['meiji-picture-sheet', breaking, true],
    ['coffeehouse-essay', breaking, true],
    ['printed-almanack', breaking, false],
    ['court-dispatch', breaking, false],
    ['civic-survey', analysis, false],
    ['civic-index', ordinary, false],
    ['contact-sheet', ordinary, false],
  ] as const)(
    'should fit the prose to the headline layout in %s', async ([id, sample, splitsWideLead], context) => {
      if (!browser) { context.skip(unavailable); return; }
      const page = await browser.newPage();
      try {
        await page.goto(`${host.url}/newspaper/export.html`);
        const issue = await designIssue(id, sample);
        if (id === 'court-dispatch') delete issue.items[0].image;
        const sentence = ' The provisional report compares the two observations and records how the accounts changed.';
        for (const item of issue.items) {
          item.body = [[{ type: 'text', text: sentence.repeat(8).trim() }]];
        }
        for (const width of [360, 1200]) {
          await mount(page, issue, width);
          const columns = await page.locator('.vd-page:not([hidden]) .vd-prose').evaluateAll(nodes => nodes.map(node => {
            const box = node.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node.querySelector('p')!);
            const lines = Array.from(range.getClientRects());
            return lines.some(line => line.left > box.left + box.width / 2);
          }));
          expect(columns, `${width}px`).toEqual([
            width === 1200 && splitsWideLead,
            ...issue.pages[0].itemIds.slice(1).map(() => false),
          ]);
        }
      } finally { await page.close(); }
    }, 60_000,
  );

  it('should give a lone urgent brief the full row and keep ordinary briefs paired', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const id of ['contact-sheet', 'cord-register']) {
        const articles = page.locator('.vd-page:not([hidden]) .vd-story');
        for (const sample of [breaking, analysis]) {
          const issue = await designIssue(id, sample);
          for (const width of [760, 761, 1200]) {
            await mount(page, issue, width);
            const boxes = await articles.evaluateAll(nodes => nodes.map(node => ({
              width: node.getBoundingClientRect().width,
              copyWidth: node.querySelector('.vd-prose')!.getBoundingClientRect().width,
            })));
            const label = `${id} ${issue.pages[0].layout} at ${width}px`;
            expect(boxes, label).toHaveLength(2);
            expect(boxes[1].width, label).toBeCloseTo(boxes[0].width, 1);
            if (width === 1200) expect(boxes[1].copyWidth, label).toBeLessThan(boxes[1].width * .8);
          }
        }
        await mount(page, await designIssue(id, ordinary), 900);
        const boxes = await articles.evaluateAll(nodes => nodes.map(node => {
          const { left, right, top } = node.getBoundingClientRect();
          return { left, right, top };
        }));
        expect(boxes, id).toHaveLength(3);
        expect(boxes[1].top, id).toBeCloseTo(boxes[2].top, 1);
        expect(boxes[2].left, id).toBeGreaterThan(boxes[1].right);
      }
    } finally { await page.close(); }
  }, 60_000);
});
