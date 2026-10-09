import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import GameSessionsList from '@/components/telemetry/GameSessionsList.vue';
import type { TelemetrySession } from '@/utils/types';
import { ButtonStub, TagStub, ToolbarStub } from '../../../helpers/stubs.js';

const stubs = { Toolbar: ToolbarStub, Tag: TagStub, Button: ButtonStub };

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
  it('emits session selection from both the row and view button', async () => {
    const wrapper = mountList([makeSession()]);

    await wrapper.get('.table-row').trigger('click');
    expect(wrapper.emitted('session-selected')?.[0]).toEqual(['session-1']);

    await wrapper.get('.p-btn').trigger('click');
    expect(wrapper.emitted('session-selected')?.[1]).toEqual(['session-1']);
  });

  it('preserves the empty action slot and optional actions column', () => {
    const emptyWrapper = mount(GameSessionsList, {
      props: { sessions: [] },
      global: { stubs },
      slots: { 'empty-action': '<button class="connect">Connect</button>' },
    });
    expect(emptyWrapper.find('.connect').exists()).toBe(true);

    const listWrapper = mountList([makeSession()], false);
    expect(listWrapper.find('.col-fixed-100').exists()).toBe(false);
    expect(listWrapper.find('.p-btn').exists()).toBe(false);
  });
});
