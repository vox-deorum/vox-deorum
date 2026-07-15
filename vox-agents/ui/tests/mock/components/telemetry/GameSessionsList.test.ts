import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import GameSessionsList from '@/components/telemetry/GameSessionsList.vue';
import type { TelemetrySession } from '@/utils/types';

const stubs = {
  Toolbar: { template: '<div class="p-toolbar"><slot name="start" /></div>' },
  Tag: { props: ['value'], template: '<span class="p-tag">{{ value }}</span>' },
  Button: {
    props: ['label', 'icon'],
    emits: ['click'],
    template: '<button class="p-btn" :data-icon="icon" @click="$emit(\'click\', $event)">{{ label }}</button>',
  },
};

/** Build a telemetry session fixture with optional field overrides. */
function makeSession(overrides: Partial<TelemetrySession> = {}): TelemetrySession {
  return {
    sessionId: 'session-1',
    gameID: 'game-1',
    playerID: '2',
    ...overrides,
  };
}

/** Mount the list with its required session collection. */
function mountList(sessions: TelemetrySession[], showViewButton = true) {
  return mount(GameSessionsList, {
    props: { sessions, showViewButton },
    global: { stubs },
  });
}

describe('GameSessionsList', () => {
  it('renders each session and the shared count tag', () => {
    const wrapper = mountList([makeSession(), makeSession({ sessionId: 'session-2' })]);

    expect(wrapper.findAll('.table-row')).toHaveLength(2);
    expect(wrapper.text()).toContain('game-1');
    expect(wrapper.text()).toContain('2');
    expect(wrapper.get('.p-tag').text()).toBe('2');
  });

  it('emits row selection and an independent view action', async () => {
    const wrapper = mountList([makeSession()]);

    await wrapper.get('.table-row').trigger('click');
    expect(wrapper.emitted('session-selected')?.[0]).toEqual(['session-1']);

    await wrapper.get('.p-btn').trigger('click');
    expect(wrapper.emitted('view-session')?.[0]).toEqual(['session-1']);
    expect(wrapper.emitted('session-selected')).toHaveLength(1);
  });

  it('preserves the empty action slot and optional actions column', () => {
    const emptyWrapper = mount(GameSessionsList, {
      props: { sessions: [] },
      global: { stubs },
      slots: { 'empty-action': '<button class="connect">Connect</button>' },
    });
    expect(emptyWrapper.get('.table-empty').text()).toContain('No active game sessions available');
    expect(emptyWrapper.find('.connect').exists()).toBe(true);

    const listWrapper = mountList([makeSession()], false);
    expect(listWrapper.find('.col-fixed-100').exists()).toBe(false);
    expect(listWrapper.find('.p-btn').exists()).toBe(false);
  });
});
