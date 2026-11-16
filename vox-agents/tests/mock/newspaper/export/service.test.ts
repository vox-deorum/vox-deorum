/** Check serialized delivery, error recovery, and draining shutdown without launching a browser. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewspaperExportService } from '../../../../src/newspaper/export/service.js';
import { NewspaperCache } from '../../../../src/newspaper/export/cache.js';
import { NewspaperBrowser } from '../../../../src/newspaper/export/browser.js';
import { createNewspaperBundle, createNewspaperIssue, newspaperTestProfile } from '../../../helpers/newspaper-fixtures.js';
import { renderCacheKey } from '../../../../src/newspaper/export/cache.js';

/** Configure cache hits so orchestration can be checked independently of capture and disk I/O. */
function createService() {
  const cache = new NewspaperCache('unused-test-cache');
  const cached = { key: 'a'.repeat(64), directory: 'unused-test-cache/bundle', bundle: createNewspaperBundle() };
  const lookup = vi.spyOn(cache, 'getOrCreate').mockImplementation(async key => {
    cached.key = key;
    return cached;
  });
  const pin = vi.spyOn(cache, 'pin').mockResolvedValue();
  const close = vi.spyOn(NewspaperBrowser.prototype, 'close').mockResolvedValue();
  const service = new NewspaperExportService({
    url: () => 'http://127.0.0.1:8788', profile: newspaperTestProfile, format: 'BC1_UNORM',
    cache, assetsHash: 'test-assets',
  });
  return { service, lookup, pin, close, cached };
}

afterEach(() => vi.restoreAllMocks());

describe('newspaper export service', () => {
  it('should export a configurable design using its stored renderer family and content cache key', async () => {
    const { service, lookup } = createService();
    const issue = createNewspaperIssue();
    issue.publication.designId = 'early-account';
    issue.publication.presentation = { schemaVersion: 1, rendererFamily: 'modern', tokens: { paperColor: '#ffffff' } };
    await service.exportIssue(issue);
    expect(lookup.mock.calls[0][2]).toMatchObject({ designId: 'modern' });
    const firstKey = lookup.mock.calls[0][0];
    issue.publication.presentation.tokens!.paperColor = '#ffeed0';
    await service.exportIssue(issue);
    expect(lookup.mock.calls[1][0]).not.toBe(firstKey);
    await service.close();
  });

  it('should keep delivery and pinning ahead of subsequent exports and drain them before closing', async () => {
    let finishDelivery!: () => void;
    const delivered = new Promise<void>(resolve => { finishDelivery = resolve; });
    const deliver = vi.fn().mockReturnValueOnce(delivered).mockResolvedValue(undefined);
    const { service, lookup, pin, close, cached } = createService();
    const first = service.exportIssue(createNewspaperIssue(), deliver);
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    const second = service.exportIssue(createNewspaperIssue(), deliver);
    const shutdown = service.close();
    expect(service.close()).toBe(shutdown);
    await expect(service.exportIssue(createNewspaperIssue())).rejects.toThrow();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(pin).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    finishDelivery();
    expect(await first).toBe(cached);
    expect(await second).toBe(cached);
    await shutdown;
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(pin).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('should recover after a failed delivery without replacing the retained fixture', async () => {
    const deliver = vi.fn().mockRejectedValueOnce(new Error('Delivery failed')).mockResolvedValue(undefined);
    const { service, pin, cached } = createService();
    await expect(service.exportIssue(createNewspaperIssue(), deliver)).rejects.toThrow('Delivery failed');
    expect(pin).not.toHaveBeenCalled();
    expect(await service.exportIssue(createNewspaperIssue(), deliver)).toBe(cached);
    expect(pin).toHaveBeenCalledExactlyOnceWith(cached.key);
    await service.close();
  });

  it('should reject invalid input before cache lookup and continue accepting valid issues', async () => {
    const { service, lookup } = createService();
    await expect(service.exportIssue({})).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    await service.exportIssue(createNewspaperIssue());
    expect(lookup).toHaveBeenCalledTimes(1);
    await service.close();
  });

  it('should export without pinning or reusing an earlier requests delivery callback', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { service, pin } = createService();
    await service.exportIssue(createNewspaperIssue(), deliver);
    await service.exportIssue(createNewspaperIssue());
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(pin).toHaveBeenCalledTimes(1);
    await service.close();
  });

  it('should snapshot each queued profile override and restore the constructor profile for generic exports', async () => {
    const { service, lookup } = createService();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const deliver = vi.fn().mockReturnValueOnce(blocked);
    const issue = createNewspaperIssue();
    const first = service.exportIssue(issue, deliver);
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce());
    const override = { ...newspaperTestProfile, paperWidth: 200.015625, displayScale: 1.5 };
    const expectedProfile = { ...override };
    const second = service.exportIssue(issue, undefined, override);
    override.paperWidth = 320;
    override.displayScale = 2;
    const third = service.exportIssue(issue);
    expect(lookup).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second, third]);
    expect(lookup.mock.calls.map(([key]) => key)).toEqual([
      renderCacheKey(issue, newspaperTestProfile, 'test-assets', 'BC1_UNORM'),
      renderCacheKey(issue, expectedProfile, 'test-assets', 'BC1_UNORM'),
      renderCacheKey(issue, newspaperTestProfile, 'test-assets', 'BC1_UNORM'),
    ]);
    expect(lookup.mock.calls[1][2]?.profile).toEqual(expectedProfile);
    expect(lookup.mock.calls[2][2]?.profile).toEqual(newspaperTestProfile);
    await service.close();
  });

  it('should reject invalid per-call profiles before entering the queue or cache', async () => {
    const { service, lookup } = createService();
    await expect(service.exportIssue(createNewspaperIssue(), undefined, { ...newspaperTestProfile, paperWidth: 40 })).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
    await service.exportIssue(createNewspaperIssue());
    expect(lookup).toHaveBeenCalledOnce();
    await service.close();
  });
});
