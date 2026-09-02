import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';
import SetupWizard from '@/components/config/SetupWizard.vue';
import { ModelDiscoveryError, type ModelDiscoveryErrorKind } from '@/api/client';
import type { VoxAgentsConfig } from '@/utils/types';
import { ButtonStub } from '../../../helpers/stubs.js';

const { api, push } = vi.hoisted(() => ({
  api: {
    discoverModels: vi.fn(),
    startCodexLogin: vi.fn(),
    getCodexLoginStatus: vi.fn(),
    updateCurrentConfig: vi.fn(),
  },
  push: vi.fn(),
}));

vi.mock('@/api/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api,
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const DialogStub = defineComponent({
  props: ['visible'],
  emits: ['update:visible', 'hide'],
  template: '<div class="dialog-stub"><header class="dialog-header"><slot name="header" /></header><main class="dialog-content"><slot /></main><footer><slot name="footer" /></footer></div>',
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

const ProgressSpinnerStub = { template: '<div class="spinner-stub" />' };

const config = {
  agent: { name: 'vox-deorum' },
  webui: { port: 5555, enabled: true },
  mcpServer: { transport: { type: 'http', endpoint: 'http://localhost' } },
  logging: { level: 'info' },
  llms: {
    existing: { provider: 'anthropic', name: 'old-model' },
    strategist: 'existing',
  },
  configsDir: 'configs',
  episodeDbPath: 'episodes.duckdb',
  telemetryDir: 'telemetry',
} as VoxAgentsConfig;

const global = {
  stubs: {
    Dialog: DialogStub,
    Button: ButtonStub,
    InputText: InputTextStub,
    Password: PasswordStub,
    ProgressSpinner: ProgressSpinnerStub,
  },
  directives: { tooltip: () => undefined },
};

/** Mount one visible wizard with the standard retained configuration. */
function mountWizard(apiKeys: Record<string, string> = {}, wizardConfig: VoxAgentsConfig = config): VueWrapper {
  return mount(SetupWizard, {
    props: { visible: true, apiKeys, config: wizardConfig },
    global,
  });
}

/** Find and click a rendered PrimeVue stub button by its visible label. */
async function clickButton(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('.p-btn').find(candidate => candidate.text() === label);
  if (!button) throw new Error(`Button "${label}" was not found.`);
  await button.trigger('click');
}

/** Choose a setup door and, when needed, a service. */
async function choosePath(wrapper: VueWrapper, door: 'subscription' | 'api' | 'local', provider?: string): Promise<void> {
  await wrapper.find(`input[value="${door}"]`).setValue(true);
  if (provider) await wrapper.find('#setup-service').setValue(provider);
  await clickButton(wrapper, 'Next');
}

/** Reach the model list through a successful OpenRouter discovery. */
async function discoverOpenRouter(wrapper: VueWrapper): Promise<void> {
  await choosePath(wrapper, 'api', 'openrouter');
  await wrapper.find('#setup-OPENROUTER_API_KEY').setValue('entered-key');
  await clickButton(wrapper, 'Check and continue');
  await flushPromises();
}

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.startCodexLogin.mockResolvedValue({ state: 'starting' });
    api.getCodexLoginStatus.mockResolvedValue({ state: 'starting', login: null, error: null });
    api.updateCurrentConfig.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders setup progress in the dialog header', () => {
    const wrapper = mountWizard();

    expect(wrapper.get('.dialog-header .setup-wizard-progress').text()).toContain('1. Connection');
    expect(wrapper.find('.dialog-content .setup-wizard-progress').exists()).toBe(false);
  });

  it('requires a door and service before progressing', async () => {
    const wrapper = mountWizard();
    const next = wrapper.findAll('.p-btn').find(candidate => candidate.text() === 'Next');
    expect(next?.attributes('disabled')).toBeDefined();

    await wrapper.find('input[value="subscription"]').setValue(true);
    expect(next?.attributes('disabled')).toBeDefined();
    await wrapper.find('#setup-service').setValue('synthetic');
    expect(next?.attributes('disabled')).toBeUndefined();

    await clickButton(wrapper, 'Next');
    expect(wrapper.text()).toContain('Connect your Synthetic.new account');
  });

  it('checks entered credentials and discovers models in one action', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openrouter',
      models: [{ id: 'openrouter/model-a', name: 'Model A' }],
    });
    const wrapper = mountWizard({ OPENROUTER_API_KEY: 'stored-key' });

    await choosePath(wrapper, 'api', 'openrouter');
    expect((wrapper.find('#setup-OPENROUTER_API_KEY').element as HTMLInputElement).value).toBe('stored-key');
    await wrapper.find('#setup-OPENROUTER_API_KEY').setValue('new-key');
    await clickButton(wrapper, 'Check and continue');
    await flushPromises();

    expect(api.discoverModels).toHaveBeenCalledWith('openrouter', { OPENROUTER_API_KEY: 'new-key' });
    expect(wrapper.text()).toContain('Pick the model your AI opponents will use');
  });

  it('picks up stored credentials that finish loading while first-run setup is open', async () => {
    const wrapper = mountWizard();
    await wrapper.setProps({ apiKeys: { OPENROUTER_API_KEY: 'loaded-key' } });
    await choosePath(wrapper, 'api', 'openrouter');

    expect((wrapper.find('#setup-OPENROUTER_API_KEY').element as HTMLInputElement).value).toBe('loaded-key');
  });

  it('sorts, renders, and filters the discovered model list by stable id', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openrouter',
      models: [
        { id: 'openrouter/zeta', name: 'Zeta' },
        { id: 'openrouter/alpha', name: 'Alpha' },
      ],
    });
    const wrapper = mountWizard();
    await discoverOpenRouter(wrapper);

    expect(wrapper.findAll('.setup-wizard-model strong').map(node => node.text()))
      .toEqual(['openrouter/alpha', 'openrouter/zeta']);
    await wrapper.find('#setup-model-filter').setValue('zeta');
    expect(wrapper.findAll('.setup-wizard-model strong').map(node => node.text()))
      .toEqual(['openrouter/zeta']);
    await wrapper.find('#setup-model-filter').setValue('missing');
    expect(wrapper.text()).toContain('No AIs match that filter.');
  });

  it.each<[ModelDiscoveryErrorKind, string]>([
    ['auth', 'did not accept those details'],
    ['network', 'could not reach OpenRouter'],
    ['provider', 'could not list models right now'],
    ['missing-credential', 'Add the requested OpenRouter details'],
    ['unsupported', 'cannot list models here yet'],
  ])('shows blame-free guidance for a %s discovery error', async (kind, copy) => {
    api.discoverModels.mockRejectedValue(new ModelDiscoveryError('raw failure', kind));
    const wrapper = mountWizard();
    await choosePath(wrapper, 'api', 'openrouter');
    await clickButton(wrapper, 'Check and continue');
    await flushPromises();

    expect(wrapper.text()).toContain(copy);
    expect(wrapper.text()).toContain('Try again');
    expect(wrapper.text()).toContain('Back');
  });

  it('saves a materialized model and retains every existing LLM entry', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openrouter',
      models: [{
        id: 'openrouter/new-model',
        name: 'new-model',
        recommendedOptions: { reasoningEffort: 'high' },
      }],
    });
    const wrapper = mountWizard({ OPENAI_API_KEY: 'unrelated-key' });
    await discoverOpenRouter(wrapper);
    await wrapper.find('input[value="openrouter/new-model"]').setValue(true);
    await clickButton(wrapper, 'Next');
    await clickButton(wrapper, 'Save & start playing');
    await flushPromises();

    expect(api.updateCurrentConfig).toHaveBeenCalledWith({
      apiKeys: { OPENAI_API_KEY: 'unrelated-key', OPENROUTER_API_KEY: 'entered-key' },
      config: expect.objectContaining({
        llms: {
          ...config.llms,
          'openrouter/new-model': {
            provider: 'openrouter',
            name: 'new-model',
            options: { reasoningEffort: 'high' },
          },
          default: 'openrouter/new-model',
        },
      }),
    });
    expect(api.updateCurrentConfig.mock.calls[0]![0].config.llms['openrouter/new-model']).not.toHaveProperty('id');
    expect(push).toHaveBeenCalledWith('/session?setup=game');
    const visibilityEvents = wrapper.emitted('update:visible') ?? [];
    expect(visibilityEvents[visibilityEvents.length - 1]).toEqual([false]);
  });

  it('preselects recommended tiers, saves both aliases, and names them on confirmation', async () => {
    api.getCodexLoginStatus.mockResolvedValue({ state: 'ready', login: null, error: null });
    api.discoverModels.mockResolvedValue({
      provider: 'codex',
      models: [
        {
          id: 'codex/gpt-5.6-terra',
          name: 'gpt-5.6-terra',
          recommendedOptions: { concurrencyLimit: 1 },
        },
        {
          id: 'codex/gpt-5.6-luna',
          name: 'gpt-5.6-luna',
          recommendedOptions: { reasoningEffort: 'high' },
        },
      ],
      recommendedTiers: { default: 'codex/gpt-5.6-terra', small: 'codex/gpt-5.6-luna' },
    });
    const wrapper = mountWizard();

    await choosePath(wrapper, 'subscription', 'codex');
    await flushPromises();
    expect((wrapper.find('input[value="codex/gpt-5.6-terra"]').element as HTMLInputElement).checked).toBe(true);
    await clickButton(wrapper, 'Next');

    expect(wrapper.text()).toContain('Main AI: gpt-5.6-terra (codex/gpt-5.6-terra)');
    expect(wrapper.text()).toContain('Routine AI: gpt-5.6-luna (codex/gpt-5.6-luna) (summaries and reports)');
    await clickButton(wrapper, 'Save & start playing');
    await flushPromises();

    expect(api.updateCurrentConfig).toHaveBeenCalledWith({
      config: expect.objectContaining({
        llms: {
          ...config.llms,
          'codex/gpt-5.6-terra': {
            provider: 'codex',
            name: 'gpt-5.6-terra',
            options: { concurrencyLimit: 1 },
          },
          'codex/gpt-5.6-luna': {
            provider: 'codex',
            name: 'gpt-5.6-luna',
            options: { reasoningEffort: 'high' },
          },
          default: 'codex/gpt-5.6-terra',
          small: 'codex/gpt-5.6-luna',
        },
      }),
    });
  });

  it('saves only the selected default when discovery has no recommended tiers', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openrouter',
      models: [{ id: 'openrouter/model-a', name: 'Model A' }],
    });
    const wrapper = mountWizard();

    await discoverOpenRouter(wrapper);
    expect((wrapper.find('input[value="openrouter/model-a"]').element as HTMLInputElement).checked).toBe(false);
    await wrapper.find('input[value="openrouter/model-a"]').setValue(true);
    await clickButton(wrapper, 'Next');
    await clickButton(wrapper, 'Save & start playing');
    await flushPromises();

    const savedLlms = api.updateCurrentConfig.mock.calls[0]![0].config.llms;
    expect(savedLlms.default).toBe('openrouter/model-a');
    expect(savedLlms).not.toHaveProperty('small');
  });

  it('retains explicit Codex definitions while adding recommended model tiers', async () => {
    api.getCodexLoginStatus.mockResolvedValue({ state: 'ready', login: null, error: null });
    api.discoverModels.mockResolvedValue({
      provider: 'codex',
      models: [
        {
          id: 'codex/gpt-5.6-terra',
          name: 'gpt-5.6-terra',
          recommendedOptions: { concurrencyLimit: 1 },
        },
        {
          id: 'codex/gpt-5.6-luna',
          name: 'gpt-5.6-luna',
          recommendedOptions: { concurrencyLimit: 2, reasoningEffort: 'high' },
        },
      ],
      recommendedTiers: { default: 'codex/gpt-5.6-terra', small: 'codex/gpt-5.6-luna' },
    });
    const retainedConfig = {
      ...config,
      llms: {
        ...config.llms,
        'codex/gpt-5.6-terra': {
          provider: 'codex',
          name: 'curated-terra',
          options: { reasoningEffort: 'high' as const },
        },
        'codex/gpt-5.6-luna': {
          provider: 'codex',
          name: 'curated-luna',
          options: { reasoningEffort: 'low' as const },
        },
        unrelated: { provider: 'openai', name: 'other-model' },
      },
    } as VoxAgentsConfig;
    const wrapper = mountWizard({}, retainedConfig);

    await choosePath(wrapper, 'subscription', 'codex');
    await flushPromises();
    await clickButton(wrapper, 'Next');
    await clickButton(wrapper, 'Save & start playing');
    await flushPromises();

    const savedLlms = api.updateCurrentConfig.mock.calls[0]![0].config.llms;
    expect(savedLlms['codex/gpt-5.6-terra']).toEqual({
      provider: 'codex',
      name: 'curated-terra',
      options: { concurrencyLimit: 1, reasoningEffort: 'high' },
    });
    expect(savedLlms['codex/gpt-5.6-luna']).toEqual({
      provider: 'codex',
      name: 'curated-luna',
      options: { concurrencyLimit: 2, reasoningEffort: 'low' },
    });
    expect(savedLlms.default).toBe('codex/gpt-5.6-terra');
    expect(savedLlms.small).toBe('codex/gpt-5.6-luna');
    expect(savedLlms.unrelated).toEqual({ provider: 'openai', name: 'other-model' });
    expect(savedLlms['codex/gpt-5.6-terra']).not.toHaveProperty('id');
    expect(savedLlms['codex/gpt-5.6-luna']).not.toHaveProperty('id');
  });

  it('retains string aliases for discovered tier models when setup runs again', async () => {
    api.getCodexLoginStatus.mockResolvedValue({ state: 'ready', login: null, error: null });
    api.discoverModels.mockResolvedValue({
      provider: 'codex',
      models: [
        { id: 'codex/gpt-5.6-terra', name: 'gpt-5.6-terra' },
        { id: 'codex/gpt-5.6-luna', name: 'gpt-5.6-luna' },
      ],
      recommendedTiers: { default: 'codex/gpt-5.6-terra', small: 'codex/gpt-5.6-luna' },
    });
    const retainedConfig = {
      ...config,
      llms: {
        ...config.llms,
        'codex/gpt-5.6-terra': 'curated-main',
        'codex/gpt-5.6-luna': 'curated-routine',
        'curated-main': { provider: 'codex', name: 'gpt-5.6-terra' },
        'curated-routine': { provider: 'codex', name: 'gpt-5.6-luna' },
        unrelated: 'existing',
      },
    } as VoxAgentsConfig;
    const wrapper = mountWizard({}, retainedConfig);

    await choosePath(wrapper, 'subscription', 'codex');
    await flushPromises();
    await clickButton(wrapper, 'Next');
    await clickButton(wrapper, 'Save & start playing');
    await flushPromises();

    expect(api.updateCurrentConfig.mock.calls[0]![0].config.llms).toEqual({
      ...retainedConfig.llms,
      default: 'codex/gpt-5.6-terra',
      small: 'codex/gpt-5.6-luna',
    });
  });

  it('preserves non-empty API-key drafts when the selected service has no credential fields', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'claude-code',
      models: [{ id: 'claude-code/claude-fable-5-1[1m]', name: 'claude-fable-5-1[1m]' }],
    });
    const wrapper = mountWizard({ OPENAI_API_KEY: 'unrelated-key' });
    await choosePath(wrapper, 'subscription', 'claude-code');
    await clickButton(wrapper, 'Check and continue');
    await flushPromises();
    await wrapper.find('input[value="claude-code/claude-fable-5-1[1m]"]').setValue(true);
    await clickButton(wrapper, 'Next');
    await clickButton(wrapper, 'Save & start playing');
    await flushPromises();

    expect(api.updateCurrentConfig).toHaveBeenCalledWith({
      config: expect.objectContaining({
        llms: expect.objectContaining({
          'claude-code/claude-fable-5-1[1m]': {
            provider: 'claude-code',
            name: 'claude-fable-5-1[1m]',
          },
        }),
      }),
      apiKeys: { OPENAI_API_KEY: 'unrelated-key' },
    });
  });

  it('keeps the confirmation open when saving fails', async () => {
    api.discoverModels.mockResolvedValue({
      provider: 'openrouter',
      models: [{ id: 'openrouter/model', name: 'model' }],
    });
    api.updateCurrentConfig.mockRejectedValue(new Error('The settings file is unavailable.'));
    const wrapper = mountWizard();
    await discoverOpenRouter(wrapper);
    await wrapper.find('input[value="openrouter/model"]').setValue(true);
    await clickButton(wrapper, 'Next');
    await clickButton(wrapper, 'Save & start playing');
    await flushPromises();

    expect(wrapper.text()).toContain('Setup was not saved.');
    expect(wrapper.text()).toContain('The settings file is unavailable.');
    expect(wrapper.emitted('update:visible')).toBeUndefined();
    expect(push).not.toHaveBeenCalled();

    api.updateCurrentConfig.mockResolvedValue({ success: true });
    await clickButton(wrapper, 'Save & start playing');
    await flushPromises();
    expect(push).toHaveBeenCalledWith('/session?setup=game');
    expect(wrapper.emitted('update:visible')).toEqual([[false]]);
  });

  it('shows the ChatGPT prompt and advances automatically when sign-in becomes ready', async () => {
    vi.useFakeTimers();
    api.getCodexLoginStatus
      .mockResolvedValueOnce({
        state: 'starting',
        login: { verificationUrl: 'https://example.com/login', userCode: 'ABCD-EFGH' },
        error: null,
      })
      .mockResolvedValueOnce({ state: 'ready', login: null, error: null });
    api.discoverModels.mockResolvedValue({
      provider: 'codex',
      models: [{ id: 'codex/gpt-5', name: 'gpt-5' }],
    });
    const wrapper = mountWizard();

    await choosePath(wrapper, 'subscription', 'codex');
    await flushPromises();
    expect(api.startCodexLogin).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('ABCD-EFGH');
    expect(wrapper.text()).toContain('Waiting for sign-in');
    await clickButton(wrapper, 'Copy code');
    await flushPromises();
    expect(wrapper.text()).toContain('Copy is unavailable');

    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();
    expect(api.discoverModels).toHaveBeenCalledWith('codex', {});
    expect(wrapper.text()).toContain('codex/gpt-5');
  });

  it('allows ChatGPT sign-in startup to be retried', async () => {
    vi.useFakeTimers();
    api.startCodexLogin
      .mockRejectedValueOnce(new Error('Sign-in could not start.'))
      .mockResolvedValueOnce({ state: 'starting' });
    api.getCodexLoginStatus.mockResolvedValue({
      state: 'starting',
      login: { verificationUrl: 'https://example.com/login', userCode: 'RETRY-CODE' },
      error: null,
    });
    const wrapper = mountWizard();
    await choosePath(wrapper, 'subscription', 'codex');
    await flushPromises();
    expect(wrapper.text()).toContain('Sign-in could not start.');

    await clickButton(wrapper, 'Retry');
    await flushPromises();
    expect(api.startCodexLogin).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('RETRY-CODE');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops ChatGPT polling when closed and when unmounted', async () => {
    vi.useFakeTimers();
    const wrapper = mountWizard();
    await choosePath(wrapper, 'subscription', 'codex');
    await flushPromises();
    expect(vi.getTimerCount()).toBe(1);

    await clickButton(wrapper, 'Cancel');
    expect(vi.getTimerCount()).toBe(0);

    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    await choosePath(wrapper, 'subscription', 'codex');
    await flushPromises();
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
