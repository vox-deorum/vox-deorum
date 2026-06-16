/**
 * Tests for the API error handler wrapper.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleAPIError } from '../../../src/utils/api.js';
import { ErrorCode, respondSuccess } from '../../../src/types/api.js';

/** Build a mock Express response with chainable status().json() */
function makeMockResponse(): any {
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res;
}

describe('handleAPIError', () => {
  it('should send the action result with status 200 on success', async () => {
    const res = makeMockResponse();
    await handleAPIError(res, '/health', async () => respondSuccess({ ok: true }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, result: { ok: true } });
  });

  it('should send a 500 INTERNAL_ERROR response when the action throws an Error', async () => {
    const res = makeMockResponse();
    await handleAPIError(res, '/lua/call', async () => {
      throw new Error('boom');
    });
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(body.error.message).toContain('/lua/call');
    expect(body.error.details).toBe('boom');
  });

  it('should stringify non-Error throws into the details field', async () => {
    const res = makeMockResponse();
    await handleAPIError(res, '/external/register', async () => {
      throw 'plain string failure';
    });
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.error.details).toBe('plain string failure');
  });

  it('should pass through arbitrary (non-APIResponse) action results', async () => {
    const res = makeMockResponse();
    await handleAPIError(res, '/stats', async () => ({ uptime: 42 }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ uptime: 42 });
  });
});
