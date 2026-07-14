import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ConfigView from '@/views/ConfigView.vue';
import AgentModelMappings from '@/components/config/AgentModelMappings.vue';
import ModelDefinitions from '@/components/config/ModelDefinitions.vue';
import { api } from '@/api/client';
import type { AgentMapping, LLMConfig } from '@/utils/types';

type ConfirmationRequest = { accept?: () => void };

const { confirmRequire } = vi.hoisted(() => ({ confirmRequire: vi.fn() }));

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
    vi.mocked(api.getAgents).mockResolvedValue({ agents: [] });
    vi.mocked(api.getCurrentConfig).mockResolvedValue({
      apiKeys: {},
      config: { llms: {} },
    });
  });

  it('removes only the selected blank or duplicate model row', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    const duplicateModels: LLMConfig[] = [
      { id: 'openrouter/shared', provider: 'openrouter', name: 'first', options: {} },
      { id: 'openrouter/shared', provider: 'openrouter', name: 'second', options: {} },
    ];
    const mappings: AgentMapping[] = [{ agent: 'default', model: 'openrouter/shared' }];
    wrapper.findComponent(ModelDefinitions).vm.$emit('update:models', duplicateModels);
    wrapper.findComponent(AgentModelMappings).vm.$emit('update:mappings', mappings);
    await wrapper.vm.$nextTick();

    wrapper.findComponent(ModelDefinitions).vm.$emit('delete-model', 1);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ModelDefinitions).props('models')).toEqual([duplicateModels[0]]);
    expect(wrapper.findComponent(AgentModelMappings).props('mappings')).toEqual(mappings);
    expect(confirmRequire).not.toHaveBeenCalled();

    const blankModels: LLMConfig[] = [
      { id: '', provider: 'openrouter', name: '', options: {} },
      { id: '', provider: 'openai', name: '', options: {} },
    ];
    wrapper.findComponent(ModelDefinitions).vm.$emit('update:models', blankModels);
    await wrapper.vm.$nextTick();
    wrapper.findComponent(ModelDefinitions).vm.$emit('delete-model', 0);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(ModelDefinitions).props('models')).toEqual([blankModels[1]]);
  });

  it('clears mappings only after the final definition of their model is deleted', async () => {
    const wrapper = mount(ConfigView, { shallow: true });
    await flushPromises();
    const models: LLMConfig[] = [
      { id: 'openrouter/shared', provider: 'openrouter', name: 'first', options: {} },
      { id: 'openrouter/shared', provider: 'openrouter', name: 'second', options: {} },
    ];
    const mappings: AgentMapping[] = [{ agent: 'default', model: 'openrouter/shared' }];
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
