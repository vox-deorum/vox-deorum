import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import DebugView from '@/views/DebugView.vue';
import type { DebugStatusResponse, ShowNewspaperResponse } from '@/utils/types';

const { api, toastAdd } = vi.hoisted(() => ({
  api: {
    getDebugStatus: vi.fn(),
    showNewspaper: vi.fn(),
  },
  toastAdd: vi.fn(),
}));

vi.mock('@/api/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api,
}));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));
vi.mock('@/components/logging/LogViewer.vue', () => ({ default: { template: '<div />' } }));

const TabsStub = defineComponent({
  name: 'Tabs',
  props: ['value', 'lazy'],
  template: '<div><slot /></div>',
});

const ButtonStub = defineComponent({
  name: 'Button',
  props: ['label', 'loading', 'disabled'],
  emits: ['click'],
  template: '<button :disabled="disabled" :data-loading="String(loading)" @click="$emit(\'click\')">{{ label }}</button>',
});

/** Create a promise whose result the test can control. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Mount the debug view with its panels stubbed out. */
function mountView() {
  return mount(DebugView, {
    shallow: true,
    global: {
      directives: { tooltip: () => {} },
      stubs: { Tabs: TabsStub, Button: ButtonStub },
    },
  });
}

/** Find the header action with the given label. */
function findButton(wrapper: ReturnType<typeof mountView>, label: string) {
  const button = wrapper.findAll('button').find(candidate => candidate.text() === label);
  expect(button).toBeDefined();
  return button!;
}

describe('DebugView newspaper display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDebugStatus).mockResolvedValue({
      civLogging: false,
      sources: { agents: [], bridge: [], mcp: [], civ5: [] },
    } satisfies DebugStatusResponse);
  });

  it('should request one display and report success only after the game opens it', async () => {
    const display = deferred<ShowNewspaperResponse>();
    vi.mocked(api.showNewspaper).mockReturnValue(display.promise);
    const wrapper = mountView();
    await flushPromises();
    const button = findButton(wrapper, 'Show newspaper');

    await button.trigger('click');
    expect(api.showNewspaper).toHaveBeenCalledTimes(1);
    expect((button.element as HTMLButtonElement).disabled).toBe(true);
    expect(button.attributes('data-loading')).toBe('true');

    await button.trigger('click');
    expect(api.showNewspaper).toHaveBeenCalledTimes(1);
    expect(toastAdd).not.toHaveBeenCalled();

    display.resolve({ success: true, issueId: 'issue-17', key: 'cached-key' });
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledTimes(1);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'success',
      detail: expect.stringContaining('issue-17'),
    }));
    expect((button.element as HTMLButtonElement).disabled).toBe(false);
    expect(button.attributes('data-loading')).toBe('false');
  });

  it('should surface a failed display and allow another attempt', async () => {
    vi.mocked(api.showNewspaper).mockRejectedValueOnce(new Error('No loaded game is available.'));
    const wrapper = mountView();
    await flushPromises();
    const button = findButton(wrapper, 'Show newspaper');

    await button.trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'error',
      detail: 'No loaded game is available.',
    }));
    expect((button.element as HTMLButtonElement).disabled).toBe(false);

    await button.trigger('click');
    expect(api.showNewspaper).toHaveBeenCalledTimes(2);
  });
});
