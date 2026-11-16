import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveIssue } from '../contracts/archive.js';
import type { NewspaperExportBridge } from '../renderer/bridge.js';
import { launchInstalledBrowser } from '../export/browser.js';
import { readerDirectory, startNewspaperHost } from '../export/http.js';

type ExportGlobal = typeof globalThis & { voxDeorumNewspaperExport: NewspaperExportBridge };

/** Saved complete-page PNGs associated with one published cutoff. */
export interface NewspaperPng {
  turn: number;
  pageId: string;
  file: string;
}

/** Require the compiled shared reader before starting an optional capture batch. */
export async function requireBuiltReader(): Promise<void> {
  try { await access(path.join(readerDirectory, 'export.html')); }
  catch { throw new Error('PNG examples require the compiled newspaper reader. Run npm run build:newspaper -w vox-agents first.'); }
}

/** Capture each expanded page with its masthead using the production browser export bridge. */
export async function renderNewspaperExamples(issues: ArchiveIssue[], directory: string, signal?: AbortSignal,
  images: NewspaperPng[] = []): Promise<NewspaperPng[]> {
  await requireBuiltReader();
  const host = await startNewspaperHost();
  let browser: Awaited<ReturnType<typeof launchInstalledBrowser>> | undefined;
  try {
    browser = await launchInstalledBrowser();
    const context = await browser.newContext({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1,
      locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === host.url ? route.continue() : route.abort());
      const page = await context.newPage();
      const failedAssets: string[] = [];
      page.on('requestfailed', request => { failedAssets.push(request.url()); });
      page.on('response', response => { if (response.status() >= 400) failedAssets.push(response.url()); });
      await page.goto(`${host.url}/newspaper/export.html`);
      const profile = { viewportWidth: 1000, viewportHeight: 720, paperWidth: 1000, displayScale: 1,
        textScale: 1, rasterScale: 1, maxTextureWidth: 4096, maxTextureHeight: 2048, scrollbarGutter: 0 };
      for (const { issue } of issues) {
        signal?.throwIfAborted();
        await page.evaluate(async ({ issue, profile }) => (globalThis as ExportGlobal).voxDeorumNewspaperExport.mount(issue, profile), { issue, profile });
        if (failedAssets.length) throw new Error(`Reader assets failed to load: ${failedAssets.join(', ')}`);
        for (const [index, section] of issue.pages.entries()) {
          signal?.throwIfAborted();
          await page.evaluate(pageId => (globalThis as ExportGlobal).voxDeorumNewspaperExport.selectPage(pageId), section.id);
          await page.evaluate(() => (globalThis as ExportGlobal).voxDeorumNewspaperExport.measurePage());
          if (failedAssets.length) throw new Error(`Reader assets failed to load: ${failedAssets.join(', ')}`);
          const file = `issue-${issue.cutoff.turn}-page-${index + 1}.png`;
          await page.locator('#newspaper-export-root').screenshot({ path: path.join(directory, file), animations: 'disabled' });
          if (failedAssets.length) {
            await rm(path.join(directory, file), { force: true });
            throw new Error(`Reader assets failed to load: ${failedAssets.join(', ')}`);
          }
          images.push({ turn: issue.cutoff.turn, pageId: section.id, file });
        }
      }
    } finally { await context.close(); }
    return images;
  } finally {
    try { await browser?.close(); } finally { await host.close(); }
  }
}
