import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import { launchInstalledBrowser } from '../../../src/newspaper/export/browser.js';
import { defaultRenderProfile } from '../../../src/newspaper/renderer/layout.js';
import { errorMessage } from '../../../src/utils/errors.js';
import { createLogger } from '../../../src/utils/logger.js';

const configFile = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));
const defaultOutput = fileURLToPath(new URL('../../../../.tmp/newspaper-screenshots/', import.meta.url));
const logger = createLogger('Newspaper Screenshots');

/** Capture the full sample front page for each selected layout in the source catalogue. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      design: { type: 'string' },
      layout: { type: 'string' },
      output: { type: 'string' },
      width: { type: 'string', default: '1000' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    process.stdout.write('Usage: npm run newspaper:screenshots -w vox-agents -- [--design ID] [--layout ID] [--width PIXELS] [--output DIRECTORY]\n');
    return;
  }
  const width = Number(values.width);
  if (!Number.isInteger(width) || width < 320 || width > defaultRenderProfile.maxTextureWidth) {
    throw new Error(`--width must be a whole number from 320 to ${defaultRenderProfile.maxTextureWidth}.`);
  }
  const output = values.output === undefined ? defaultOutput
    : path.resolve(process.env.INIT_CWD ?? process.cwd(), values.output);
  const viewport = { width: Math.ceil(width / 4) * 4, height: defaultRenderProfile.viewportHeight };
  const profile = { ...defaultRenderProfile, viewportWidth: viewport.width, paperWidth: width, rasterScale: 1, scrollbarGutter: 0 };

  const server = await createServer({
    configFile,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, ws: false, watch: null },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('The screenshot server has no TCP listener.');
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await launchInstalledBrowser();
    try {
      const page = await browser.newPage({
        viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC',
        colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block',
      });
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const failed = new Set<string>();
      page.on('requestfailed', request => { failed.add(request.url()); });
      page.on('response', response => { if (response.status() >= 400) failed.add(response.url()); });
      await page.goto(`${origin}/export.html`);
      await page.locator('#newspaper-export-root').evaluate(root => { root.setAttribute('data-preview-screenshot', ''); });
      const samples = await page.evaluate(async ({ moduleUrl, designId, layoutId }) => {
        const { createPreviewIssue, readPreviewDesigns }: typeof import('./issue.js') = await import(moduleUrl);
        return readPreviewDesigns().filter(design => designId === undefined || design.id === designId).flatMap(design =>
          design.layouts.filter(layout => layoutId === undefined || layout.id === layoutId).map(layout => ({
            designId: design.id, layoutId: layout.id, issue: createPreviewIssue(design, layout),
          }))
        );
      }, { moduleUrl: '/src/preview/issue.ts', designId: values.design, layoutId: values.layout });
      if (!samples.length) throw new Error(`No built-in newspaper layouts match design "${values.design ?? '*'}" and layout "${values.layout ?? '*'}".`);

      for (const { designId, layoutId, issue } of samples) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(designId)) throw new Error(`Invalid design ID for a screenshot directory: ${designId}`);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(layoutId)) throw new Error(`Invalid layout ID for a screenshot filename: ${layoutId}`);
        await page.evaluate(async ({ issue, profile }) => {
          const bridge = window.voxDeorumNewspaperExport!;
          await bridge.mount(issue, profile);
          await bridge.selectPage('front');
        }, { issue, profile });
        const png = await page.locator('#newspaper-export-root .vd-publication').screenshot({ animations: 'disabled', type: 'png' });
        if (failed.size) throw new Error(`Assets failed to load for ${designId}/${layoutId}: ${[...failed].join(', ')}`);
        const directory = path.join(output, designId);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, `${layoutId}.png`), png);
      }
      logger.info(`Saved ${samples.length} newspaper screenshots to ${output}.`);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}

void main().catch(error => {
  logger.error(errorMessage(error));
  process.exitCode = 1;
});
