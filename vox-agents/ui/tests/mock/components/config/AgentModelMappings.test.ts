import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import AgentModelMappings from '@/components/config/AgentModelMappings.vue';
import type { AgentMapping, SelectOption } from '@/utils/types';

const DropdownStub = defineComponent({
  props: ['modelValue', 'options'],
  emits: ['update:modelValue'],
  template: '<select><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>'
});

const ButtonStub = defineComponent({
  props: ['disabled'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
});

const mappings: AgentMapping[] = [{ agent: 'default', model: 'openrouter/chat' }];
const agentTypes: SelectOption[] = [{ label: 'Default', value: 'default' }];
const availableModels: SelectOption[] = [{ label: 'Chat', value: 'openrouter/chat' }];
const embeddingModels: SelectOption[] = [{ label: 'Embedder', value: 'openai/embedder' }];

/** Mount mappings with PrimeVue controls replaced by event-focused stubs. */
function mountMappings(modelOptions = availableModels): VueWrapper {
  return mount(AgentModelMappings, {
    props: {
      mappings,
      agentTypes,
      availableModels: modelOptions,
      embeddingModels,
      embedderModel: 'openai/embedder',
      evaluationModels: [],
      evaluatorModel: null
    },
    global: {
      stubs: {
        Dropdown: DropdownStub,
        Button: ButtonStub,
        Card: { template: '<section><slot name="title" /><slot name="subtitle" /><slot name="content" /></section>' }
      }
    }
  });
}

describe('AgentModelMappings', () => {
  it('should enable Add Mapping and add a blank mapping when no models are available', async () => {
    const wrapper = mountMappings([]);
    const addButton = wrapper.get('button');

    expect(addButton.attributes('disabled')).toBeUndefined();
    await addButton.trigger('click');

    expect(wrapper.emitted('update:mappings')).toEqual([[ [
      ...mappings,
      { agent: 'default', model: '' }
    ] ]]);
  });

  it('should list More as the final option for chat and embedding models', () => {
    const wrapper = mountMappings();
    const dropdowns = wrapper.findAllComponents(DropdownStub);

    expect(dropdowns[1]?.props('options')).toEqual([
      ...availableModels,
      { label: 'More...', value: '__more-models__' }
    ]);
    expect(dropdowns[2]?.props('options')).toEqual([
      ...embeddingModels,
      { label: 'More...', value: '__more-models__' }
    ]);
  });

  it('should open discovery for a mapping More choice without updating mappings', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[1]?.vm.$emit('update:modelValue', '__more-models__');

    expect(wrapper.emitted('discover-model')).toEqual([[0]]);
    expect(wrapper.emitted('update:mappings')).toBeUndefined();
  });

  it('should update mappings when a real model is selected', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[1]?.vm.$emit('update:modelValue', 'openai/gpt-5');

    expect(wrapper.emitted('update:mappings')).toEqual([[
      [{ agent: 'default', model: 'openai/gpt-5' }]
    ]]);
  });

  it('should open discovery for an embedder More choice without updating the embedder', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[2]?.vm.$emit('update:modelValue', '__more-models__');

    expect(wrapper.emitted('discover-embedder')).toEqual([[]]);
    expect(wrapper.emitted('update:embedderModel')).toBeUndefined();
  });

  it('should update the embedder for real values and clearing it', async () => {
    const wrapper = mountMappings();
    const embedder = wrapper.findAllComponents(DropdownStub)[2];
    await embedder?.vm.$emit('update:modelValue', 'openai/new-embedder');
    await embedder?.vm.$emit('update:modelValue', null);

    expect(wrapper.emitted('update:embedderModel')).toEqual([
      ['openai/new-embedder'],
      [null]
    ]);
  });
});
