import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { config } from '../../../../src/agents/config/load.js';
import type { DeskCatalogueResponse, DeskVariantDetail } from '../../../../src/types/api.js';
import { clearCandidates, stopJob, waitForJob, type DeskWriter } from '../../../../src/newspaper/desk/generate.js';
import { mountDeskRoutes } from '../../../../src/newspaper/desk/http.js';
import { startNewspaperHost } from '../../../../src/newspaper/export/http.js';

describe('Writing Desk HTTP routes', () => {
  let host: Awaited<ReturnType<typeof startNewspaperHost>>;
  const model = 'desk-route-test';
  let gate: Promise<void> | undefined;
  let openGate: (() => void) | undefined;
  /** Answer model requests locally through the actual desk routes, optionally after a test releases them. */
  const writer: DeskWriter = async ({ refs }) => {
    if (gate) await gate;
    return {
      variants: refs.map(ref => ({ ...ref, choices: [{ headline: 'Test draft', body: ['Test paragraph'] }] })),
    };
  };
  beforeEach(async () => {
    gate = undefined;
    openGate = undefined;
    config.llms[model] = { provider: 'openai', name: model };
    host = await startNewspaperHost({ mountApplicationRoutes: app => mountDeskRoutes(app, writer) });
  });
  afterEach(async () => {
    stopJob();
    gate = undefined;
    openGate?.();
    await waitForJob();
    delete config.llms[model];
    await host.close();
  });

  it('should serve the stock catalogue and detail through the newspaper mount', async () => {
    const result = await request(host.app).get('/api/newspaper/desk').expect(200);
    const catalogue: DeskCatalogueResponse = result.body;
    expect(catalogue.available).toBe(true);
    const template = catalogue.templates.find(item => item.id === 'friend-enters-new-era-account')!;
    const variant = template.variants.find(item => item.style.voice === 'gazette')!;
    const path = '/api/newspaper/desk/templates/' + template.id + '/variants/' + variant.id;
    const detail: DeskVariantDetail = (await request(host.app).get(path).expect(200)).body;
    expect(detail.text.headline).toBe(variant.headline);
    expect(detail.variables).toContainEqual(expect.objectContaining({ name: 'civilization', keep: true }));
    expect(detail.triggers.map(trigger => trigger.id)).toContain('friend-enters-new-era');
    await request(host.app).get(path + '-unknown').expect(404);
  });

  it('should dispatch a POST before the fallback and reject malformed requests as JSON', async () => {
    const result = await request(host.app).post('/api/newspaper/desk/jobs/current/stop').expect(200);
    expect(result.body).toBeNull();
    await request(host.app).post('/api/newspaper/desk/jobs').set('Content-Type', 'application/json').send('{').expect(400);
    await request(host.app).post('/api/newspaper/desk/jobs').send({ models: [], refs: [], choices: 0 }).expect(400);
  });

  it('should report an empty body after trimming all paragraphs', async () => {
    const path = '/api/newspaper/desk/templates/friend-enters-new-era-account/variants/friend-enters-new-era-gazette';
    const { revision } = (await request(host.app).get(path).expect(200)).body as DeskVariantDetail;
    await request(host.app).post(path + '/settle')
      .send({ revision, headline: 'The news', body: ['', ' '] }).expect(400);
  });

  it('should generate and serve a candidate from the configured writer alias', async () => {
    const ref = { templateId: 'friend-enters-new-era-account', variantId: 'friend-enters-new-era-gazette' };
    try {
      await request(host.app).post('/api/newspaper/desk/jobs').send({ refs: [ref], models: [model], choices: 1 }).expect(200);
      await waitForJob();
      const job = await request(host.app).get('/api/newspaper/desk/jobs/current').expect(200);
      expect(job.body).toMatchObject({ total: 1, done: 1, failed: 0 });
      const path = '/api/newspaper/desk/templates/' + ref.templateId + '/variants/' + ref.variantId;
      const detail = await request(host.app).get(path).expect(200);
      expect(detail.body.candidates).toEqual([expect.objectContaining({ model, headline: 'Test draft' })]);
    } finally {
      clearCandidates(ref);
    }
  });

  it('should clear every variant after a stopped job and keep the job history', async () => {
    const catalogue = (await request(host.app).get('/api/newspaper/desk').expect(200)).body as DeskCatalogueResponse;
    const refs = catalogue.templates
      .flatMap(template => template.variants
        .filter(variant => !variant.settled)
        .map(variant => ({ templateId: template.id, variantId: variant.id })))
      .slice(0, 2);
    expect(refs).toHaveLength(2);
    try {
      await request(host.app).delete('/api/newspaper/desk/candidates').expect(200);
      await request(host.app).post('/api/newspaper/desk/jobs')
        .send({ refs, models: [model], choices: 1 }).expect(200);
      await waitForJob();

      gate = new Promise<void>(resolve => { openGate = resolve; });
      const running = (await request(host.app).post('/api/newspaper/desk/jobs')
        .send({ refs, models: [model], choices: 1 }).expect(200)).body;
      expect(running.status).toBe('running');
      await request(host.app).delete('/api/newspaper/desk/candidates').expect(409);
      await request(host.app).post('/api/newspaper/desk/jobs/current/stop').expect(200);
      openGate?.();
      await waitForJob();
      gate = undefined;

      const result = await request(host.app).delete('/api/newspaper/desk/candidates').expect(200);
      expect(result.body).toEqual({ cleared: refs.length });
      for (const ref of refs) {
        const path = '/api/newspaper/desk/templates/' + ref.templateId + '/variants/' + ref.variantId;
        const detail = (await request(host.app).get(path).expect(200)).body as DeskVariantDetail;
        expect(detail.candidates).toEqual([]);
      }
      const current = await request(host.app).get('/api/newspaper/desk/jobs/current').expect(200);
      expect(current.body).toMatchObject({ id: running.id, status: 'stopped' });
    } finally {
      for (const ref of refs) clearCandidates(ref);
    }
  });
});
