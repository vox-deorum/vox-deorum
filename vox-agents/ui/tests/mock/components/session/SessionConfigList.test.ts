import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SessionConfigList from '@/components/session/SessionConfigList.vue';
import type { StrategistSessionConfig } from '@/utils/types';

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
  Message: {
    template: '<div class="p-message"><slot /></div>',
  },
  ProgressSpinner: {
    template: '<div class="p-spinner" />',
  },
};

/** Build a configuration fixture for list rendering. */
function makeConfig(): StrategistSessionConfig {
  return {
    name: 'standard-game',
    type: 'strategist',
    autoPlay: true,
    gameMode: 'start',
    llmPlayers: {
      0: { strategist: 'simple-strategist' },
      1: { strategist: 'none-strategist' },
      4: { strategist: 'simple-strategist' },
    },
  };
}

/** Mount the list with defaults for non-rendering state props. */
function mountList(configs: readonly StrategistSessionConfig[]) {
  return mount(SessionConfigList, {
    props: {
      configs,
      loading: false,
      error: null,
      sessionActive: false,
      startingSession: false,
    },
    global: {
      stubs,
      directives: { tooltip: () => undefined },
    },
  });
}

describe('SessionConfigList', () => {
  it('renders player counts and the estimated map size', () => {
    const wrapper = mountList([makeConfig()]);

    expect(wrapper.text()).toContain('standard-game');
    expect(wrapper.text()).toContain('2 / 6');
    expect(wrapper.text()).toContain('Small');
    expect(wrapper.text()).toContain('Strategist');
  });

  it('emits the selected configuration for every row action', async () => {
    const config = makeConfig();
    const wrapper = mountList([config]);

    await wrapper.get('button[data-icon="pi pi-play"]').trigger('click');
    await wrapper.get('button[data-icon="pi pi-pencil"]').trigger('click');
    await wrapper.get('button[data-icon="pi pi-copy"]').trigger('click');
    await wrapper.get('button[data-icon="pi pi-trash"]').trigger('click');

    expect(wrapper.emitted('start')?.[0]).toEqual([config]);
    expect(wrapper.emitted('edit')?.[0]).toEqual([config]);
    expect(wrapper.emitted('duplicate')?.[0]).toEqual([config]);
    expect(wrapper.emitted('delete')?.[0]).toEqual([config]);
  });

  it('emits create from the empty state', async () => {
    const wrapper = mountList([]);

    await wrapper.get('button[data-icon="pi pi-plus"]').trigger('click');

    expect(wrapper.emitted('create')).toHaveLength(1);
  });
});
