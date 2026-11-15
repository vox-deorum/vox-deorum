/** Verify that the standalone reader host protects its assets and export API. */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { startNewspaperHost } from '../../../../src/newspaper/export/http.js';
import { NewspaperBrowserUnavailableError } from '../../../../src/newspaper/export/browser.js';

describe('newspaper loopback host', () => {
  it('should protect injected routes outside the newspaper prefixes before handling requests', async () => {
    const handle = vi.fn((_req, res) => res.json({ turn: 12 }));
    const host = await startNewspaperHost({
      /** Exercise an application route with its own URL namespace. */
      mountApplicationRoutes(app) {
        app.post('/api/replay', handle);
      },
    });
    try {
      await request(host.app).post('/api/replay').set('Host', 'attacker.test').expect(403);
      await request(host.app).post('/api/replay').set('Origin', 'https://attacker.test').expect(403);
      await request(host.app).options('/api/replay').set('Host', 'attacker.test')
        .set('Origin', 'http://localhost').set('Access-Control-Request-Method', 'POST').expect(403);
      expect(handle).not.toHaveBeenCalled();
      await request(host.app).post('/api/replay').expect(200, { turn: 12 });
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      await host.close();
    }
  });
  it('should serve injected application routes before the reader and API fallbacks', async () => {
    const host = await startNewspaperHost({
      /** Supply mode-specific routes without coupling the host to that mode. */
      mountApplicationRoutes(app) {
        app.get('/api/newspaper/replay', (_req, res) => res.json({ turn: 12 }));
        app.get('/newspaper/session', (_req, res) => res.send('session'));
      },
    });
    try {
      await request(host.app).get('/api/newspaper/replay').expect(200, { turn: 12 });
      await request(host.app).get('/newspaper/session').expect(200, 'session');
      await request(host.app).get('/api/newspaper/replay').set('Host', 'attacker.test').expect(403);
      await request(host.app).get('/api/newspaper/missing').expect(404);
    } finally {
      await host.close();
    }
  });
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
