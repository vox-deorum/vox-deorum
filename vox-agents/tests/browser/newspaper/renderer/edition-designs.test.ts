/** Check how stock designs reflow across editions in the export reader. */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import ordinary from '../../../../newspaper/fixtures/victorian-ordinary.json';
import breaking from '../../../../newspaper/fixtures/victorian-breaking.json';
import analysis from '../../../../newspaper/fixtures/victorian-analysis.json';
import { issueDocumentSchema, type IssueDocument } from '../../../../src/newspaper/contracts/issue.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import type { EditorialDesign } from '../../../../src/newspaper/editorial/config/schema.js';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { startNewspaperHost, readerDirectory } from '../../../../src/newspaper/export/http.js';
import { defaultRenderProfile } from '../../../../src/newspaper/renderer/layout.js';

/** Use a fixture's lead and briefs to test a design's front page at a given size. */
function designIssue(design: EditorialDesign, sample: unknown, count?: number): IssueDocument {
  const issue = issueDocumentSchema.parse(sample);
  const front = issue.pages[0];
  issue.publication = { title: design.title, designId: design.id, designVersion: design.version, presentation: design.presentation };
  const itemIds = front.itemIds.slice(0, count);
  issue.items = issue.items.filter(item => itemIds.includes(item.id));
  issue.pages = [{
    ...front,
    id: 'front',
    label: design.pageLabels.front ?? 'The Record',
    itemIds,
  }];
  return issue;
}

/** Set the physical paper width before reading the rendered layout. */
async function mount(page: Page, issue: IssueDocument, paperWidth: number): Promise<void> {
  await page.evaluate(async ({ issue, profile }) => {
    await window.voxDeorumNewspaperExport!.mount(issue, profile);
  }, { issue, profile: { ...defaultRenderProfile, paperWidth } });
}

