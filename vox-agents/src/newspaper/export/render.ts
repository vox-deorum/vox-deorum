/** Export publication pixels and action geometry from the same settled browser layout. */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { NewspaperBrowser } from './browser.js';
import { convertDds, type DdsFormat } from './dds.js';
import {
  parseIssueDocument,
  parseRenderProfile,
  validateRenderProfileForDesign,
} from '../renderer/validation.js';
import { validateRenderBundle } from '../renderer/bundle.js';
import {
  newspaperRendererVersion,
  newspaperRenderBundleSchemaVersion,
  type CapturePlan,
  type NewspaperExportBridge,
  type RenderBundle,
  type RenderProfile,
  type RenderStrip,
} from '../renderer/types.js';
import type { IssueDocument } from '../contracts/issue.js';

/** Type the fixed browser bridge without introducing DOM globals to the backend compiler. */
type ExportGlobal = typeof globalThis & { voxDeorumNewspaperExport: NewspaperExportBridge };

/** Capture and convert a region in bounded strips, recording padding separately. */
async function captureRegion(page: Page, capture: CapturePlan, prefix: string, directory: string,
  profile: RenderProfile, format: DdsFormat): Promise<RenderStrip[]> {
  const strips: RenderStrip[] = [];
  for (const strip of capture.strips) {
    const pngPath = path.join(directory, `${prefix}-${strip.index}.png`);
    const pixelWidth = Math.ceil(strip.clip.width * profile.rasterScale / 4) * 4;
    const pixelHeight = Math.ceil(strip.visibleHeight * profile.rasterScale / 4) * 4;
    if (pixelWidth > profile.maxTextureWidth || pixelHeight > profile.maxTextureHeight) {
      throw new Error('Padded newspaper strip exceeds the texture limit.');
    }
    await page.screenshot({ path: pngPath, type: 'png', fullPage: true, animations: 'disabled', clip: {
      x: capture.origin.x + strip.clip.x, y: capture.origin.y + strip.clip.y,
      width: pixelWidth / profile.rasterScale, height: pixelHeight / profile.rasterScale,
    } });
    const converted = await convertDds(pngPath, directory, format);
    if (converted.width !== pixelWidth || converted.height !== pixelHeight) throw new Error(`Browser capture ${converted.width}x${converted.height} differs from ${pixelWidth}x${pixelHeight} for ${prefix}-${strip.index}.`);
    await rm(pngPath);
    strips.push({ ...strip, fileName: path.basename(converted.path), pixelWidth, pixelHeight });
  }
  return strips;
}

/** Render a validated issue using only local reader assets and an installed browser. */
export async function renderIssue(worker: NewspaperBrowser, hostUrl: string, issueInput: IssueDocument,
  profileInput: RenderProfile, directory: string, format: DdsFormat = 'BC1_UNORM'): Promise<RenderBundle> {
  const issue = parseIssueDocument(issueInput);
  const profile = parseRenderProfile(profileInput);
  validateRenderProfileForDesign(profile, issue.publication.designId);
  if (![1, 2].includes(profile.rasterScale) || profile.maxTextureWidth > 4096 || profile.maxTextureHeight > 4096
    || profile.maxTextureHeight % 4 !== 0) throw new Error('Use raster scale 1 or 2 and texture limits up to 4096, with height divisible by four.');
  return worker.run(async browser => {
    const context = await browser.newContext({
      viewport: { width: profile.viewportWidth, height: profile.viewportHeight },
      deviceScaleFactor: profile.rasterScale, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light',
      reducedMotion: 'reduce', serviceWorkers: 'block',
    });
    try {
      const origin = new URL(hostUrl).origin;
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage();
      const failedAssets: string[] = [];
      page.on('requestfailed', request => { failedAssets.push(request.url()); });
      page.on('response', response => { if (response.status() >= 400) failedAssets.push(response.url()); });
      await page.goto(`${hostUrl}/newspaper/export.html`);
      await page.evaluate(async ({ issue, profile }) => (globalThis as ExportGlobal).voxDeorumNewspaperExport.mount(issue, profile), { issue, profile });
      const header = await page.evaluate(() => (globalThis as ExportGlobal).voxDeorumNewspaperExport.measureHeader());
      const headerStrips = await captureRegion(page, header.capture, 'header', directory, profile, format);
      const pages: RenderBundle['pages'] = [];
      for (const [index, section] of issue.pages.entries()) {
        await page.evaluate(pageId => (globalThis as ExportGlobal).voxDeorumNewspaperExport.selectPage(pageId), section.id);
        const measured = await page.evaluate(() => (globalThis as ExportGlobal).voxDeorumNewspaperExport.measurePage());
        if (Math.abs(measured.layout.contentWidth - profile.contentWidth) > 0.1) throw new Error('Publication content width changed during export.');
        pages.push({
          pageId: section.id, layout: section.layout, width: measured.capture.size.width, height: measured.capture.size.height,
          contentHeight: measured.contentHeight, contentWidth: measured.layout.contentWidth,
          scrollbarGutter: measured.layout.scrollbarGutter,
          strips: await captureRegion(page, measured.capture, `page-${index}`, directory, profile, format),
          actions: measured.actions, voteSlots: measured.voteSlots,
        });
      }
      const iconIds = new Set(pages.flatMap(section => section.voteSlots.flatMap(slot => [slot.neutralAssetId, slot.selectedAssetId])));
      for (const id of iconIds) {
        await page.evaluate(assetId => (globalThis as ExportGlobal).voxDeorumNewspaperExport.mountVoteIcon(assetId), id);
        const pngPath = path.join(directory, `${id}.png`);
        await page.screenshot({ path: pngPath, type: 'png', clip: { x: 0, y: 0, width: 24, height: 24 } });
        await convertDds(pngPath, directory, format);
        await rm(pngPath);
      }
      if (failedAssets.length) throw new Error(`Reader assets could not load: ${failedAssets.join(', ')}`);
      return validateRenderBundle({
        schemaVersion: newspaperRenderBundleSchemaVersion, rendererVersion: newspaperRendererVersion,
        browserVersion: browser.version(), issueId: issue.issueId, campaignId: issue.campaignId, timelineId: issue.timelineId,
        designId: issue.publication.designId, designVersion: issue.publication.designVersion, profile,
        header: { width: header.capture.size.width, height: header.capture.size.height, strips: headerStrips, actions: header.actions, tabs: header.tabs }, pages,
      });
    } finally {
      await context.close();
    }
  });
}
