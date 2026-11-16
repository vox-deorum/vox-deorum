/** Reusable serialized export, cache delivery, and browser shutdown lifecycle. */
import { launchInstalledBrowser, NewspaperBrowser } from './browser.js';
import { NewspaperCache, renderCacheKey, type CachedBundle } from './cache.js';
import { renderIssue } from './render.js';
import type { DdsFormat } from './dds.js';
import type { RenderProfile } from '../contracts/render.js';
import { parseIssueDocument, parseRenderProfile, validateRenderProfileForDesign } from '../renderer/validation.js';
import type { IssueDocument } from '../contracts/issue.js';
import { getPublicationRendererFamily } from '../renderer/presentation.js';

export interface NewspaperExportOptions {
  url: () => string;
  profile: RenderProfile;
  format: DdsFormat;
  cache: NewspaperCache;
  assetsHash: string;
  browserExecutable?: string;
}

export type NewspaperDelivery = (issue: IssueDocument, cached: CachedBundle) => Promise<void>;

/** Keep delivery in the export queue so the next job cannot evict a pending handoff. */
export class NewspaperExportService {
  private readonly worker: NewspaperBrowser;
  private readonly profile: RenderProfile;
  private pending: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;

  /** Configure a renderer independently of CLI parsing, fixture paths, or the HTTP host. */
  constructor(private readonly options: NewspaperExportOptions) {
    this.profile = parseRenderProfile(options.profile);
    this.worker = new NewspaperBrowser(() => launchInstalledBrowser(options.browserExecutable));
  }

  /** Accept one issue and serialize capture, delivery, and retention with earlier requests. */
  exportIssue(input: unknown, deliver?: NewspaperDelivery, profileOverride?: RenderProfile): Promise<CachedBundle> {
    if (this.closing) return Promise.reject(new Error('Newspaper export service is closed.'));
    let profile: RenderProfile;
    let issue: IssueDocument;
    try {
      profile = parseRenderProfile(profileOverride ?? this.profile);
      issue = parseIssueDocument(input);
      validateRenderProfileForDesign(profile, getPublicationRendererFamily(issue.publication));
    } catch (error) {
      return Promise.reject(error);
    }
    const result = this.pending.then(() => this.exportDocument(issue, profile, deliver));
    this.pending = result.catch(() => undefined);
    return result;
  }

  /** Stop accepting work, drain accepted requests, and release the browser exactly once. */
  close(): Promise<void> {
    this.closing ??= this.pending.then(() => this.worker.close());
    return this.closing;
  }

  /** Reuse a validated cache entry or render it before handing it to the owning application. */
  private async exportDocument(issue: IssueDocument, profile: RenderProfile, deliver?: NewspaperDelivery): Promise<CachedBundle> {
    const { cache, assetsHash, format, url } = this.options;
    const key = renderCacheKey(issue, profile, assetsHash, format);
    const cached = await cache.getOrCreate(key,
      directory => renderIssue(this.worker, url(), issue, profile, directory, format), {
        issueId: issue.issueId, campaignId: issue.campaignId, timelineId: issue.timelineId,
        designId: getPublicationRendererFamily(issue.publication), designVersion: issue.publication.designVersion,
        profile,
      });
    if (deliver) {
      await deliver(issue, cached);
      await cache.pin(key);
    }
    return cached;
  }
}
