import { afterEach, describe, expect, it, vi } from 'vitest';
import { getReplayState, ReplayApiError } from '../../../../newspaper/src/app/api.js';

afterEach(() => vi.unstubAllGlobals());

describe('replay browser API', () => {
  it.each([200, 404, 500])('should report a non-JSON host response with HTTP status %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Host page</html>', {
      status, headers: { 'Content-Type': 'text/html' }
    })));
    const error = await getReplayState().catch(error => error);
    expect(error).toBeInstanceOf(ReplayApiError);
    expect(error.status).toBe(status);
    expect(error.message).toEqual(expect.any(String));
  });

  it('should preserve the JSON error envelope and status', async () => {
    const message = 'Recording unavailable';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: message }, { status: 409 })));
    const error = await getReplayState().catch(error => error);
    expect(error).toBeInstanceOf(ReplayApiError);
    expect(error).toMatchObject({ message, status: 409 });
  });
});
