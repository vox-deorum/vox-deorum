import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createNewspaperPreview } from '../../../../src/newspaper/cli/preview.js';

describe('newspaper preview host', () => {
  let host: Awaited<ReturnType<typeof createNewspaperPreview>> | undefined;

  afterEach(async () => {
    await host?.close();
  });

  it('should serve the reader alias and assets alongside the guarded replay API', async () => {
    host = await createNewspaperPreview({ port: 0 });
    expect(new URL(host.url).port).not.toBe('5600');
    const preview = request(host.url);
    const reader = await preview.get('/index.html').expect(200);
    const alias = await preview.get('/preview.html?fixture=ordinary').expect(200);
    expect(alias.text).toBe(reader.text);
    await preview.get('/assets/fonts.css').expect(200);

    const state = await preview.get('/api/newspaper/replay').expect('Content-Type', /json/).expect(409);
    expect(state.body.error).toEqual(expect.any(String));
    await preview.get('/api/newspaper/replay/unsupported').expect('Content-Type', /json/).expect(404);
    await preview.put('/api/newspaper/replay').set('Host', 'unrelated.test').send({}).expect(403);
    await preview.put('/api/newspaper/replay').set('Origin', 'https://unrelated.test').send({}).expect(403);
  });
});
