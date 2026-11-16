/** Verify shared lazy initialization, request ownership, and draining lifecycle. */
import { describe, expect, it, vi } from 'vitest';
import { NewspaperApplication, type NewspaperRenderer } from '../../../src/newspaper/application.js';
import type { NewspaperDelivery, NewspaperExportService } from '../../../src/newspaper/export/service.js';
import { createNewspaperBundle, createNewspaperIssue } from '../../helpers/newspaper-fixtures.js';
import { deferred } from '../../helpers/deferred.js';
import type { PreparedNewspaper } from '../../../src/newspaper/game-delivery.js';
import { computeRenderProfileForView } from '../../../src/newspaper/renderer/layout.js';

const view = { width: 1140, height: 558, zoom: 1 };

/** Provide a renderer double that executes the request's delivery callback against known data. */
function fixture() {
  const sample = createNewspaperIssue();
  const cached = { key: 'a'.repeat(64), directory: 'cache/bundle', bundle: createNewspaperBundle() };
  const exportIssue = vi.fn(async (input: unknown, deliver?: NewspaperDelivery) => {
    if (deliver) await deliver(input as typeof sample, cached);
    return cached;
  });
  const close = vi.fn().mockResolvedValue(undefined);
  const renderer = { service: { exportIssue, close } as unknown as NewspaperExportService, cacheRoot: 'cache' };
  const createRenderer = vi.fn().mockResolvedValue(renderer);
  const game = {
    prepare: vi.fn().mockResolvedValue({ requestId: 'request', receiver: 3, view }),
    deliver: vi.fn().mockResolvedValue(undefined),
  };
  const app = new NewspaperApplication({ url: () => 'http://127.0.0.1:7865', createRenderer,
    readSample: async () => sample, game });
  return { app, sample, cached, renderer, createRenderer, exportIssue, close, game };
}

describe('newspaper application', () => {
  it('should initialize lazily once for concurrent requests and retry an initialization failure', async () => {
    const { app, sample, renderer, createRenderer } = fixture();
    expect(createRenderer).not.toHaveBeenCalled();
    createRenderer.mockRejectedValueOnce(new Error('Reader missing'));
    await expect(app.exportIssue(sample)).rejects.toThrow('Reader missing');
    const initialization = deferred<NewspaperRenderer>();
    createRenderer.mockReturnValueOnce(initialization.promise);
    const first = app.exportIssue(sample);
    const second = app.exportIssue(sample);
    await vi.waitFor(() => expect(createRenderer).toHaveBeenCalledTimes(2));
    initialization.resolve(renderer);
    await Promise.all([first, second]);
    expect(createRenderer).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('should prepare before exporting and deliver the sample for the prepared active seat', async () => {
    const { app, sample, cached, game, createRenderer, exportIssue } = fixture();
    const result = await app.showSample();
    expect(result).toEqual({ success: true, issueId: sample.issueId, key: cached.key });
    expect(game.prepare.mock.invocationCallOrder[0]).toBeLessThan(createRenderer.mock.invocationCallOrder[0]);
    expect(exportIssue).toHaveBeenCalledWith(expect.objectContaining({ receiver: expect.objectContaining({ playerId: 3 }) }), expect.any(Function), computeRenderProfileForView(view));
    expect(game.deliver).toHaveBeenCalledWith({ requestId: 'request', receiver: 3, view }, expect.objectContaining({
      issue: expect.objectContaining({ receiver: expect.objectContaining({ playerId: 3 }) }),
      bundle: cached.bundle, assets: expect.any(Object), state: expect.any(Object),
    }));
    expect(sample.receiver.playerId).toBe(0);
    await app.close();
  });

  it('should avoid initializing a renderer when preparation fails and propagate delivery rejection', async () => {
    const { app, game, createRenderer } = fixture();
    game.prepare.mockRejectedValueOnce(new Error('Mod unavailable'));
    await expect(app.showSample()).rejects.toThrow('Mod unavailable');
    expect(createRenderer).not.toHaveBeenCalled();
    game.deliver.mockRejectedValueOnce(new Error('Seat changed'));
    await expect(app.showSample()).rejects.toThrow('Seat changed');
    await app.close();
  });

  it('should keep generic exports free of game calls and delivery callbacks', async () => {
    const { app, sample, game, exportIssue } = fixture();
    await app.exportIssue(sample);
    expect(game.prepare).not.toHaveBeenCalled();
    expect(game.deliver).not.toHaveBeenCalled();
    expect(exportIssue).toHaveBeenCalledWith(sample, undefined);
    await app.close();
  });

  it('should drain requests already preparing before closing and reject later requests', async () => {
    const { app, game, close } = fixture();
    const preparation = deferred<PreparedNewspaper>();
    game.prepare.mockReturnValueOnce(preparation.promise);
    const show = app.showSample();
    await vi.waitFor(() => expect(game.prepare).toHaveBeenCalled());
    const shutdown = app.close();
    expect(app.close()).toBe(shutdown);
    await expect(app.showSample()).rejects.toThrow();
    expect(close).not.toHaveBeenCalled();
    preparation.resolve({ requestId: 'accepted', receiver: 2, view });
    await show;
    await shutdown;
    expect(game.deliver.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
    expect(close).toHaveBeenCalledOnce();
  });
});
