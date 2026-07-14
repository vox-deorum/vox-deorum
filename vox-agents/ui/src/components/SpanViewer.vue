<template>
  <div class="panel-container">
    <Toolbar>
      <template #start>
        <Tag
          :value="`Turn ${rootSpan.turn}`"
          class="mr-2" />
        <Tag
          :value="getStatusText(rootSpan.statusCode)"
          :severity="getStatusSeverity(rootSpan.statusCode)"
          class="mr-2"
        />
        <Tag :value="`${spans.length} spans`" class="mr-2" />
      </template>
      <template #end>
        <Button
          :icon="autoscroll ? 'pi pi-lock' : 'pi pi-lock-open'"
          @click="autoscroll = !autoscroll"
          label="Auto-scroll"
          severity="secondary"
          size="small"
          class="mr-1"
          v-if="isStreaming"
        />
        <Button
          icon="pi pi-plus"
          label="Expand All"
          text
          size="small"
          @click="toggleAllSpans(true)"
          class="mr-1"
        />
        <Button
          icon="pi pi-minus"
          label="Collapse All"
          text
          size="small"
          @click="toggleAllSpans(false)"
        />
      </template>
    </Toolbar>

    <div class="spans-content">
      <div v-if="flattenedSpans.length === 0" class="table-empty">
        <i class="pi pi-inbox"></i>
        <p>No spans to display</p>
        <p class="text-small text-muted">Spans will appear here as they are collected</p>
      </div>

      <div v-else class="data-table span-container" ref="spanContainer">
        <!-- Header row -->
        <div class="table-header">
          <div class="col-expand">Name</div>
          <div class="col-fixed-80">Status</div>
          <div class="col-fixed-80">Start Time</div>
          <div class="col-fixed-100">Duration</div>
          <div class="col-fixed-80">Input</div>
          <div class="col-fixed-80">Reasoning</div>
          <div class="col-fixed-80">Output</div>
          <div class="col-fixed-80">Actions</div>
        </div>

        <!-- Span entries using Virtua VList -->
        <VList
          :data="flattenedSpans"
          :style="{ minHeight: scrollerHeight }"
          ref="virtualScroller"
          class="table-body"
          #default="{ item: span, index }"
        >
          <div
            :key="`${span.spanId}-${index}`"
            class="table-row clickable"
            @click="showDetails(span)"
          >
            <div class="col-expand" :style="{ paddingLeft: `${span.depth * 24 + 8}px` }">
              <Button
                v-if="span.children && span.children.length > 0"
                :icon="expandedSpans.has(span.spanId) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                text
                rounded
                size="small"
                style="width: 20px; height: 20px; margin-right: 4px;"
                @click.stop="toggleSpan(span)"
              />
              <span v-else style="display: inline-block; width: 24px;"></span>
              {{ span.name }}
            </div>
            <div class="col-fixed-80">
              <Tag
                :value="getStatusText(span.statusCode)"
                :severity="getStatusSeverity(span.statusCode)"
              />
            </div>
            <div class="col-fixed-80">
              {{ formatTimestamp(span.startTime) }}
            </div>
            <div class="col-fixed-100">
              {{ formatDuration(span.durationMs) }}
            </div>
            <div class="col-fixed-80">
              {{ formatTokenCount(span.attributes?.['tokens.input']) }}
            </div>
            <div class="col-fixed-80">
              {{ formatTokenCount(span.attributes?.['tokens.reasoning']) }}
            </div>
            <div class="col-fixed-80">
              {{ formatTokenCount(span.attributes?.['tokens.output']) }}
            </div>
            <div class="col-fixed-80">
              <Button
                icon="pi pi-info-circle"
                text
                rounded
                size="small"
                @click.stop="showDetails(span)"
              />
            </div>
          </div>
        </VList>
      </div>
    </div>
  </div>

  <!-- Span Details Dialog -->
  <DetailDialog
    v-model:visible="showSpanDetails"
    :header="selectedSpan?.name ?? ''"
    :entries="spanDetailEntries"
  />
</template>

<script setup lang="ts">
/**
 * SpanViewer - Component for viewing trace spans in a hierarchical tree structure
 * Similar to LogViewer, displays spans with virtualization, filtering, and streaming support
 */

import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { VList } from 'virtua/vue';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Toolbar from 'primevue/toolbar';
import DetailDialog, { type DetailEntry } from './DetailDialog.vue';
import type { Span } from '../utils/types';
import {
  formatDuration,
  formatTimestamp,
  formatTokenCount,
  getStatusSeverity,
  getStatusText,
  buildSpanTree,
  flattenSpanTree,
  type SpanNode
} from '../api/telemetry-utils';

// Props
const props = defineProps<{
  spans: Span[];
  rootSpan: Span;
  isStreaming?: boolean;
}>();

// State
const selectedSpan = ref<Span | null>(null);
const showSpanDetails = ref(false);
const expandedSpans = ref<Set<string>>(new Set());

