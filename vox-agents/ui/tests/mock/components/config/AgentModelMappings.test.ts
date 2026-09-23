import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import AgentModelMappings from '@/components/config/AgentModelMappings.vue';
import type { AgentMapping, SelectOption } from '@/utils/types';

const DropdownStub = defineComponent({
  props: ['modelValue', 'options', 'placeholder', 'showClear'],
  emits: ['update:modelValue'],
  template: '<select><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>'
});

const ButtonStub = defineComponent({
  props: ['disabled'],
  emits: ['click'],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
});

// Free-form rows avoid the tier aliases, which have dedicated rows of their own.
const mappings: AgentMapping[] = [{ agent: 'Strategist', model: 'openrouter/chat' }];
const agentTypes: SelectOption[] = [{ label: 'Strategist', value: 'Strategist' }];
const availableModels: SelectOption[] = [{ label: 'Chat', value: 'openrouter/chat' }];
const embeddingModels: SelectOption[] = [{ label: 'Embedder', value: 'openai/embedder' }];
const tierModels = { default: 'openrouter/chat', small: null, large: null };

/** Mount mappings with PrimeVue controls replaced by event-focused stubs. */
function mountMappings(modelOptions = availableModels, types = agentTypes): VueWrapper {
  return mount(AgentModelMappings, {
    props: {
      mappings,
      agentTypes: types,
      availableModels: modelOptions,
      embeddingModels,
      embedderModel: 'openai/embedder',
      evaluationModels: [],
      evaluatorModel: null,
      tierModels
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
      { agent: 'Strategist', model: '' }
    ] ]]);
  });

  it('should add a blank agent when no agent types are available instead of a hidden tier alias', async () => {
    const wrapper = mountMappings([], []);
    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('update:mappings')).toEqual([[ [
      ...mappings,
      { agent: '', model: '' }
    ] ]]);
  });

  it('should render the tier rows with their labels above the other rows', () => {
    const wrapper = mountMappings();

    expect(wrapper.findAll('.mapping-label').map(label => label.text())).toEqual([
      'Main AI', 'Quick AI', 'Deep AI', 'Embedder', 'Judge AI'
    ]);
  });

  it('should require a Main AI model but let Quick and Deep AI fall back to it', () => {
    const dropdowns = mountMappings().findAllComponents(DropdownStub);

    expect(dropdowns[0]?.props('modelValue')).toBe('openrouter/chat');
    expect(dropdowns[0]?.props('placeholder')).toBe('Select model');
    expect(dropdowns[0]?.props('showClear')).toBe(false);
    expect(dropdowns[1]?.props('modelValue')).toBeNull();
    expect(dropdowns[1]?.props('placeholder')).toBe('Same as Main AI');
    expect(dropdowns[1]?.props('showClear')).toBe(true);
    expect(dropdowns[2]?.props('placeholder')).toBe('Same as Main AI');
    expect(dropdowns[2]?.props('showClear')).toBe(true);
  });

  it('should update a tier when a real model is selected', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[1]?.vm.$emit('update:modelValue', 'openai/gpt-5');

    expect(wrapper.emitted('update:tierModel')).toEqual([['small', 'openai/gpt-5']]);
    expect(wrapper.emitted('discover-tier')).toBeUndefined();
  });

  it('should update a tier with null when it is cleared', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[2]?.vm.$emit('update:modelValue', null);

    expect(wrapper.emitted('update:tierModel')).toEqual([['large', null]]);
  });

  it('should open discovery for a tier More choice without updating tiers', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[2]?.vm.$emit('update:modelValue', '__more-models__');

    expect(wrapper.emitted('discover-tier')).toEqual([['large']]);
    expect(wrapper.emitted('update:tierModel')).toBeUndefined();
  });

  it('should list More as the final option for chat and embedding models', () => {
    const wrapper = mountMappings();
    const dropdowns = wrapper.findAllComponents(DropdownStub);

    expect(dropdowns[4]?.props('options')).toEqual([
      ...availableModels,
      { label: 'More...', value: '__more-models__' }
    ]);
    expect(dropdowns[5]?.props('options')).toEqual([
      ...embeddingModels,
      { label: 'More...', value: '__more-models__' }
    ]);
  });

  it('should open discovery for a mapping More choice without updating mappings', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[4]?.vm.$emit('update:modelValue', '__more-models__');

    expect(wrapper.emitted('discover-model')).toEqual([[0]]);
    expect(wrapper.emitted('update:mappings')).toBeUndefined();
  });

  it('should update mappings when a real model is selected', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[4]?.vm.$emit('update:modelValue', 'openai/gpt-5');

    expect(wrapper.emitted('update:mappings')).toEqual([[
      [{ agent: 'Strategist', model: 'openai/gpt-5' }]
    ]]);
  });

  it('should open discovery for an embedder More choice without updating the embedder', async () => {
    const wrapper = mountMappings();
    await wrapper.findAllComponents(DropdownStub)[5]?.vm.$emit('update:modelValue', '__more-models__');

    expect(wrapper.emitted('discover-embedder')).toEqual([[]]);
    expect(wrapper.emitted('update:embedderModel')).toBeUndefined();
  });

  it('should update the embedder for real values and clearing it', async () => {
    const wrapper = mountMappings();
    const embedder = wrapper.findAllComponents(DropdownStub)[5];
    await embedder?.vm.$emit('update:modelValue', 'openai/new-embedder');
    await embedder?.vm.$emit('update:modelValue', null);

    expect(wrapper.emitted('update:embedderModel')).toEqual([
      ['openai/new-embedder'],
      [null]
    ]);
  });
});
