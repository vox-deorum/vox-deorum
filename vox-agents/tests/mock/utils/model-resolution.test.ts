/** Tests for discovery-verified runtime model resolution. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockDiscoveryError extends Error {}
  return {
    DiscoveryError: MockDiscoveryError,
    config: { llms: { default: { provider: 'openai', name: 'default' } } as Record<string, any> },
    discoverModels: vi.fn(),
    allowsUnlistedModelReferences: vi.fn(() => false),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('../../../src/utils/config.js', () => ({ config: mocks.config }));
vi.mock('../../../src/utils/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../../src/utils/models/discovery.js', () => ({
  DiscoveryError: mocks.DiscoveryError,
  discoverModels: mocks.discoverModels,
  allowsUnlistedModelReferences: mocks.allowsUnlistedModelReferences,
}));

import { ensureModelsResolved, getRuntimeModel, resetRuntimeModels, selectEvaluatorReference, selectModelReference, triageEnabled } from '../../../src/utils/models/resolution.js';
import { getModelConfig } from '../../../src/utils/models/models.js';

describe('ensureModelsResolved', () => {
  beforeEach(() => {
    resetRuntimeModels();
    vi.clearAllMocks();
    mocks.config.llms = { default: { provider: 'openai', name: 'default' } };
    mocks.allowsUnlistedModelReferences.mockReturnValue(false);
  });

  it('should register catalog hits and cache discovery by provider', async () => {
    mocks.discoverModels.mockResolvedValue([
      { id: 'openai/gpt-real', name: 'gpt-real', recommendedOptions: { reasoningEffort: 'high' } },
      { id: 'openai/gpt-other', name: 'gpt-other' },
    ]);

    await ensureModelsResolved(['openai/gpt-real', 'openai/gpt-other']);

    expect(mocks.discoverModels).toHaveBeenCalledTimes(1);
    expect(getRuntimeModel('openai/gpt-real')).toEqual({
      provider: 'openai', name: 'gpt-real', options: { reasoningEffort: 'high' },
    });
    expect(getModelConfig('openai/gpt-real')).toEqual({
      provider: 'openai', name: 'gpt-real', options: { reasoningEffort: 'high' },
    });
    expect(getRuntimeModel('openai/gpt-other')).toEqual({ provider: 'openai', name: 'gpt-other' });
  });

  it('should retain canonical catalog names for unique case-insensitive matches', async () => {
    mocks.discoverModels.mockResolvedValue([{ id: 'codex/gpt-5.6-sol', name: 'gpt-5.6-sol' }]);

    await ensureModelsResolved(['codex/GPT-5.6-Sol@high']);

    expect(getRuntimeModel('codex/GPT-5.6-Sol')).toEqual({ provider: 'codex', name: 'gpt-5.6-sol' });
    expect(getModelConfig('codex/GPT-5.6-Sol@high', 'default')).toEqual({
      provider: 'codex', name: 'gpt-5.6-sol', options: { reasoningEffort: 'high' },
    });
  });

  it('should reject a live catalog miss with a suggestion', async () => {
    mocks.discoverModels.mockResolvedValue([{ id: 'anthropic/claude-sonnet-5', name: 'claude-sonnet-5' }]);

    await expect(ensureModelsResolved(['anthropic/claude-sonet-5'])).rejects.toThrow(
      "Model 'anthropic/claude-sonet-5' is not in the anthropic provider's model list. Did you mean: anthropic/claude-sonnet-5?",
    );
  });

  it('should warn, skip registration, and retry discovery after a discovery failure', async () => {
    mocks.discoverModels
      .mockRejectedValueOnce(new mocks.DiscoveryError('offline'))
      .mockResolvedValueOnce([{ id: 'openai/gpt-real', name: 'gpt-real' }]);

    await expect(ensureModelsResolved(['openai/gpt-real'])).resolves.toBeUndefined();
    await ensureModelsResolved(['openai/gpt-real']);

    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    expect(mocks.discoverModels).toHaveBeenCalledTimes(2);
    expect(getRuntimeModel('openai/gpt-real')).toEqual({ provider: 'openai', name: 'gpt-real' });
  });

  it('should warn rather than throw for static catalog misses', async () => {
    mocks.allowsUnlistedModelReferences.mockReturnValue(true);
    mocks.discoverModels.mockResolvedValue([]);

    await expect(ensureModelsResolved(['claude-code/custom'])).resolves.toBeUndefined();

    expect(getRuntimeModel('claude-code/custom')).toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('should prefer the first case-insensitive hit when a catalog repeats a name', async () => {
    mocks.discoverModels.mockResolvedValue([
      { id: 'openai/GPT-Real', name: 'GPT-Real' },
      { id: 'openai/gpt-real', name: 'gpt-real' },
    ]);

    await ensureModelsResolved(['openai/gpt-Real']);

    expect(getRuntimeModel('openai/gpt-Real')).toEqual({ provider: 'openai', name: 'GPT-Real' });
  });

  it('should skip inline models, registered IDs, and normal aliases', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      registered: { provider: 'openai', name: 'registered' },
      alias: 'registered',
    };

    await ensureModelsResolved([
      { provider: 'openai', name: 'inline' },
      'registered',
      'alias',
      'overrideAlias',
    ], { overrideAlias: 'registered' });

    expect(mocks.discoverModels).not.toHaveBeenCalled();
  });

  it('should reject model alias cycles before discovery', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      first: 'second',
      second: 'first',
    };

    await expect(ensureModelsResolved(['first'])).rejects.toThrow(
      "Cannot resolve model alias 'first': alias cycle detected (first -> second -> first).",
    );
    mocks.config.llms = { default: { provider: 'openai', name: 'default' } };
    await expect(ensureModelsResolved(['overrideFirst'], {
      overrideFirst: 'overrideSecond',
      overrideSecond: 'overrideFirst',
    })).rejects.toThrow(
      "Cannot resolve model alias 'overrideFirst': alias cycle detected (overrideFirst -> overrideSecond -> overrideFirst).",
    );
    expect(mocks.discoverModels).not.toHaveBeenCalled();
  });

  it('should reject an unused global agent alias cycle during preflight', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      'simple-briefer': 'routine',
      routine: 'simple-briefer',
    };

    await expect(ensureModelsResolved([])).rejects.toThrow(
      "Cannot resolve model alias 'simple-briefer': alias cycle detected (simple-briefer -> routine -> simple-briefer).",
    );
    expect(mocks.discoverModels).not.toHaveBeenCalled();
  });

  it('should not discover an unused normal alias target', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      'unused-agent': 'openai/not-requested',
    };

    await expect(ensureModelsResolved([])).resolves.toBeUndefined();
    expect(mocks.discoverModels).not.toHaveBeenCalled();
    expect(getRuntimeModel('openai/not-requested')).toBeUndefined();
  });

  it('should reject a bare name that is not a registered alias', async () => {
    await expect(ensureModelsResolved(['gpt-5.6-terra'])).rejects.toThrow(
      "Cannot resolve model 'gpt-5.6-terra': it is not a registered llms alias and names no provider.",
    );
    expect(mocks.discoverModels).not.toHaveBeenCalled();
  });

  it('should reject a qualified reference naming an unsupported provider', async () => {
    await expect(ensureModelsResolved(['opeani/gpt-5.6-terra'])).rejects.toThrow(
      "Cannot resolve model 'opeani/gpt-5.6-terra': 'opeani' is not a supported provider.",
    );
    expect(mocks.discoverModels).not.toHaveBeenCalled();
  });

  it('should resolve an agent name to its assignment, or to default when unassigned', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      'assigned-agent': 'openai/gpt-real',
    };

    expect(selectModelReference('assigned-agent')).toBe('assigned-agent');
    expect(selectModelReference('talkative-telepathist')).toBe('default');
    expect(selectModelReference('overridden-agent', 'default', { 'overridden-agent': 'openai/gpt-real' }))
      .toBe('overridden-agent');
  });

  it('should order tier lookups tier-first: agent.tier, tier, agent, default across both scopes', () => {
    const agent = 'tier-agent';
    for (const tier of ['small', 'large'] as const) {
      mocks.config.llms = {
        default: { provider: 'openai', name: 'global-default' },
        [tier]: { provider: 'openai', name: 'global-tier' },
        [`${agent}.${tier}`]: { provider: 'openai', name: 'global-agent-tier' },
        [agent]: { provider: 'openai', name: 'global-agent' },
      };
      const overrides: Record<string, any> = {
        default: { provider: 'openai', name: 'seat-default' },
        [tier]: { provider: 'openai', name: 'seat-tier' },
        [`${agent}.${tier}`]: { provider: 'openai', name: 'seat-agent-tier' },
        [agent]: { provider: 'openai', name: 'seat-agent' },
      };
      const resolvedName = (): string => getModelConfig(
        selectModelReference(agent, tier, overrides),
        undefined,
        overrides,
      ).name;

      expect(selectModelReference(agent, tier, overrides)).toBe(`${agent}.${tier}`);
      expect(resolvedName()).toBe('seat-agent-tier');
      delete overrides[`${agent}.${tier}`];
      expect(resolvedName()).toBe('global-agent-tier');
      delete mocks.config.llms[`${agent}.${tier}`];
      expect(selectModelReference(agent, tier, overrides)).toBe(tier);
      expect(resolvedName()).toBe('seat-tier');
      delete overrides[tier];
      expect(resolvedName()).toBe('global-tier');
      delete mocks.config.llms[tier];
      expect(selectModelReference(agent, tier, overrides)).toBe(agent);
      expect(resolvedName()).toBe('seat-agent');
      delete overrides[agent];
      expect(resolvedName()).toBe('global-agent');
      delete mocks.config.llms[agent];
      expect(selectModelReference(agent, tier, overrides)).toBe('default');
      expect(resolvedName()).toBe('seat-default');
    }
  });

  it('should keep the agent-first order for the default tier at either scope', () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'global-default' },
      small: { provider: 'openai', name: 'global-small' },
      'small-agent': { provider: 'openai', name: 'global-agent' },
    };
    const overrides: Record<string, { provider: string; name: string }> = {
      default: { provider: 'openai', name: 'seat-default' },
      small: { provider: 'openai', name: 'seat-small' },
      'small-agent': { provider: 'openai', name: 'seat-agent' },
    };

    const resolvedName = (name: string, size: 'default' | 'small'): string => getModelConfig(
      selectModelReference(name, size, overrides),
      undefined,
      overrides,
    ).name;

    // Default tier: the explicit agent assignment wins over the seat default alias.
    expect(selectModelReference('small-agent', 'default', overrides)).toBe('small-agent');
    expect(resolvedName('small-agent', 'default')).toBe('seat-agent');
    // A non-default tier still lets the tier win over the agent assignment.
    expect(selectModelReference('small-agent', 'small', overrides)).toBe('small');
    expect(resolvedName('small-agent', 'small')).toBe('seat-small');
    expect(resolvedName('default-agent', 'default')).toBe('seat-default');
  });

  it('should preserve global agent assignments for the default tier under the tier-first rule', () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'global-default' },
      'default-agent': { provider: 'openai', name: 'global-default-agent' },
      'small-agent': { provider: 'openai', name: 'global-small-agent' },
    };
    const overrides = {
      default: { provider: 'openai', name: 'seat-default' },
      small: { provider: 'openai', name: 'seat-small' },
    };

    expect(selectModelReference('default-agent', 'default', overrides)).toBe('default-agent');
    expect(getModelConfig(selectModelReference('default-agent', 'default', overrides), undefined, overrides).name)
      .toBe('global-default-agent');
    // The seat tier alias now wins over the agent's own global assignment...
    expect(selectModelReference('small-agent', 'small', overrides)).toBe('small');
    expect(getModelConfig('small', undefined, overrides).name).toBe('seat-small');
    // ...but without any tier alias configured, the global agent assignment still applies.
    expect(selectModelReference('small-agent', 'small', {})).toBe('small-agent');
    expect(getModelConfig(selectModelReference('small-agent', 'small', {})).name).toBe('global-small-agent');
  });

  it('should fall back from an unconfigured small alias to the existing default chain', () => {
    mocks.config.llms = { default: { provider: 'openai', name: 'global-default' } };
    const overrides = { default: { provider: 'openai', name: 'seat-default' } };

    expect(selectModelReference('small-agent', 'small', overrides)).toBe('default');
    expect(getModelConfig(selectModelReference('small-agent', 'small', overrides), undefined, overrides).name)
      .toBe('seat-default');
    expect(selectModelReference('small-agent', 'small')).toBe('default');
    expect(getModelConfig(selectModelReference('small-agent', 'small')).name).toBe('global-default');
  });

  it('should verify both global and seat small aliases before a session starts', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      small: 'openai/global-small',
    };
    mocks.discoverModels.mockResolvedValue([
      { id: 'openai/global-small', name: 'global-small' },
      { id: 'openai/seat-small', name: 'seat-small' },
    ]);

    await ensureModelsResolved([], { small: 'openai/seat-small' });

    expect(getRuntimeModel('openai/global-small')).toEqual({ provider: 'openai', name: 'global-small' });
    expect(getRuntimeModel('openai/seat-small')).toEqual({ provider: 'openai', name: 'seat-small' });
  });

  it('should verify both global and seat large aliases before a session starts', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      large: 'openai/global-large',
    };
    mocks.discoverModels.mockResolvedValue([
      { id: 'openai/global-large', name: 'global-large' },
      { id: 'openai/seat-large', name: 'seat-large' },
    ]);

    await ensureModelsResolved([], { large: 'openai/seat-large' });

    expect(getRuntimeModel('openai/global-large')).toEqual({ provider: 'openai', name: 'global-large' });
    expect(getRuntimeModel('openai/seat-large')).toEqual({ provider: 'openai', name: 'seat-large' });
  });

  it('should register a typesafe evaluation reference resolved through the mocked catalog', async () => {
    mocks.discoverModels.mockResolvedValue([{ id: 'typesafe/jev-latest', name: 'jev-latest' }]);

    await ensureModelsResolved(['typesafe/jev-latest']);

    expect(mocks.discoverModels).toHaveBeenCalledWith('typesafe', {});
    expect(getRuntimeModel('typesafe/jev-latest')).toEqual({ provider: 'typesafe', name: 'jev-latest' });
    expect(getModelConfig('typesafe/jev-latest')).toEqual({ provider: 'typesafe', name: 'jev-latest' });
  });

  describe('selectEvaluatorReference', () => {
    it('should prefer the agent evaluator then the shared alias at both scopes', () => {
      mocks.config.llms = {
        default: { provider: 'openai', name: 'default' },
        evaluator: 'typesafe/jev-latest',
        'eval-agent.evaluator': 'openai-compatible/gpt-oss-120b',
      };

      expect(selectEvaluatorReference('eval-agent', { 'eval-agent.evaluator': 'openai/x' })).toBe('eval-agent.evaluator');
      expect(selectEvaluatorReference('eval-agent', {})).toBe('eval-agent.evaluator');
      expect(selectEvaluatorReference('other-agent', { evaluator: 'openai/x' })).toBe('evaluator');
      expect(selectEvaluatorReference('other-agent')).toBe('evaluator');
    });

    it('should return undefined rather than falling back to the default model', () => {
      expect(selectEvaluatorReference('plain-agent')).toBeUndefined();
      expect(selectEvaluatorReference('plain-agent', { plain: 'openai/x' })).toBeUndefined();
    });
  });

  describe('triageEnabled', () => {
    it('should enable triage only for object assignments carrying options.triage', () => {
      const triaged = { provider: 'openai', name: 'x', options: { triage: true } };
      expect(triageEnabled('seat-agent', { 'seat-agent': triaged })).toBe(true);
      expect(triageEnabled('off-agent', { 'off-agent': { ...triaged, options: { triage: false } } })).toBe(false);
      // A string alias assignment never opts in, even when the global target carries the option.
      expect(triageEnabled('alias-agent', { 'alias-agent': 'openai/x' })).toBe(false);

      mocks.config.llms = {
        default: { provider: 'openai', name: 'default' },
        'global-triaged': triaged,
        'global-plain': { provider: 'openai', name: 'y' },
        'global-alias': 'openai/z',
      };
      expect(triageEnabled('global-triaged')).toBe(true);
      expect(triageEnabled('global-plain')).toBe(false);
      expect(triageEnabled('global-alias')).toBe(false);
      expect(triageEnabled('unassigned')).toBe(false);
    });
  });

  it('should reject a dangling small alias during preflight', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      small: 'openai/missing-small',
    };
    mocks.discoverModels.mockResolvedValue([{ id: 'openai/available-small', name: 'available-small' }]);

    await expect(ensureModelsResolved([])).rejects.toThrow(
      "Model 'openai/missing-small' is not in the openai provider's model list.",
    );
  });

  it('should preserve an exact explicit key before interpreting its suffix', () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      'openai/native@high': { provider: 'openai', name: 'literal-native-name' },
    };

    expect(getModelConfig('openai/native@high')).toEqual({ provider: 'openai', name: 'literal-native-name' });
  });
});
