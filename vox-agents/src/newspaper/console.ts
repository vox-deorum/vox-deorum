/** Standalone newspaper fixture reader and texture export command. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createLogger } from '../utils/logger.js';
import { processManager } from '../infra/process-manager.js';
import { errorMessage } from '../utils/errors.js';
import { launchInstalledBrowser, NewspaperBrowser } from './renderer/browser.js';
import { hashReaderAssets, NewspaperCache, renderCacheKey } from './cache/cache.js';
import { startNewspaperHost, readerDirectory } from './host/http.js';
import { renderIssue } from './renderer/render.js';
import { defaultRenderProfile } from './ui/layout.js';
import { parseIssueDocument, parseRenderProfile } from './contracts/validation.js';
import { writeLuaFixture } from './host/fixture.js';
import type { DdsFormat } from './renderer/dds.js';

const logger = createLogger('Newspaper');

/** Start only the fixture host and optional export, with normal process-manager cleanup. */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    port: { type: 'string', default: '8788' }, issue: { type: 'string' },
    export: { type: 'boolean', default: false }, once: { type: 'boolean', default: false },
    profile: { type: 'string' }, browser: { type: 'string' }, cache: { type: 'string' },
    'cache-mib': { type: 'string', default: '256' }, format: { type: 'string', default: 'BC1_UNORM' },
    lua: { type: 'string' }, help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    logger.info('newspaper [--port 8788] [--issue issue.json --export --once] [--profile profile.json] [--format BC1_UNORM|B8G8R8A8_UNORM] [--browser executable] [--cache directory] [--cache-mib 256] [--lua fixture.lua]');
    return;
  }
  const port = Number(values.port);
  const maxBytes = Number(values['cache-mib']) * 1024 * 1024;
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('Invalid newspaper port or cache limit.');
  if (!['BC1_UNORM', 'B8G8R8A8_UNORM'].includes(values.format!)) throw new Error('Unsupported DDS format.');
  if (values.export && !values.issue) throw new Error('--export requires --issue with a fixture JSON path.');
  const format = values.format as DdsFormat;
  const profile = values.profile ? parseRenderProfile(JSON.parse(await readFile(values.profile, 'utf8'))) : defaultRenderProfile;
  const worker = new NewspaperBrowser(() => launchInstalledBrowser(values.browser));
  const cache = new NewspaperCache(path.resolve(values.cache ?? fileURLToPath(new URL('../../data/newspaper-cache/', import.meta.url))), maxBytes);
  const assetsHash = await hashReaderAssets(readerDirectory);
  const fixtureDirectory = fileURLToPath(new URL('../../newspaper-reader/fixtures/', import.meta.url));
  const destination = path.resolve(values.lua ?? fileURLToPath(new URL('../../../civ5-mod/UI/VoxDeorumNewspaperFixture.lua', import.meta.url)));
  let pendingExport: Promise<unknown> = Promise.resolve();
  const host = await startNewspaperHost({ port, fixtureDirectory,
    /** Validate API content and reuse the same export path as the CLI. */
    exportIssue: queueExport,
  });
  /** Close worker before host so accepted browser requests can finish. */
  async function close(): Promise<void> { await pendingExport; await worker.close(); await host.close(); }
  processManager.register('newspaper', close);
  /** Serialize fixture delivery so another export cannot evict textures before they are pinned. */
  function queueExport(input: unknown) {
    const result = pendingExport.then(() => exportDocument(input));
    pendingExport = result.catch(() => undefined);
    return result;
  }
  /** Export a fixture atomically, deliver Lua data, and retain the displayed bundle. */
  async function exportDocument(input: unknown) {
    const issue = parseIssueDocument(input);
    const key = renderCacheKey(issue, profile, assetsHash, format);
    const start = performance.now();
    const cached = await cache.getOrCreate(key, directory => renderIssue(worker, host.url, issue, profile, directory, format), {
      issueId: issue.issueId, campaignId: issue.campaignId, timelineId: issue.timelineId,
      designId: issue.publication.designId, designVersion: issue.publication.designVersion, profile,
    });
    await cache.pin(key);
    await writeLuaFixture(destination, issue, cached, cache.root);
    logger.info('Newspaper fixture exported', { key, milliseconds: Math.round(performance.now() - start), directory: cached.directory, lua: destination });
    return { key, bundle: cached.bundle };
  }
  logger.info(`Newspaper reader: ${host.url}/newspaper/`);
  try {
    if (values.export) await queueExport(JSON.parse(await readFile(values.issue!, 'utf8')));
    if (values.once) await close();
  } catch (error) {
    await close();
    throw error;
  }
}

void main().catch(error => { logger.error(errorMessage(error)); process.exitCode = 1; });
