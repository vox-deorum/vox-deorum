import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import type { AgentInfo, SessionConfigEntry } from '@/utils/types';

let SessionView: typeof import('@/views/SessionView.vue').default;

const { api, routerReplace, route } = vi.hoisted(() => ({
  api: {
    getSessionConfigs: vi.fn(),
    getAgents: vi.fn(),
    startSession: vi.fn(),
    saveSessionConfig: vi.fn(),
    deleteSessionConfig: vi.fn(),
  },
  routerReplace: vi.fn(),
  route: { query: { setup: 'game' as string | undefined } },
}));

vi.mock('@/api/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api,
}));

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: routerReplace }),
}));

vi.mock('@/stores/session', () => ({
  sessionStatus: ref({ active: false }),
  loading: ref(false),
  error: ref(null),
  fetchFreshSessionStatus: vi.fn(),
  stopSession: vi.fn(),
  pauseSession: vi.fn(),
  resumeSession: vi.fn(),
  startSessionPolling: vi.fn(() => () => undefined),
}));

vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: vi.fn() }) }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }));

const SessionConfigListStub = defineComponent({
  name: 'SessionConfigList',
  props: ['configs', 'agents', 'globalLlms', 'highlightedConfigName'],
  emits: ['create', 'advancedCreate', 'start', 'edit', 'duplicate', 'delete'],
  template: '<div class="config-list-stub" />',
});

const GameSetupWizardStub = defineComponent({
  name: 'GameSetupWizard',
  props: ['visible', 'agents', 'agentsLoading', 'agentsError', 'globalLlms', 'existingConfigNames'],
  emits: ['update:visible', 'saved', 'retryAgents', 'advanced'],
  template: '<div class="game-wizard-stub" />',
});

const ConfigDialogStub = defineComponent({
  name: 'ConfigDialog',
  props: ['visible'],
  template: '<div class="config-dialog-stub" />',
});

const GameModeDialogStub = defineComponent({
  name: 'GameModeDialog',
  props: ['visible', 'loading'],
  emits: ['update:visible', 'select'],
  template: '<div class="game-mode-stub" />',
});

const config: SessionConfigEntry = {
  name: 'starter',
  filename: 'starter.json',
  updatedAt: '2026-08-01T12:00:00.000Z',
  type: 'strategist',
  autoPlay: false,
  llmPlayers: { 1: { strategist: 'simple-strategist' } },
};

const agents: AgentInfo[] = [{
  name: 'simple-strategist',
  displayName: 'Simple LLM Strategist',
  description: 'A direct strategist',
  tags: ['strategist'],
  modelSize: 'default',
  offeredInSetup: true,
}];

/** Mount the view with session-child components replaced by event-capable stubs. */
function mountView() {
  return mount(SessionView, {
    global: {
      stubs: {
        ActiveSessionPanel: true,
        ConfigDialog: ConfigDialogStub,
        PlayersSummaryDialog: true,
        SessionConfigList: SessionConfigListStub,
        GameSetupWizard: GameSetupWizardStub,
        GameModeDialog: GameModeDialogStub,
        Message: { template: '<div class="message-stub"><slot /></div>' },
      },
    },
  });
}

describe('SessionView', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reload the component so each case gets a fresh catalogue cache.
    vi.resetModules();
    SessionView = (await import('@/views/SessionView.vue')).default;
    route.query = { setup: 'game' };
    api.getSessionConfigs.mockResolvedValue({ configs: [config], globalLlms: { default: 'openai/gpt-5-mini' } });
    api.getAgents.mockResolvedValue({ agents });
    api.startSession.mockResolvedValue({});
  });

  it('opens game setup from the handoff query, clears it, and loads shared catalogues once', async () => {
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.findComponent(GameSetupWizardStub).props('visible')).toBe(true);
    expect(wrapper.findComponent(GameSetupWizardStub).props('existingConfigNames')).toEqual(['starter']);
    expect(routerReplace).toHaveBeenCalledWith({ query: {} });
    expect(api.getAgents).toHaveBeenCalledTimes(1);
    expect(wrapper.findComponent(SessionConfigListStub).props('globalLlms')).toEqual({ default: 'openai/gpt-5-mini' });
  });

  it('reloads and highlights a saved wizard config, then sends launch mode outside the config', async () => {
    const wrapper = mountView();
    await flushPromises();
    const { filename: _filename, updatedAt: _updatedAt, ...plainConfig } = config;

    await wrapper.findComponent(GameSetupWizardStub).vm.$emit('saved', plainConfig, true);
    await flushPromises();

    expect(wrapper.findComponent(SessionConfigListStub).props('highlightedConfigName')).toBe('starter');
    expect(wrapper.findComponent(GameModeDialogStub).props('visible')).toBe(true);

    await wrapper.findComponent(GameModeDialogStub).vm.$emit('select', 'load');
    await flushPromises();

    expect(api.startSession).toHaveBeenCalledWith(plainConfig, 'load');
  });

  it('keeps saved configurations available and recovers guided setup when the agent catalogue fails', async () => {
    api.getAgents
      .mockRejectedValueOnce(new Error('catalogue unavailable'))
      .mockResolvedValueOnce({ agents });
    const wrapper = mountView();
    await flushPromises();

    expect(wrapper.findComponent(SessionConfigListStub).props('configs')).toEqual([config]);
    expect(wrapper.text()).toContain('Game setup styles are unavailable: catalogue unavailable');
    expect(wrapper.findComponent(GameSetupWizardStub).props('agentsError')).toContain('catalogue unavailable');
    await wrapper.findComponent(GameSetupWizardStub).vm.$emit('retryAgents');
    await flushPromises();
    expect(api.getAgents).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent(GameSetupWizardStub).props('agents')).toEqual(agents);

    await wrapper.findComponent(GameSetupWizardStub).vm.$emit('advanced');
    await flushPromises();
    expect(wrapper.findComponent(GameSetupWizardStub).props('visible')).toBe(false);
    expect(wrapper.findComponent(ConfigDialogStub).props('visible')).toBe(true);
  });
});
