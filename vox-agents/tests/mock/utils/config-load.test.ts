/**
 * Mock-tier tests for the runtime config loader (src/utils/config.ts).
 * Only the config.json read is intercepted; every other fs call (dotenv,
 * version info) passes through to the real module. tests/setup.ts already
 * imported config.ts with the real fs, so the test re-imports it fresh.
 */

import { describe, it, expect, vi } from 'vitest';

const fileConfig = vi.hoisted(() => ({ json: '{}' }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const isConfigJson = (p: unknown) => typeof p === 'string' && p.endsWith('config.json');
  const mocked = {
    ...actual,
    existsSync: ((p: any) => isConfigJson(p) || actual.existsSync(p)) as typeof actual.existsSync,
    readFileSync: ((p: any, ...rest: any[]) =>
      isConfigJson(p) ? fileConfig.json : (actual.readFileSync as any)(p, ...rest)) as typeof actual.readFileSync,
  };
  return { ...mocked, default: mocked };
});

describe('loadConfig', () => {
  it('carries a saved useDX11 setting into the runtime config', async () => {
    vi.resetModules();
    const { config, refreshConfig } = await import('../../../src/utils/config.js');

    fileConfig.json = JSON.stringify({ useDX11: false });
    refreshConfig();
    expect(config.useDX11).toBe(false);

    fileConfig.json = '{}';
    refreshConfig();
    expect(config.useDX11).toBe(true);
  });

  it('carries a saved files setting into the runtime config', async () => {
    vi.resetModules();
    const { config, refreshConfig } = await import('../../../src/utils/config.js');

    fileConfig.json = JSON.stringify({ files: { game: 'write', shared: { lessons: 'read' } } });
    refreshConfig();
    expect(config.files).toEqual({ game: 'write', shared: { lessons: 'read' } });

    fileConfig.json = '{}';
    refreshConfig();
    expect(config.files).toBeUndefined();
  });

  it('carries a saved prompts setting into the runtime config', async () => {
    vi.resetModules();
    const { config, refreshConfig } = await import('../../../src/utils/config.js');

    fileConfig.json = JSON.stringify({ prompts: 'my-prompts' });
    refreshConfig();
    expect(config.prompts).toBe('my-prompts');

    fileConfig.json = '{}';
    refreshConfig();
    expect(config.prompts).toBe(false);
  });
});
