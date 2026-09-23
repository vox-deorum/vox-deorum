import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ConfigView from '@/views/ConfigView.vue';
import AgentModelMappings from '@/components/config/AgentModelMappings.vue';
import ModelDiscoveryDialog from '@/components/config/ModelDiscoveryDialog.vue';
import ModelDefinitions from '@/components/config/ModelDefinitions.vue';
import SetupWizard from '@/components/config/SetupWizard.vue';
import { api } from '@/api/client';
import type { AgentMapping, LLMConfig, VoxAgentsConfig } from '@/utils/types';

type ConfirmationRequest = { accept?: () => void };

const { confirmRequire, route } = vi.hoisted(() => ({
  confirmRequire: vi.fn(),
  route: { query: {} as Record<string, string> },
}));

vi.mock('vue-router', () => ({ useRoute: () => route }));

vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({ require: confirmRequire }),
}));

vi.mock('@/api/client', () => ({
  api: {
    getAgents: vi.fn(),
    getCurrentConfig: vi.fn(),
    updateCurrentConfig: vi.fn(),
  },
}));

describe('ConfigView model deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.query = {};
    vi.mocked(api.getAgents).mockResolvedValue({ agents: [] });
    vi.mocked(api.getCurrentConfig).mockResolvedValue({
      apiKeys: {},
      config: { llms: {} } as VoxAgentsConfig,
    });
  });

  it('opens the setup wizard from the Settings header button', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    const setupButton = wrapper.findAll('button-stub')
      .find(button => button.attributes('label') === 'Setup wizard');
    expect(setupButton).toBeDefined();

    await setupButton?.trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(SetupWizard).props('visible')).toBe(true);
  });

  it('opens the setup wizard when the route requests first-run setup', async () => {
    route.query = { setup: '1' };
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();

    expect(wrapper.findComponent(SetupWizard).props('visible')).toBe(true);
  });

  it('passes unsaved LLM form edits into the setup wizard', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    wrapper.findComponent(AgentModelMappings).vm.$emit('update:tierModel', 'default', 'openrouter/unsaved-chat');
    wrapper.findComponent(AgentModelMappings).vm.$emit('update:embedderModel', 'openai/unsaved-embedder');
    wrapper.findComponent(ModelDefinitions).vm.$emit('update:models', [
      { id: 'openrouter/unsaved-chat', provider: 'openrouter', name: 'unsaved-chat', options: {} },
      { id: 'openai/unsaved-embedder', provider: 'openai', name: 'unsaved-embedder', options: { embeddingSize: 1536 } },
    ] satisfies LLMConfig[]);
    await wrapper.vm.$nextTick();

    const setupButton = wrapper.findAll('button-stub')
      .find(button => button.attributes('label') === 'Setup wizard');
    await setupButton?.trigger('click');
    await wrapper.vm.$nextTick();

    const wizardConfig = wrapper.findComponent(SetupWizard).props('config') as VoxAgentsConfig;
    expect(wizardConfig.llms).toMatchObject({
      default: 'openrouter/unsaved-chat',
      embedder: 'openai/unsaved-embedder',
      'openrouter/unsaved-chat': { provider: 'openrouter', name: 'unsaved-chat' },
      'openai/unsaved-embedder': { provider: 'openai', name: 'unsaved-embedder' },
    });
  });

  it('rehydrates the editable LLM form after the setup wizard saves and preserves it on Save All', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    const wizardSavedConfig: VoxAgentsConfig = {
      agent: { name: 'vox-deorum' },
      webui: { port: 5555, enabled: true },
      mcpServer: { transport: { type: 'http', endpoint: 'http://localhost' } },
      logging: { level: 'info' },
      llms: {
        'openrouter/new-chat': { provider: 'openrouter', name: 'new-chat' },
        'openai/new-embedder': { provider: 'openai', name: 'new-embedder', options: { embeddingSize: 1536 } },
        default: 'openrouter/new-chat',
        embedder: 'openai/new-embedder',
      },
      configsDir: 'configs',
      episodeDbPath: 'episodes.duckdb',
      telemetryDir: 'telemetry',
    };

    wrapper.findComponent(SetupWizard).vm.$emit('update:config', wizardSavedConfig);
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual([]);
    expect(wrapper.findComponent(AgentModelMappings).props('tierModels')).toEqual({
      default: 'openrouter/new-chat',
      small: null,
      large: null,
    });
    expect(wrapper.findComponent(AgentModelMappings).props('embedderModel')).toBe('openai/new-embedder');
    expect(wrapper.findComponent(ModelDefinitions).props('models')).toEqual([
      { id: 'openrouter/new-chat', provider: 'openrouter', name: 'new-chat', options: {} },
      { id: 'openai/new-embedder', provider: 'openai', name: 'new-embedder', options: { embeddingSize: 1536 } },
    ]);

    const saveButton = wrapper.findAll('button-stub')
      .find(button => button.attributes('label') === 'Save All');
    await saveButton?.trigger('click');
    await flushPromises();

    expect(api.updateCurrentConfig).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        llms: expect.objectContaining({
          default: 'openrouter/new-chat',
          embedder: 'openai/new-embedder',
          'openrouter/new-chat': expect.objectContaining({ provider: 'openrouter', name: 'new-chat' }),
          'openai/new-embedder': expect.objectContaining({ provider: 'openai', name: 'new-embedder' }),
        }),
      }),
    }));
  });

  it('keeps synthesized tier and embedder targets selectable', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    wrapper.findComponent(AgentModelMappings).vm.$emit('update:tierModel', 'default', 'openrouter/new-chat-model');
    wrapper.findComponent(AgentModelMappings).vm.$emit('update:embedderModel', 'openai/new-embedder');
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual([]);

    expect(wrapper.findComponent(AgentModelMappings).props('availableModels')).toContainEqual({
      label: 'openrouter/new-chat-model',
      value: 'openrouter/new-chat-model',
    });
    expect(wrapper.findComponent(AgentModelMappings).props('embeddingModels')).toContainEqual({
      label: 'openai/new-embedder',
      value: 'openai/new-embedder',
    });
  });

  it('should open discovery for a mapping, add its model locally, and save it only on Save All', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    const discovered = {
      id: 'openrouter/discovered-chat',
      provider: 'openrouter',
      name: 'discovered-chat',
      recommendedOptions: { reasoningEffort: 'high' }
    };

    wrapper.findComponent(AgentModelMappings).vm.$emit('update:mappings', [
      { agent: 'Strategist', model: 'old-model' }
    ] satisfies AgentMapping[]);
    wrapper.findComponent(AgentModelMappings).vm.$emit('discover-model', 0);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ModelDiscoveryDialog).props('visible')).toBe(true);

    wrapper.findComponent(ModelDiscoveryDialog).vm.$emit('select', discovered);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ModelDefinitions).props('models')).toEqual([{
      id: 'openrouter/discovered-chat',
      provider: 'openrouter',
      name: 'discovered-chat',
      options: { reasoningEffort: 'high' }
    }]);
    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual([
      { agent: 'Strategist', model: 'openrouter/discovered-chat' }
    ]);
    expect(api.updateCurrentConfig).not.toHaveBeenCalled();

    const saveButton = wrapper.findAll('button-stub')
      .find(button => button.attributes('label') === 'Save All');
    await saveButton?.trigger('click');
    await flushPromises();
    expect(api.updateCurrentConfig).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        llms: expect.objectContaining({
          Strategist: 'openrouter/discovered-chat',
          'openrouter/discovered-chat': expect.objectContaining({
            provider: 'openrouter',
            name: 'discovered-chat',
            options: { reasoningEffort: 'high' }
          })
        })
      })
    }));
  });

  it('should retain an existing definition when discovery returns the same model id', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    const existing: LLMConfig = {
      id: 'openrouter/existing',
      provider: 'openrouter',
      name: 'curated-name',
      options: { reasoningEffort: 'low' }
    };
    wrapper.findComponent(ModelDefinitions).vm.$emit('update:models', [existing]);
    wrapper.findComponent(AgentModelMappings).vm.$emit('update:mappings', [
      { agent: 'Strategist', model: 'old-model' }
    ] satisfies AgentMapping[]);
    wrapper.findComponent(AgentModelMappings).vm.$emit('discover-model', 0);
    await wrapper.vm.$nextTick();
    wrapper.findComponent(ModelDiscoveryDialog).vm.$emit('select', {
      id: 'openrouter/existing',
      provider: 'openrouter',
      name: 'replacement-name',
      recommendedOptions: { reasoningEffort: 'high' }
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(ModelDefinitions).props('models')).toEqual([existing]);
    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual([
      { agent: 'Strategist', model: 'openrouter/existing' }
    ]);
  });

  it('should assign a discovered model to the embedder target', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    wrapper.findComponent(AgentModelMappings).vm.$emit('discover-embedder');
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ModelDiscoveryDialog).props('visible')).toBe(true);

    wrapper.findComponent(ModelDiscoveryDialog).vm.$emit('select', {
      id: 'openai/discovered-embedder',
      provider: 'openai',
      name: 'discovered-embedder',
      recommendedOptions: { embeddingSize: 1536 }
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(AgentModelMappings).props('embedderModel')).toBe('openai/discovered-embedder');
  });

  it('keeps tier aliases out of free-form mappings and in the saved llms', async () => {
    vi.mocked(api.getCurrentConfig).mockResolvedValue({
      apiKeys: {},
      config: {
        llms: {
          'openrouter/quick': { provider: 'openrouter', name: 'quick' },
          small: 'openrouter/quick',
        },
      } as Partial<VoxAgentsConfig> as VoxAgentsConfig,
    });
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();

    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual([]);
    expect(wrapper.findComponent(AgentModelMappings).props('tierModels')).toEqual({
      default: null, small: 'openrouter/quick', large: null,
    });

    wrapper.findComponent(AgentModelMappings).vm.$emit('update:mappings', [
      { agent: 'Strategist', model: 'openrouter/quick' },
    ] satisfies AgentMapping[]);
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual([
      { agent: 'Strategist', model: 'openrouter/quick' },
    ]);
    expect(wrapper.findComponent(AgentModelMappings).props('tierModels')).toEqual({
      default: null, small: 'openrouter/quick', large: null,
    });

    const saveButton = wrapper.findAll('button-stub')
      .find(button => button.attributes('label') === 'Save All');
    await saveButton?.trigger('click');
    await flushPromises();
    expect(api.updateCurrentConfig).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        llms: expect.objectContaining({
          small: 'openrouter/quick',
          Strategist: 'openrouter/quick',
        }),
      }),
    }));
  });

  it('assigns a discovered model to a tier and lets it be cleared again', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    wrapper.findComponent(AgentModelMappings).vm.$emit('discover-tier', 'large');
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ModelDiscoveryDialog).props('visible')).toBe(true);

    wrapper.findComponent(ModelDiscoveryDialog).vm.$emit('select', {
      id: 'openrouter/deep',
      provider: 'openrouter',
      name: 'deep-chat',
      recommendedOptions: { reasoningEffort: 'high' }
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(ModelDefinitions).props('models')).toEqual([{
      id: 'openrouter/deep',
      provider: 'openrouter',
      name: 'deep-chat',
      options: { reasoningEffort: 'high' }
    }]);
    expect(wrapper.findComponent(AgentModelMappings).props('tierModels')).toEqual({
      default: null, small: null, large: 'openrouter/deep',
    });

    wrapper.findComponent(AgentModelMappings).vm.$emit('update:tierModel', 'large', null);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(AgentModelMappings).props('tierModels')).toEqual({
      default: null, small: null, large: null,
    });
  });

  it('removes only the selected duplicate model row', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    const duplicateModels: LLMConfig[] = [
      { id: 'openrouter/shared', provider: 'openrouter', name: 'first', options: {} },
      { id: 'openrouter/shared', provider: 'openrouter', name: 'second', options: {} },
    ];
    const mappings: AgentMapping[] = [{ agent: 'Strategist', model: 'openrouter/shared' }];
    wrapper.findComponent(ModelDefinitions).vm.$emit('update:models', duplicateModels);
    wrapper.findComponent(AgentModelMappings).vm.$emit('update:mappings', mappings);
    await wrapper.vm.$nextTick();

    wrapper.findComponent(ModelDefinitions).vm.$emit('delete-model', 1);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ModelDefinitions).props('models')).toEqual([duplicateModels[0]]);
    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual(mappings);
    expect(confirmRequire).not.toHaveBeenCalled();
  });

  it('clears mappings only after the final definition of their model is deleted', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    const models: LLMConfig[] = [
      { id: 'openrouter/shared', provider: 'openrouter', name: 'first', options: {} },
      { id: 'openrouter/shared', provider: 'openrouter', name: 'second', options: {} },
    ];
    const mappings: AgentMapping[] = [{ agent: 'Strategist', model: 'openrouter/shared' }];
    wrapper.findComponent(ModelDefinitions).vm.$emit('update:models', models);
    wrapper.findComponent(AgentModelMappings).vm.$emit('update:mappings', mappings);
    await wrapper.vm.$nextTick();
    wrapper.findComponent(ModelDefinitions).vm.$emit('delete-model', 1);
    await wrapper.vm.$nextTick();
    wrapper.findComponent(ModelDefinitions).vm.$emit('delete-model', 0);
    await wrapper.vm.$nextTick();

    const request = confirmRequire.mock.calls[0]?.[0] as ConfirmationRequest;
    request.accept?.();
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ModelDefinitions).props('models')).toEqual([]);
    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual([]);
  });
});
