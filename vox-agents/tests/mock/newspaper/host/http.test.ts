/** Verify that the standalone reader host protects its assets and export API. */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { startNewspaperHost } from '../../../../src/newspaper/host/http.js';
import { NewspaperBrowserUnavailableError } from '../../../../src/newspaper/export/browser.js';

describe('newspaper loopback host', () => {
  it('should distinguish browser unavailability from invalid export input', async () => {
    const exportIssue = vi.fn()
      .mockRejectedValueOnce(new NewspaperBrowserUnavailableError('Browser unavailable'))
      .mockRejectedValueOnce(new Error('Invalid issue'));
    const host = await startNewspaperHost({ exportIssue });
    try {
      await request(host.app).post('/api/newspaper/export').send({}).expect(503);
      await request(host.app).post('/api/newspaper/export').send({}).expect(400);
    } finally {
      await host.close();
    }
  });
  it('should reject external host and origin requests before export', async () => {
    const exportIssue = vi.fn(async body => body);
    const host = await startNewspaperHost({ exportIssue });
    try {
      await request(host.app).post('/api/newspaper/export').set('Host', 'attacker.test').send({}).expect(403);
      await request(host.app).get('/newspaper/').set('Host', 'attacker.test').expect(403);
      await request(host.app).post('/api/newspaper/export').set('Origin', 'https://attacker.test').send({}).expect(403);
      expect(exportIssue).not.toHaveBeenCalled();
      await request(host.app).post('/api/newspaper/export').send({ value: 1 }).expect(200, { value: 1 });
      expect(exportIssue).toHaveBeenCalledTimes(1);
    } finally {
      await host.close();
    }
  });
});
