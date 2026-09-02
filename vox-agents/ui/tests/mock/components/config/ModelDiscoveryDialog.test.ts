import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';
import ModelDiscoveryDialog from '@/components/config/ModelDiscoveryDialog.vue';
import { ModelDiscoveryError, type ModelDiscoveryErrorKind } from '@/api/client';
import { ButtonStub } from '../../../helpers/stubs.js';

const { api } = vi.hoisted(() => ({
  api: { discoverModels: vi.fn() },
}));

vi.mock('@/api/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api,
}));

const DialogStub = defineComponent({
  props: ['visible'],
  emits: ['update:visible'],
  template: '<div class="dialog-stub"><main><slot /></main><footer><slot name="footer" /></footer></div>',
});

const DropdownStub = defineComponent({
  props: ['modelValue', 'options', 'id'],
  emits: ['update:modelValue'],
  template: '<select :id="id" class="dropdown-stub" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">Choose a service</option><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>',
});

const InputTextStub = defineComponent({
  props: ['modelValue', 'id', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<input :id="id" class="input-text-stub" :placeholder="placeholder" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const PasswordStub = defineComponent({
  props: ['modelValue', 'id'],
  emits: ['update:modelValue'],
  template: '<input :id="id" class="password-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const global = {
  stubs: {
    Dialog: DialogStub,
    Dropdown: DropdownStub,
    InputText: InputTextStub,
    Password: PasswordStub,
    Button: ButtonStub,
  },
  directives: { tooltip: () => undefined },
};

/** Mount one open model-discovery dialog with optional stored credentials. */
function mountDialog(apiKeys: Record<string, string> = {}): VueWrapper {
  return mount(ModelDiscoveryDialog, { props: { visible: true, apiKeys }, global });
}

/** Find and click a rendered PrimeVue stub button by its visible label. */
async function clickButton(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('.p-btn').find(candidate => candidate.text() === label);
  if (!button) throw new Error(`Button "${label}" was not found.`);
  await button.trigger('click');
}

/** Choose one provider through the dialog's service control. */
async function chooseProvider(wrapper: VueWrapper, provider: string): Promise<void> {
  await wrapper.find('#model-discovery-provider').setValue(provider);
}

/** Discover the supplied provider and wait for the model list to render. */
async function discoverProvider(wrapper: VueWrapper, provider = 'openrouter'): Promise<void> {
  await chooseProvider(wrapper, provider);
  await clickButton(wrapper, 'Check and continue');
  await flushPromises();
}

describe('ModelDiscoveryDialog', () => {
  it('excludes AWS from the available services', () => {
    const wrapper = mountDialog();

    expect(wrapper.find('#model-discovery-provider').text()).not.toContain('AWS Bedrock');
  });

  it('prefills credentials and sends edited values to model discovery', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openrouter',
      models: [{ id: 'openrouter/model-a', name: 'Model A' }],
    });
    const wrapper = mountDialog({ OPENROUTER_API_KEY: 'stored-key' });

    await chooseProvider(wrapper, 'openrouter');
    expect((wrapper.find('#model-discovery-OPENROUTER_API_KEY').element as HTMLInputElement).value).toBe('stored-key');
    await wrapper.find('#model-discovery-OPENROUTER_API_KEY').setValue('edited-key');
    await clickButton(wrapper, 'Check and continue');
    await flushPromises();

    expect(api.discoverModels).toHaveBeenCalledWith('openrouter', { OPENROUTER_API_KEY: 'edited-key' });
  });

  it('uses the local server default URL for model discovery', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openai-compatible',
      models: [{ id: 'openai-compatible/model-a', name: 'Model A' }],
    });
    const wrapper = mountDialog();

    await discoverProvider(wrapper, 'openai-compatible');

    expect(api.discoverModels).toHaveBeenCalledWith('openai-compatible', {
      OPENAI_COMPATIBLE_URL: 'http://127.0.0.1:11434',
      OPENAI_COMPATIBLE_API_KEY: '',
    });
  });

  it('shows sorted models and selects the recommended default', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openrouter',
      models: [
        { id: 'openrouter/zeta', name: 'Zeta' },
        { id: 'openrouter/alpha', name: 'Alpha' },
      ],
      recommendedTiers: { default: 'openrouter/zeta' },
    });
    const wrapper = mountDialog();

    await discoverProvider(wrapper);

    expect(wrapper.findAll('.setup-wizard-model strong').map(node => node.text()))
      .toEqual(['openrouter/alpha', 'openrouter/zeta']);
    expect((wrapper.find('input[value="openrouter/zeta"]').element as HTMLInputElement).checked).toBe(true);
  });

  it.each<[ModelDiscoveryErrorKind, string]>([
    ['auth', 'did not accept those details'],
    ['network', 'could not reach OpenRouter'],
    ['provider', 'could not list models right now'],
    ['missing-credential', 'Add the requested OpenRouter details'],
    ['unsupported', 'cannot list models here yet'],
  ])('shows discovery guidance for a %s error', async (kind, copy) => {
    api.discoverModels.mockRejectedValue(new ModelDiscoveryError('raw failure', kind));
    const wrapper = mountDialog();

    await discoverProvider(wrapper);

    expect(wrapper.text()).toContain(copy);
  });

  it('suggests Setup wizard after a Codex discovery failure', async () => {
    api.discoverModels.mockRejectedValue(new ModelDiscoveryError('raw failure', 'auth'));
    const wrapper = mountDialog();

    await discoverProvider(wrapper, 'codex');

    expect(wrapper.text()).toContain('Run Setup wizard first');
  });

  it('adds the chosen model, saves entered selected credentials, and closes', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openrouter',
      models: [{ id: 'openrouter/model-a', name: 'Model A' }],
    });
    const wrapper = mountDialog({ OPENAI_API_KEY: 'unrelated-key' });

    await chooseProvider(wrapper, 'openrouter');
    await wrapper.find('#model-discovery-OPENROUTER_API_KEY').setValue('entered-key');
    await clickButton(wrapper, 'Check and continue');
    await flushPromises();
    await wrapper.find('input[value="openrouter/model-a"]').setValue(true);
    await clickButton(wrapper, 'Add model');

    const apiKeyEvents = wrapper.emitted('update:apiKeys') ?? [];
    const selectionEvents = wrapper.emitted('select') ?? [];
    const visibilityEvents = wrapper.emitted('update:visible') ?? [];
    expect(apiKeyEvents[apiKeyEvents.length - 1]).toEqual([{
      OPENAI_API_KEY: 'unrelated-key',
      OPENROUTER_API_KEY: 'entered-key',
    }]);
    expect(selectionEvents[selectionEvents.length - 1]).toEqual([{
      id: 'openrouter/model-a',
      name: 'Model A',
    }]);
    expect(visibilityEvents[visibilityEvents.length - 1]).toEqual([false]);
  });

  it('does not emit a credential update when none were entered', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'claude-code',
      models: [{ id: 'claude-code/model-a', name: 'Model A' }],
    });
    const wrapper = mountDialog({ OPENAI_API_KEY: 'unrelated-key' });

    await discoverProvider(wrapper, 'claude-code');
    await wrapper.find('input[value="claude-code/model-a"]').setValue(true);
    await clickButton(wrapper, 'Add model');

    expect(wrapper.emitted('update:apiKeys')).toBeUndefined();
  });

  it('selects a bracketed Claude Code model id without emitting credentials', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'claude-code',
      models: [{ id: 'claude-code/claude-fable-5-1[1m]', name: 'claude-fable-5-1[1m]' }],
    });
    const wrapper = mountDialog();

    await discoverProvider(wrapper, 'claude-code');
    await wrapper.find('input[value="claude-code/claude-fable-5-1[1m]"]').setValue(true);
    await clickButton(wrapper, 'Add model');

    const selectionEvents = wrapper.emitted('select') ?? [];
    expect(selectionEvents[selectionEvents.length - 1]).toEqual([{
      id: 'claude-code/claude-fable-5-1[1m]',
      name: 'claude-fable-5-1[1m]',
    }]);
    expect(wrapper.emitted('update:apiKeys')).toBeUndefined();
  });

  it('resets the selected provider and credential draft when reopened', async () => {
    const wrapper = mountDialog({ OPENROUTER_API_KEY: 'stored-key' });

    await chooseProvider(wrapper, 'openrouter');
    await wrapper.find('#model-discovery-OPENROUTER_API_KEY').setValue('edited-key');
    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    await chooseProvider(wrapper, 'openrouter');

    expect((wrapper.find('#model-discovery-OPENROUTER_API_KEY').element as HTMLInputElement).value).toBe('stored-key');
  });

  it('does not switch to model picking after closing during discovery', async () => {
    let resolveDiscovery: (value: { provider: string; models: Array<{ id: string; name: string }> }) => void;
    api.discoverModels.mockReturnValue(new Promise(resolve => {
      resolveDiscovery = resolve;
    }));
    const wrapper = mountDialog();

    await chooseProvider(wrapper, 'openrouter');
    await clickButton(wrapper, 'Check and continue');
    await wrapper.setProps({ visible: false });
    resolveDiscovery!({ provider: 'openrouter', models: [{ id: 'openrouter/model-a', name: 'Model A' }] });
    await flushPromises();

    expect(wrapper.text()).toContain('Connect a service');
    expect(wrapper.text()).not.toContain('Pick a model');
  });

  it('does not switch to model picking after changing provider during discovery', async () => {
    let resolveDiscovery: (value: { provider: string; models: Array<{ id: string; name: string }> }) => void;
    api.discoverModels.mockReturnValue(new Promise(resolve => {
      resolveDiscovery = resolve;
    }));
    const wrapper = mountDialog();

    await chooseProvider(wrapper, 'openrouter');
    await clickButton(wrapper, 'Check and continue');
    await chooseProvider(wrapper, 'openai');
    resolveDiscovery!({ provider: 'openrouter', models: [{ id: 'openrouter/model-a', name: 'Model A' }] });
    await flushPromises();

    expect(wrapper.text()).toContain('Connect a service');
    expect(wrapper.text()).not.toContain('Pick a model');
  });
});
