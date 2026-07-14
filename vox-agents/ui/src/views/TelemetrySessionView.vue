<script setup lang="ts">
/**
 * TelemetrySessionView - View spans from a telemetry session
 * Shows session spans with support for streaming and auto-scrolling
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import AgentSelectDialog from '@/components/AgentSelectDialog.vue';
import TelemetrySpanPage from '@/components/TelemetrySpanPage.vue';
import { useTelemetrySpanPage } from '@/composables/useTelemetrySpanPage';
import { api } from '@/api/client';
import type { Span } from '../utils/types';

const route = useRoute();
const router = useRouter();

const isStreaming = ref(false);
const streamCleanup = ref<(() => void) | null>(null);

// Dialog state
const showAgentDialog = ref(false);

// Extract session ID from route
const sessionId = computed(() => route.params.sessionId as string);

const { loading, error, spans, rootSpan, load, mergeSpans } = useTelemetrySpanPage(
  async () => (await api.getSessionSpans(sessionId.value)).spans,
  (loadedSpans) => loadedSpans[loadedSpans.length - 1] ?? null,
  'Failed to load session spans',
  { preserveExistingOnLoad: true }
);

/**
 * Go back to telemetry main view
 */
function goBack() {
  router.push({ name: 'telemetry' });
}

/**
 * Load spans for the session
 */
async function loadSessionSpans() {
  if (await load()) startStreaming();
}

/**
 * Start streaming new spans via SSE
 */
function startStreaming() {
  if (streamCleanup.value) return;

  isStreaming.value = true;

  // Connect to SSE stream for this session
  streamCleanup.value = api.streamSessionSpans(
    sessionId.value,
    (allSpans: Span[]) => {
      mergeSpans(allSpans);
    },
    (_error: Event) => {
      stopStreaming();
    }
  );
}

/**
 * Stop streaming spans
 */
function stopStreaming() {
  if (streamCleanup.value) {
    streamCleanup.value();
    streamCleanup.value = null;
  }
  isStreaming.value = false;
}

/**
 * Toggle streaming mode manually
 */
function toggleStreaming() {
  if (isStreaming.value) {
    stopStreaming();
  } else {
    startStreaming();
  }
}

/**
 * Open agent selection dialog
 */
function openAgentDialog() {
  showAgentDialog.value = true;
}

onMounted(() => {
  void loadSessionSpans();
});

onUnmounted(() => {
  stopStreaming();
});
</script>

<template>
  <div class="telemetry-session-view">
    <TelemetrySpanPage
      :title="`Session ${sessionId}`"
      :loading="loading"
      loading-message="Loading session spans..."
      :error="error"
      :spans="spans"
      :root-span="rootSpan"
      empty-message="No spans found for this session"
      show-empty-state
      retain-content-while-loading
      :is-streaming="isStreaming"
      @back="goBack"
    >
      <template #status>
        <Tag v-if="isStreaming" severity="info" class="streaming-tag">
          <i class="pi pi-spin pi-spinner mr-1"></i>
          Streaming
        </Tag>
      </template>
      <template #controls>
        <Button
          icon="pi pi-comment"
          @click="openAgentDialog"
          label="Chat"
          severity="primary"
          size="small"
          class="mr-1"
        />
        <Button
          :icon="isStreaming ? 'pi pi-pause' : 'pi pi-play'"
          @click="toggleStreaming"
          :label="isStreaming ? 'Pause' : 'Resume'"
          severity="secondary"
          size="small"
          class="mr-1"
        />
        <Button
          icon="pi pi-refresh"
          @click="loadSessionSpans"
          label="Refresh"
          severity="secondary"
          size="small"
          :loading="loading"
        />
      </template>
    </TelemetrySpanPage>

    <!-- Agent Selection Dialog -->
    <AgentSelectDialog
      v-model:visible="showAgentDialog"
      :contextId="sessionId"
    />
  </div>
</template>

<style scoped>
.streaming-tag {
  animation: pulse 2s infinite;
}
</style>