/** Measure story placement and how evidence sits relative to the lead's copy. */
function measureEdition(page: Page) {
  return page.locator('.vd-page:not([hidden])').evaluate(region => {
    const stories = Array.from(region.querySelectorAll<HTMLElement>('.vd-story'), story => {
      const { left, right, top, bottom, width } = story.getBoundingClientRect();
      return { id: story.dataset.itemId, left, right, top, bottom, width };
    });
    const evidenceBlock = region.querySelector('.vd-evidence');
    const prose = evidenceBlock?.closest('.vd-story')?.querySelector('.vd-prose')?.getBoundingClientRect();
    const evidence = evidenceBlock?.getBoundingClientRect();
    return {
      stories,
      overflow: region.scrollWidth > region.clientWidth,
      evidenceBesideProse: Boolean(evidence && prose && evidence.left >= prose.right),
      evidenceBelowProse: Boolean(evidence && prose && evidence.top >= prose.bottom),
    };
  });
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

  it('should show each dispatch slip’s own observation turn', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const design = (await loadEditorialConfig()).designs.find(candidate => candidate.id === 'court-dispatch')!;
    const issue = designIssue(design, ordinary, 3);
    issue.items.find(item => item.id === issue.pages[0].itemIds[0])!.observedTurn = 0;
    issue.items.find(item => item.id === issue.pages[0].itemIds[1])!.observedTurn = issue.cutoff.turn - 4;
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      await mount(page, issue, 1000);
      expect(await page.locator('.vd-dispatch-docket').allTextContents())
        .toEqual(['Turn 0', `Turn ${issue.cutoff.turn - 4}`, 'Undated']);
    } finally { await page.close(); }
  });

  it('should place story dates next to their headlines on narrow and wide editions', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const { designs } = await loadEditorialConfig();
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const id of ['wire', 'cable-desk', 'port-register', 'teletext-bulletin']) {
        const issue = designIssue(designs.find(design => design.id === id)!, ordinary, 3);
        const { itemIds } = issue.pages[0];
        const [lead, brief, undated] = itemIds.map(itemId => issue.items.find(item => item.id === itemId)!);
        lead.observedTurn = issue.cutoff.turn - 4;
        lead.byline = [{ type: 'link', text: 'Bristol', target: { type: 'city', cityId: 'CITY_BRISTOL' } }];
        brief.observedTurn = 0;
        brief.body = Array.from({ length: 4 }, () => brief.body[0]);
        delete brief.byline;
        delete undated.observedTurn;
        for (const width of [360, 1200]) {
          await mount(page, issue, width);
          const label = `${id} at ${width}px`;
          const rendered = await measureEdition(page);
          expect(rendered.overflow, label).toBe(false);
          expect(rendered.stories.map(story => story.id), label).toEqual(itemIds);
          const dates = await page.locator('.vd-story-turn').evaluateAll(nodes => nodes.map(node => {
            const story = node.closest('.vd-story')!;
            const text = document.createRange();
            text.selectNodeContents(story.querySelector('.vd-headline')!);
            const heading = text.getBoundingClientRect();
            text.selectNodeContents(node);
            const date = text.getBoundingClientRect();
            const paper = story.closest('.vd-page')!.getBoundingClientRect();
            return {
              itemId: story.getAttribute('data-item-id'),
              text: node.textContent,
              above: date.bottom <= heading.top + 1,
              directlyBelow: date.top >= heading.bottom - 1 && date.top - heading.bottom <= 24,
              fits: date.left >= paper.left && date.right <= paper.right,
            };
          }));
          expect(dates, label).toHaveLength(2);
          expect(dates.map(date => [date.itemId, date.text]), label)
            .toEqual([[lead.id, `Turn ${lead.observedTurn}`], [brief.id, 'Turn 0']]);
          expect(dates.every(date => date.fits && (id === 'teletext-bulletin' ? date.directlyBelow : date.above)), label).toBe(true);
          if (id === 'wire') {
            const byline = page.locator('.vd-story--lead .vd-byline');
            expect(await byline.locator('a').textContent(), label).toBe('Bristol');
            expect(await byline.locator('.vd-story-turn').count(), label).toBe(1);
          }
          if (id === 'cable-desk') {
            expect(await page.locator('.vd-cable-turn').textContent(), label).toBe(`Issue ${issue.cutoff.label}`);
          }
        }
      }
    } finally { await page.close(); }
  }, 60_000);

  it('should keep wide Telegram briefs aligned with their headlines when dated', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const design = (await loadEditorialConfig()).designs.find(candidate => candidate.id === 'cable-desk')!;
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      const brief = page.locator('.vd-story--brief').first();
      /** Compare the first printed lines, regardless of their containing box sizes. */
      const alignment = () => brief.evaluate(story => {
        const line = document.createRange();
        line.selectNodeContents(story.querySelector('.vd-headline')!);
        const headlineTop = line.getBoundingClientRect().top;
        line.selectNodeContents(story.querySelector('.vd-prose > p')!);
        return line.getBoundingClientRect().top - headlineTop;
      });
      for (const sample of [breaking, analysis]) {
        const issue = designIssue(design, sample, 2);
        const item = issue.items.find(candidate => candidate.id === issue.pages[0].itemIds[1])!;
        delete item.observedTurn;
        await mount(page, issue, 1200);
        const undatedAlignment = await alignment();
        item.observedTurn = issue.cutoff.turn - 3;
        await mount(page, issue, 1200);
        expect(await brief.locator('.vd-story-turn').isVisible()).toBe(true);
        expect(await alignment(), issue.pages[0].layout).toBeCloseTo(undatedAlignment, 0);
      }
    } finally { await page.close(); }
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
          const issue = designIssue(design, sample);
          const front = issue.pages[0];
          for (const paperWidth of [360, 1200]) {
            await mount(page, issue, paperWidth);
            const rendered = await measureEdition(page);
            const label = `${id} ${front.layout} at ${paperWidth}px`;
            const [lead, firstBrief, secondBrief] = rendered.stories;
            expect(rendered.overflow, label).toBe(false);
            expect(rendered.stories.map(story => story.id), label).toEqual(front.itemIds);
            if (paperWidth === 360) {
              for (let i = 1; i < rendered.stories.length; i++) {
                expect(rendered.stories[i].top, label).toBeGreaterThanOrEqual(rendered.stories[i - 1].bottom);
              }
            } else if (front.layout === 'ordinary' && id === 'city-extra') {
              expect(firstBrief.top, label).toBeGreaterThanOrEqual(lead.bottom);
              expect(firstBrief.top, label).toBeCloseTo(secondBrief.top, 1);
              expect(secondBrief.left, label).toBeGreaterThanOrEqual(firstBrief.right);
            } else if (front.layout === 'ordinary' && id === 'civic-index') {
              expect(rendered.stories, label).toHaveLength(5);
              expect(firstBrief.top, label).toBeGreaterThanOrEqual(lead.bottom);
              expect(firstBrief.left, label).toBeCloseTo(lead.left, 1);
              expect(secondBrief.top, label).toBeCloseTo(lead.top, 1);
              expect(secondBrief.left, label).toBeGreaterThan(Math.max(lead.right, firstBrief.right));
              expect(secondBrief.width / lead.width, label).toBeCloseTo(3 / 2, 1);
              for (let i = 3; i < rendered.stories.length; i++) {
                expect(rendered.stories[i].left, label).toBeCloseTo(secondBrief.left, 1);
                expect(rendered.stories[i].top, label).toBeGreaterThanOrEqual(rendered.stories[i - 1].bottom);
              }
            } else {
              expect(firstBrief.top, label).toBeGreaterThanOrEqual(lead.bottom);
            }
            if (front.layout === 'analysis') {
              expect(paperWidth === 360 ? rendered.evidenceBelowProse : rendered.evidenceBesideProse, label).toBe(true);
            }
          }
        }
      } finally { await page.close(); }
    }, 60_000,
  );

  it('should pair Swiss section stories and keep secondary analysis evidence under its prose', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const design = (await loadEditorialConfig()).designs.find(candidate => candidate.id === 'civic-index')!;
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const [layout, sample] of [['ordinary', ordinary], ['analysis', analysis]] as const) {
        const issue = designIssue(design, sample);
        const sectionItems = issueDocumentSchema.parse(sample).items.slice(-2);
        if (layout === 'analysis') sectionItems[0].evidenceTable = issue.items[0].evidenceTable;
        issue.items.push(...sectionItems);
        const section = { id: 'home', label: design.pageLabels.home, layout, hasLead: false, itemIds: sectionItems.map(item => item.id) };
        issue.pages.push(section);
        for (const paperWidth of [360, 1200]) {
          await mount(page, issue, paperWidth);
          await page.evaluate(pageId => window.voxDeorumNewspaperExport!.selectPage(pageId), section.id);
          const rendered = await measureEdition(page);
          const label = `${layout} section at ${paperWidth}px`;
          const [lead, brief] = rendered.stories;
          expect(rendered.overflow, label).toBe(false);
          expect(rendered.stories.map(story => story.id), label).toEqual(section.itemIds);
          if (paperWidth === 360) {
            expect(brief.top, label).toBeGreaterThanOrEqual(lead.bottom);
          } else {
            expect(brief.top, label).toBeCloseTo(lead.top, 1);
            expect(brief.left, label).toBeGreaterThanOrEqual(lead.right);
          }
          if (layout === 'analysis') expect(rendered.evidenceBelowProse, label).toBe(true);
        }
      }
    } finally { await page.close(); }
  }, 60_000);

  it('should keep the stock section tabs in aligned rows on narrow paper', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      const { designs } = await loadEditorialConfig();
      for (const [id, width] of [
        ['victorian', 360], ['secession-review', 360], ['shang', 360],
        ['teletext-bulletin', 360], ['oral-accounts', 360], ['oral-accounts', 1000],
      ] as const) {
        const design = designs.find(candidate => candidate.id === id)!;
        const issue = designIssue(design, ordinary);
        issue.items.push(...issueDocumentSchema.parse(ordinary).items.slice(-3));
        for (const [index, [pageId, label]] of [
          ['home', 'At Home'], ['economy', 'Trade and Livelihood'], ['abroad', 'Beyond Our Borders'],
        ].entries()) {
          issue.pages.push({
            id: pageId, label: design.pageLabels[pageId] ?? label, layout: 'ordinary', hasLead: false,
            itemIds: [issue.items[issue.items.length - 3 + index].id],
          });
        }
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

  it('should keep each story in one text column and pair print briefs on wide pages', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const { designs } = await loadEditorialConfig();
    const customBriefs = new Set(['wire', 'civic-index', 'paste-up', 'teletext-bulletin']);
    const page = await browser.newPage();
    const violations: string[] = [];
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const design of designs) {
        const { id } = design;
        for (const sample of [ordinary, breaking, analysis]) {
          const issue = designIssue(design, sample);
          const front = issue.pages[0];
          if (id === 'printed-almanack') {
            front.itemIds.forEach((itemId, index) => {
              issue.items.find(item => item.id === itemId)!.observedTurn = front.itemIds.length - index;
            });
          }
          for (const item of issue.items) {
            item.body = [[{ type: 'text', text: 'The report compares the observations and records how the accounts changed. '.repeat(8).trim() }]];
          }
          for (const width of [360, 1200]) {
            await mount(page, issue, width);
            const stories = await page.locator('.vd-page:not([hidden]) .vd-story').evaluateAll(nodes => nodes.map(node => {
              const { left, right, top, bottom } = node.getBoundingClientRect();
              const prose = node.querySelector('.vd-prose')!;
              const style = getComputedStyle(prose);
              return {
                id: node.getAttribute('data-item-id'),
                left, right, top, bottom,
                split: Number(style.columnCount) > 1 || style.columnWidth !== 'auto',
              };
            }));
            const label = `${id} ${front.layout} at ${width}px`;
            if (stories.some(story => story.split)) violations.push(`${label}: split story prose`);
            if (customBriefs.has(id)) continue;
            const [lead, first, second] = stories;
            const readingOrder = id === 'printed-almanack'
              ? [front.itemIds[0], ...front.itemIds.slice(1).reverse()]
              : front.itemIds;
            if (stories.some((story, index) => story.id !== readingOrder[index])) violations.push(`${label}: story order`);
            const paired = Math.abs(first.top - second.top) <= 1 && first.right <= second.left + 1;
            const stacked = first.bottom <= second.top + 1;
            if (lead.bottom > first.top + 1 || (width === 1200 ? !paired : !stacked)) {
              violations.push(`${label}: briefs should ${width === 1200 ? 'pair below the lead' : 'stack below the lead'}`);
            }
          }
        }
      }
      expect(violations).toEqual([]);
    } finally { await page.close(); }
  }, 120_000);

  it('should give a lone urgent brief the full row on the Contact Sheet', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      const design = (await loadEditorialConfig()).designs.find(candidate => candidate.id === 'contact-sheet')!;
      const articles = page.locator('.vd-page:not([hidden]) .vd-story');
      for (const sample of [breaking, analysis]) {
        const issue = designIssue(design, sample, 2);
        for (const width of [760, 761, 1200]) {
          await mount(page, issue, width);
          const boxes = await articles.evaluateAll(nodes => nodes.map(node => ({
            width: node.getBoundingClientRect().width,
            copyWidth: node.querySelector('.vd-prose')!.getBoundingClientRect().width,
          })));
          const label = `${issue.pages[0].layout} at ${width}px`;
          expect(boxes, label).toHaveLength(2);
          expect(boxes[1].width, label).toBeCloseTo(boxes[0].width, 1);
          if (width === 1200) expect(boxes[1].copyWidth, label).toBeLessThan(boxes[1].width * .8);
        }
      }
    } finally { await page.close(); }
  }, 60_000);
});
