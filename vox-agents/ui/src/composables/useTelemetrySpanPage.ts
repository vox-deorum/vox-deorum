import { ref } from 'vue';
import type { Span } from '@/utils/types';

type SpanLoader = () => Promise<Span[]>;
type RootSpanSelector = (spans: Span[]) => Span | null;

interface TelemetrySpanPageOptions {
  preserveExistingOnLoad?: boolean;
}

/**
 * Own shared span-page loading, errors, and root selection while leaving the
 * source-specific API and streaming behavior with each view.
 */
export function useTelemetrySpanPage(
  loadSpans: SpanLoader,
  selectRootSpan: RootSpanSelector,
  fallbackError: string,
  options: TelemetrySpanPageOptions = {}
) {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const spans = ref<Span[]>([]);
  const rootSpan = ref<Span | null>(null);
  let loadGeneration = 0;

  /** Replace all spans and select the root used by the page header and viewer. */
  function replaceSpans(nextSpans: Span[]): void {
    spans.value = nextSpans;
    rootSpan.value = selectRootSpan(nextSpans);
  }

  /** Merge streamed spans by ID, sort them chronologically, and refresh the root. */
  function mergeSpans(nextSpans: Span[]): void {
    const spansById = new Map(spans.value.map((span) => [span.spanId, span]));
    for (const span of nextSpans) spansById.set(span.spanId, span);
    replaceSpans([...spansById.values()].sort((a, b) => a.startTime - b.startTime));
  }

  /** Load spans and report whether the source-specific follow-up can proceed. */
  async function load(): Promise<boolean> {
    const generation = ++loadGeneration;
    loading.value = true;
    error.value = null;

    try {
      const loadedSpans = await loadSpans();
      if (generation !== loadGeneration) return false;
      if (options.preserveExistingOnLoad) {
        mergeSpans(loadedSpans);
      } else {
        replaceSpans(loadedSpans);
      }
      return true;
    } catch (caught) {
      if (generation !== loadGeneration) return false;
      error.value = caught instanceof Error ? caught.message : fallbackError;
      return false;
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }

  return { loading, error, spans, rootSpan, load, mergeSpans };
}
