/**
 * Tests for config diff computation and merge-with-defaults reconstruction.
 */
import { describe, it, expect } from 'vitest';
import { computeConfigDiff, mergeConfigWithDefaults } from '../../src/utils/config/diff.js';
import type { VoxAgentsConfig, LLMConfig } from '../../src/types/index.js';

/** Build a fresh defaults config (deep) so tests can mutate copies freely */
function makeDefaults(): VoxAgentsConfig {
  return {
    agent: { name: 'vox' },
    webui: { port: 3000, enabled: true },
    mcpServer: { transport: { type: 'http', endpoint: 'http://localhost:4000/mcp' } },
    logging: { level: 'info' },
    llms: {
      default: 'openrouter/some-model',
      fancy: { provider: 'openai', name: 'gpt-4' },
    },
    configsDir: 'configs',
    episodeDbPath: 'episodes.duckdb',
    telemetryDir: '',
  };
}

/** Deep-clone a config via JSON round-trip */
function cloneConfig(config: VoxAgentsConfig): VoxAgentsConfig {
  return JSON.parse(JSON.stringify(config));
}

describe('computeConfigDiff', () => {
  it('should return an empty diff for an unchanged config', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    expect(computeConfigDiff(full, defaults)).toEqual({});
  });

  it('should include only the top-level fields that differ', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    full.webui.port = 8080;
    const diff = computeConfigDiff(full, defaults);
    expect(diff).toEqual({ webui: { port: 8080, enabled: true } });
  });

  it('should ignore versionInfo (runtime-only field)', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    full.versionInfo = { version: '1.0.0', major: 1, minor: 0, revision: 0 };
    expect(computeConfigDiff(full, defaults)).toEqual({});
  });

  it('should include user-added llm entries', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    full.llms.custom = { provider: 'google', name: 'gemini' };
    const diff = computeConfigDiff(full, defaults);
    expect(diff.llms).toEqual({ custom: { provider: 'google', name: 'gemini' } });
  });

  it('should include modified llm entries', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    full.llms.default = 'openrouter/another-model';
    const diff = computeConfigDiff(full, defaults);
    expect(diff.llms).toEqual({ default: 'openrouter/another-model' });
  });

  it('should mark deleted default entries with null', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    delete full.llms.fancy;
    const diff = computeConfigDiff(full, defaults);
    expect(diff.llms).toEqual({ fancy: null });
  });

  it('should strip UI-added id fields when comparing llm entries', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    // The UI decorates object entries with an id; that alone is not a change
    full.llms.fancy = { id: 'fancy', provider: 'openai', name: 'gpt-4' } as LLMConfig;
    expect(computeConfigDiff(full, defaults)).toEqual({});
  });

  it('should strip the id from modified entries written to the diff', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    full.llms.fancy = { id: 'fancy', provider: 'openai', name: 'gpt-5' } as LLMConfig;
    const diff = computeConfigDiff(full, defaults);
    expect(diff.llms).toEqual({ fancy: { provider: 'openai', name: 'gpt-5' } });
  });
});

describe('mergeConfigWithDefaults', () => {
  it('should return defaults for an empty diff', () => {
    const defaults = makeDefaults();
    const merged = mergeConfigWithDefaults({}, defaults);
    expect(merged).toEqual(defaults);
    // llms must be cloned, not shared, so later merges can't mutate defaults
    expect(merged.llms).not.toBe(defaults.llms);
  });

  it('should override top-level fields from the file', () => {
    const defaults = makeDefaults();
    const merged = mergeConfigWithDefaults({ logging: { level: 'debug' } }, defaults);
    expect(merged.logging).toEqual({ level: 'debug' });
    expect(merged.webui).toEqual(defaults.webui);
  });

  it('should merge llm entries and apply null sentinels as deletions', () => {
    const defaults = makeDefaults();
    const merged = mergeConfigWithDefaults(
      { llms: { fancy: null, custom: { provider: 'google', name: 'gemini' } } },
      defaults
    );
    expect(merged.llms.fancy).toBeUndefined();
    expect(merged.llms.custom).toEqual({ provider: 'google', name: 'gemini' });
    expect(merged.llms.default).toBe('openrouter/some-model');
  });

  it('should round-trip: merge(diff(full)) reconstructs the full config', () => {
    const defaults = makeDefaults();
    const full = cloneConfig(defaults);
    full.webui.port = 9999;
    full.logging.level = 'debug';
    full.llms.default = 'openrouter/other';
    delete full.llms.fancy;
    full.llms.extra = { provider: 'openai', name: 'o3' };

    const diff = computeConfigDiff(full, defaults);
    const merged = mergeConfigWithDefaults(diff, defaults);
    expect(merged).toEqual(full);
  });
});
