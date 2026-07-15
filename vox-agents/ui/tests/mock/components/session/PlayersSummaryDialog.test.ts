import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import PlayersSummaryDialog from '@/components/session/PlayersSummaryDialog.vue';
import { api } from '@/api/client';

const stubs = {
  Dialog: {
    props: ['visible'],
    emits: ['update:visible', 'hide'],
    template: '<section><slot name="header" /><slot /></section>'
  },
  ProgressSpinner: {
    template: '<span />'
  }
};

beforeEach(() => {
  vi.useFakeTimers();
});

describe('PlayersSummaryDialog', () => {
  it('loads active telemetry sessions while visible and releases polling when closed', async () => {
    vi.spyOn(api, 'getPlayersSummary').mockResolvedValue({
      players: { '0': { Civilization: 'Rome', Leader: 'Augustus', IsMajor: true } },
      assignments: {}
    });
    const telemetryRequest = vi.spyOn(api, 'getTelemetrySessions').mockResolvedValue({
      sessions: [{ sessionId: 'telemetry-1', playerID: '0' }]
    });
    const wrapper = mount(PlayersSummaryDialog, {
      props: { visible: false },
      global: { stubs }
    });

    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(telemetryRequest).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.telemetry-link').exists()).toBe(true);

    await wrapper.setProps({ visible: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(telemetryRequest).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
