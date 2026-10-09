import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import TelemetryDatabaseView from '@/views/TelemetryDatabaseView.vue';
import StrategistTurnDialog from '@/components/telemetry/strategist/StrategistTurnDialog.vue';
import TurnViewButton from '@/components/telemetry/strategist/TurnViewButton.vue';
import { api } from '@/api/client';
import type { Span } from '@/utils/types';

const { toastAdd } = vi.hoisted(() => ({ toastAdd: vi.fn() }));

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { filename: 'game.db' } }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }));

vi.mock('@/api/client', () => ({
  api: { getDatabaseTraces: vi.fn(), getTraceSpans: vi.fn() },
}));

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

/** Build a strategist turn trace for rendering and request selection. */
function createTrace(traceId: string, spanId: string): Span {
  return {
    contextId: 'context', turn: 1, traceId, spanId, parentSpanId: null,
    name: 'strategist.turn.1', startTime: 1, endTime: 2, durationMs: 1,
    attributes: {}, statusCode: 0, statusMessage: null,
  };
}

/** Mount the database view with its child components stubbed. */
function mountView() {
  return mount(TelemetryDatabaseView, {
    shallow: true,
    global: { directives: { tooltip: () => {} } },
  });
}

describe('TelemetryDatabaseView turn requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDatabaseTraces).mockResolvedValue({ traces: [createTrace('older', 'old-root'), createTrace('latest', 'latest-root')] });
  });

  it('should keep the latest selected turn when requests resolve out of order', async () => {
    const older = deferred<{ spans: Span[] }>();
    const latest = deferred<{ spans: Span[] }>();
    vi.mocked(api.getTraceSpans).mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
    const wrapper = mountView();
    await flushPromises();
    const [olderTrace, latestTrace] = [createTrace('older', 'old-root'), createTrace('latest', 'latest-root')];

    const buttons = wrapper.findAllComponents(TurnViewButton);
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');
    latest.resolve({ spans: [latestTrace] });
    await flushPromises();
    older.resolve({ spans: [olderTrace] });
    await flushPromises();

    expect(wrapper.findComponent(StrategistTurnDialog).props('root')).toMatchObject({ traceId: 'latest', spanId: 'latest-root' });
    wrapper.unmount();
  });

  it('should ignore stale errors and finalizers while the latest request is pending', async () => {
    const older = deferred<{ spans: Span[] }>();
    const latest = deferred<{ spans: Span[] }>();
    vi.mocked(api.getTraceSpans).mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise);
    const wrapper = mountView();
    await flushPromises();
    const latestTrace = createTrace('latest', 'latest-root');

    const buttons = wrapper.findAllComponents(TurnViewButton);
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');
    older.reject(new Error('stale failure'));
    await flushPromises();

    expect(toastAdd).not.toHaveBeenCalled();
    expect(buttons[1]!.props('loading')).toBe(true);
    latest.resolve({ spans: [latestTrace] });
    await flushPromises();
    wrapper.unmount();
  });
});
