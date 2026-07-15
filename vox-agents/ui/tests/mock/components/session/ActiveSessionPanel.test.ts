import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ActiveSessionPanel from '@/components/session/ActiveSessionPanel.vue';
import type { SessionStatus, StrategistSessionConfig } from '@/utils/types';

const stubs = {
  Toolbar: {
    template: '<section><slot name="start" /><slot name="end" /></section>',
  },
  Tag: {
    props: ['value'],
    template: '<span class="p-tag">{{ value }}</span>',
  },
  Button: {
    props: ['label', 'icon', 'disabled', 'loading'],
    emits: ['click'],
    template: '<button :data-icon="icon" :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
  },
};

/** Build a strategist configuration for the active session fixture. */
function makeConfig(): StrategistSessionConfig {
  return {
    name: 'test-config',
    type: 'strategist',
    autoPlay: true,
    gameMode: 'start',
    repetition: 2,
    llmPlayers: {},
  };
}

/** Build an active session fixture with optional status overrides. */
function makeSession(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    id: 'session-1',
    type: 'strategist',
    state: 'running',
    config: makeConfig(),
    startTime: new Date(Date.now() - 65_000),
    gameID: 'game-1',
    turn: 42,
    ...overrides,
  };
}

describe('ActiveSessionPanel', () => {
  it('renders the active session details and paused state', () => {
    const wrapper = mount(ActiveSessionPanel, {
      props: { session: makeSession({ paused: true }), loading: false },
      global: { stubs },
    });

    expect(wrapper.text()).toContain('RUNNING');
    expect(wrapper.text()).toContain('PAUSED');
    expect(wrapper.text()).toContain('session-1');
    expect(wrapper.text()).toContain('game-1');
    expect(wrapper.text()).toContain('42');
    expect(wrapper.text()).toContain('1m 5s');
    expect(wrapper.text()).toContain('Resume');
  });

  it('emits each session action', async () => {
    const wrapper = mount(ActiveSessionPanel, {
      props: { session: makeSession(), loading: false },
      global: { stubs },
    });

    await wrapper.get('button[data-icon="pi pi-users"]').trigger('click');
    await wrapper.get('button[data-icon="pi pi-pause"]').trigger('click');
    await wrapper.get('button[data-icon="pi pi-stop"]').trigger('click');

    expect(wrapper.emitted('viewPlayers')).toHaveLength(1);
    expect(wrapper.emitted('togglePause')).toHaveLength(1);
    expect(wrapper.emitted('stop')).toHaveLength(1);
  });

  it('disables pausing outside running and recovering states', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const wrapper = mount(ActiveSessionPanel, {
      props: { session: makeSession({ state: 'starting' }), loading: false },
      global: { stubs },
    });

    expect(wrapper.get('button[data-icon="pi pi-pause"]').attributes('disabled')).toBeDefined();
  });
});
