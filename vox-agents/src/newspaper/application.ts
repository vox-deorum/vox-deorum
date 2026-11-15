/** Own the dashboard's lazy shared renderer, sample delivery, and draining shutdown. */
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hashReaderAssets, NewspaperCache } from './export/cache.js';
import { readerDirectory } from './export/http.js';
import { NewspaperExportService, type NewspaperDelivery } from './export/service.js';
import { buildLuaFixturePayload } from './export/lua-fixture.js';
import { defaultRenderProfile } from './renderer/layout.js';
import { parseIssueDocument } from './renderer/validation.js';
import { NewspaperGameDelivery } from './game-delivery.js';
import type { ShowNewspaperResponse } from '../types/index.js';

export interface NewspaperRenderer { service: NewspaperExportService; cacheRoot: string }
export interface NewspaperApplicationOptions {
  url: () => string;
  createRenderer?: () => Promise<NewspaperRenderer>;
  readSample?: () => Promise<unknown>;
  game?: Pick<NewspaperGameDelivery, 'prepare' | 'deliver'>;
}

/** Load the single runtime sample produced from the existing Victorian ordinary fixture. */
async function readRuntimeSample(): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path.join(readerDirectory, 'sample.json'), 'utf8'));
  } catch (error) {
    throw new Error('The newspaper sample is unavailable. Run npm run build:newspaper in vox-agents.', { cause: error });
  }
}

/** Resolve compiled assets and the disposable cache only when an export actually needs them. */
async function createRuntimeRenderer(url: () => string): Promise<NewspaperRenderer> {
  let assetsHash: string;
  try {
    await access(path.join(readerDirectory, 'export.html'));
    assetsHash = await hashReaderAssets(readerDirectory);
  } catch (error) {
    throw new Error('The newspaper reader is unavailable. Run npm run build:newspaper in vox-agents.', { cause: error });
  }
  const cache = new NewspaperCache(fileURLToPath(new URL('../../data/newspaper-cache/', import.meta.url)));
  return {
    service: new NewspaperExportService({ url, profile: defaultRenderProfile, format: 'BC1_UNORM', cache, assetsHash }),
    cacheRoot: cache.root,
  };
}

/** Share initialization and queue across generic exports and debug requests in the existing web process. */
export class NewspaperApplication {
  private initialization?: Promise<NewspaperRenderer>;
  private renderer?: NewspaperRenderer;
  private readonly jobs = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  private readonly game: Pick<NewspaperGameDelivery, 'prepare' | 'deliver'>;

  /** Accept small lifecycle dependencies so orchestration tests do not launch games or browsers. */
  constructor(private readonly options: NewspaperApplicationOptions) {
    this.game = options.game ?? new NewspaperGameDelivery();
  }

  /** Export publication data without activating a reader or changing the game's retained bundle. */
  exportIssue(input: unknown, deliver?: NewspaperDelivery) {
    return this.run(async () => (await this.getRenderer()).service.exportIssue(input, deliver));
  }

  /** Prepare the active seat, render the packaged sample, then deliver within the shared export queue. */
  showSample(): Promise<ShowNewspaperResponse> {
    return this.run(async () => {
      const prepared = await this.game.prepare();
      const sample = parseIssueDocument(await (this.options.readSample ?? readRuntimeSample)());
      sample.receiver.playerId = prepared.receiver;
      const { service, cacheRoot } = await this.getRenderer();
      const cached = await service.exportIssue(sample, async (issue, bundle) => {
        await this.game.deliver(prepared, buildLuaFixturePayload(issue, bundle, cacheRoot));
      });
      return { success: true, issueId: sample.issueId, key: cached.key };
    });
  }

  /** Reject new work, let accepted requests finish against the live HTTP address, then close the browser. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.allSettled([...this.jobs]);
      await this.renderer?.service.close();
    })();
    return this.closing;
  }

  /** Share an in-flight initialization and clear failures so later requests can retry. */
  private getRenderer(): Promise<NewspaperRenderer> {
    this.initialization ??= (this.options.createRenderer?.() ?? createRuntimeRenderer(this.options.url))
      .then(renderer => { this.renderer = renderer; return renderer; })
      .catch(error => { this.initialization = undefined; throw error; });
    return this.initialization;
  }

  /** Track the entire accepted request, including preparation and initialization, for shutdown. */
  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Newspaper export service is shutting down.'));
    const job = Promise.resolve().then(operation);
    this.jobs.add(job);
    job.then(() => this.jobs.delete(job), () => this.jobs.delete(job));
    return job;
  }
}
