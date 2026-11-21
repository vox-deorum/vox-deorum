/** Verify that the Civic Survey reads evidence first and distinguishes missing returns from zero. */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { launchInstalledBrowser } from '../../../../src/newspaper/export/browser.js';
import { readerDirectory, startNewspaperHost } from '../../../../src/newspaper/export/http.js';
import { defaultRenderProfile } from '../../../../src/newspaper/renderer/layout.js';
import { createNewspaperIssue } from '../../../helpers/newspaper-fixtures.js';

describe.skipIf(!existsSync(`${readerDirectory}/export.html`))('Civic Survey evidence', () => {
  let browser: Browser | undefined;
  let host: Awaited<ReturnType<typeof startNewspaperHost>>;
  let unavailable: string | undefined;

  beforeAll(async () => {
    try { browser = await launchInstalledBrowser(); }
    catch (error) { unavailable = String(error); }
    host = await startNewspaperHost();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await host?.close();
  });

  it('should show comparable percentages before the prose and leave missing or mixed values uncharted', async context => {
    if (!browser) { context.skip(unavailable); return; }
    const issue = createNewspaperIssue();
    issue.publication.designId = 'civic-survey';
    issue.publication.presentation.rendererFamily = 'folio';
    issue.pages = issue.pages.filter(page => page.layout === 'analysis');
    const evidence = {
      title: 'Trade share',
      description: 'Largest partner share of foreign trade income',
      columns: ['Turn', 'Share'],
      rows: [
        { label: 'First', values: ['30%'] },
        { label: 'Second', values: ['No record'], hasMissingValues: true },
        { label: 'Third', values: ['0%'] },
        { label: 'Fourth', values: ['60%'] },
      ],
    };
    issue.items[0].evidenceTable = evidence;
    const page = await browser.newPage();
    try {
      await page.goto(`${host.url}/newspaper/export.html`);
      for (const paperWidth of [320, 1100]) {
        await page.evaluate(({ issue, profile }) => window.voxDeorumNewspaperExport!.mount(issue, profile), {
          issue, profile: { ...defaultRenderProfile, paperWidth },
        });
        const table = page.getByRole('table', { name: /Trade share/ });
        const tableBox = await table.boundingBox();
        const proseBox = await page.locator('.vd-prose').boundingBox();
        expect(tableBox!.y + tableBox!.height).toBeLessThan(proseBox!.y);
        const cells = table.locator('tbody td');
        expect(await cells.allTextContents()).toEqual(evidence.rows.map(row => row.values[0]));
        const bars = await cells.evaluateAll(entries => entries.map(cell => {
          const bar = cell.querySelector('[aria-hidden="true"]');
          return bar ? parseFloat(getComputedStyle(bar, '::before').width) : null;
        }));
        expect(bars[0]).toBeGreaterThan(0);
        expect(bars[1]).toBeNull();
        expect(bars[2]).toBe(0);
        expect(bars[3]).toBeCloseTo(bars[0]! * 2, 1);
      }

      evidence.rows[2].values = ['4 routes'];
      await page.evaluate(({ issue, profile }) => window.voxDeorumNewspaperExport!.mount(issue, profile), {
        issue, profile: defaultRenderProfile,
      });
      expect(await page.getByRole('cell', { name: '4 routes' }).count()).toBe(1);
      expect(await page.locator('.vd-evidence td [aria-hidden="true"]').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
