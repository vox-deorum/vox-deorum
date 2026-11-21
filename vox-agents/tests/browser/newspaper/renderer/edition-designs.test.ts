/** Exercise the manuscript, city daily and civic bulletin in the export reader. */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import ordinary from '../../../../newspaper/fixtures/victorian-ordinary.json';
import breaking from '../../../../newspaper/fixtures/victorian-breaking.json';
import analysis from '../../../../newspaper/fixtures/victorian-analysis.json';
import { issueDocumentSchema } from '../../../../src/newspaper/contracts/issue.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { startNewspaperHost, readerDirectory } from '../../../../src/newspaper/export/http.js';
import { defaultRenderProfile } from '../../../../src/newspaper/renderer/layout.js';

describe.skipIf(!existsSync(`${readerDirectory}/export.html`))('palm leaf, city extra and civic index editions', () => {
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

  it.for(['palm-leaf-register', 'city-extra', 'civic-index'] as const)(
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
            if (paperWidth === 360 || id === 'palm-leaf-register') {
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
});
