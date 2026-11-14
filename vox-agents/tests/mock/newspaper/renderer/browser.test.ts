/** Verify browser ownership without depending on an installed browser. */
import { describe, it, expect, vi } from 'vitest';
import type { Browser } from 'playwright-core';
import { NewspaperBrowser } from '../../../../src/newspaper/renderer/browser.js';

/** Create only the browser lifecycle methods used by the worker. */
function fakeBrowser() {
  return { isConnected: () => true, close: vi.fn(async () => undefined) } as unknown as Browser;
}

describe('newspaper browser lifecycle', () => {
  it('should share a process within a batch and wait for accepted work during shutdown', async () => {
    const browser = fakeBrowser();
    const launch = vi.fn(async () => browser);
    const worker = new NewspaperBrowser(launch);
    const order: number[] = [];
    const first = worker.run(async () => { order.push(1); return 1; });
    const second = worker.run(async () => { order.push(2); return 2; });
    await worker.close();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual([1, 2]);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    await expect(worker.run(async () => 3)).rejects.toThrow();
  });

  it('should allow a later request after browser absence or an export failure', async () => {
    const browser = fakeBrowser();
    const launch = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(browser);
    const worker = new NewspaperBrowser(launch);
    await expect(worker.run(async () => 1)).rejects.toThrow();
    await expect(worker.run(async () => { throw new Error('Bad layout'); })).rejects.toThrow();
    expect(await worker.run(async () => 7)).toBe(7);
    await worker.close();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('should release idle processes and launch again on the next batch', async () => {
    vi.useFakeTimers();
    const browser = fakeBrowser();
    const launch = vi.fn(async () => browser);
    const worker = new NewspaperBrowser(launch, 20);
    try {
      await worker.run(async () => 1);
      await vi.advanceTimersByTimeAsync(25);
      expect(browser.close).toHaveBeenCalledTimes(1);
      await worker.run(async () => 2);
      expect(launch).toHaveBeenCalledTimes(2);
    } finally {
      await worker.close();
      vi.useRealTimers();
    }
  });

  it('should recover after an idle browser close fails', async () => {
    vi.useFakeTimers();
    const browser = fakeBrowser();
    vi.mocked(browser.close).mockRejectedValueOnce(new Error('Browser disconnected'));
    const worker = new NewspaperBrowser(async () => browser, 20);
    try {
      await worker.run(async () => 1);
      await vi.advanceTimersByTimeAsync(25);
      expect(await worker.run(async () => 2)).toBe(2);
    } finally {
      await worker.close();
      vi.useRealTimers();
    }
  });
});