// Build detail entries for the selected span
const spanDetailEntries = computed<DetailEntry[]>(() => {
  if (!selectedSpan.value) return [];
  const span = selectedSpan.value;
  const entries: DetailEntry[] = [
    { label: 'Span ID', value: `${span.spanId}  [${getStatusText(span.statusCode)}]` },
    { label: 'Time', value: `${formatTimestamp(span.startTime)} ~ ${formatTimestamp(span.endTime)}` },
    { label: 'Duration', value: formatDuration(span.durationMs) },
  ];
  if (span.statusMessage) {
    entries.push({ label: 'Status Message', value: span.statusMessage });
  }
  // Attributes section with divider on first entry
  if (span.attributes && typeof span.attributes === 'object') {
    let first = true;
    for (const [key, value] of Object.entries(span.attributes)) {
      entries.push({ label: key, value, dividerBefore: first });
      first = false;
    }
  }
  return entries;
});
const virtualScroller = ref<any>();
const spanContainer = ref<HTMLElement>();
const scrollerHeight = ref('600px');
const autoscroll = ref(true); // Local autoscroll state, default to true

// Parse attributes for all spans upfront
const parsedSpans = computed(() => {
  return props.spans.map(span => {
    if (typeof span.attributes === 'string') {
      try {
        span.attributes = JSON.parse(span.attributes);
      } catch {
        // Keep as string if parsing fails
      }
    }
    return span;
  });
});

// Build span tree using utility
const spanTree = computed(() => buildSpanTree(parsedSpans.value));

// Flatten the tree for display using utility
const flattenedSpans = computed(() => flattenSpanTree(spanTree.value, expandedSpans.value));

// Watch for new spans to handle autoscroll when streaming
watch(() => props.spans, (newSpans, oldSpans) => {
  // Auto-expand all when streaming
  if (props.isStreaming && newSpans.length > (oldSpans?.length ?? 0)) {
    toggleAllSpans(true);
  }

  // Only autoscroll if streaming and enabled
  if (props.isStreaming && autoscroll.value && virtualScroller.value && newSpans.length > (oldSpans?.length ?? 0)) {
    nextTick(() => {
      const targetIndex = flattenedSpans.value.length - 1;
      if (targetIndex >= 0) {
        requestAnimationFrame(() => {
          virtualScroller.value.scrollToIndex(targetIndex, { align: 'end' });
        });
      }
    });
  }
});

// Watch for initial load and when autoscroll is enabled
watch([autoscroll, () => flattenedSpans.value], ([autoScroll, spans]) => {
  if (autoScroll && spans.length > 0 && virtualScroller.value) {
    nextTick(() => {
      const targetIndex = spans.length - 1;
      requestAnimationFrame(() => {
        virtualScroller.value.scrollToIndex(targetIndex, { align: 'end' });
      });
    });
  }
}, { immediate: true });

// Calculate adaptive scroll height
const calculateScrollerHeight = () => {
  // Get viewport height and subtract approximate space for header, controls, padding
  const viewportHeight = window.innerHeight;
  const headerAndControlsHeight = 250; // More space needed due to page header
  const calculatedHeight = Math.max(400, viewportHeight - headerAndControlsHeight);
  scrollerHeight.value = `${calculatedHeight}px`;
};

// Debounce timer
let resizeTimer: ReturnType<typeof setTimeout> | null = null;

// Update dimensions on window resize with debounce
const handleResize = () => {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    calculateScrollerHeight();
  }, 150);
};

/**
 * Toggle span expansion
 */
function toggleSpan(span: SpanNode) {
  if (expandedSpans.value.has(span.spanId)) {
    expandedSpans.value.delete(span.spanId);
  } else {
    expandedSpans.value.add(span.spanId);
  }
}

/**
 * Show span details dialog
 */
function showDetails(span: Span) {
  // Pre-process all string attributes to parse JSON where possible
  if (span.attributes && typeof span.attributes === 'object') {
    const processed: Record<string, any> = {};
    for (const [key, value] of Object.entries(span.attributes)) {
      if (typeof value === 'string') {
        const parsed = tryParseJSON(value);
        processed[key] = parsed !== null ? parsed : value;
      } else {
        processed[key] = value;
      }
    }
    selectedSpan.value = { ...span, attributes: processed };
  } else {
    selectedSpan.value = span;
  }
  showSpanDetails.value = true;
}

/**
 * Expand or collapse all spans recursively
 */
function toggleAllSpans(expand: boolean) {
  if (expand) {
    // Recursively add all parent spans to expanded set
    const addAllParents = (nodes: SpanNode[]) => {
      nodes.forEach(node => {
        if (node.children && node.children.length > 0) {
          expandedSpans.value.add(node.spanId);
          addAllParents(node.children);
        }
      });
    };
    addAllParents(spanTree.value);
  } else {
    expandedSpans.value.clear();
  }
}

/**
 * Try to parse a string as JSON
 * Returns the parsed object if successful, null otherwise
 */
function tryParseJSON(str: string): any {
  try {
    const parsed = JSON.parse(str);
    // Only return parsed if it's an object or array (not primitive)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

onMounted(() => {
  calculateScrollerHeight();
  // Auto-expand all spans by default
  toggleAllSpans(true);

  // Initial scroll to end if autoscroll is enabled
  if (autoscroll.value && flattenedSpans.value.length > 0) {
    nextTick(() => {
      if (virtualScroller.value) {
        const targetIndex = flattenedSpans.value.length - 1;
        requestAnimationFrame(() => {
          virtualScroller.value.scrollToIndex(targetIndex, { align: 'end' });
        });
      }
    });
  }

  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped>
.spans-content {
  flex: 1;
  overflow: hidden;
}

.autoscroll-indicator {
  display: inline-flex;
  align-items: center;
  color: var(--p-primary-500);
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
  background: var(--p-primary-50);
  border-radius: var(--p-border-radius);
  animation: pulse 2s infinite;
}
</style>
