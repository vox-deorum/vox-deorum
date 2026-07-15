<script setup lang="ts">
/**
 * TelemetryTraceView - View all spans for a specific trace with hierarchy
 * Shows detailed span information with parent-child relationships
 */

import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import AgentSelectDialog from '@/components/chat/launch/AgentSelectDialog.vue';
import TelemetrySpanPage from '@/components/telemetry/TelemetrySpanPage.vue';
import { useTelemetrySpanPage } from '@/composables/useTelemetrySpanPage';
import { api } from '@/api/client';

const route = useRoute();
const router = useRouter();

// Dialog state
const showAgentDialog = ref(false);

// Extract parameters from route
const filename = computed(() => {
  return Array.isArray(route.params.filename)
    ? route.params.filename.join('/')
    : route.params.filename!;
});

const traceId = computed(() => route.params.traceId as string);

const { loading, error, spans, rootSpan, load } = useTelemetrySpanPage(
  async () => (await api.getTraceSpans(filename.value, traceId.value)).spans,
  (loadedSpans) => loadedSpans.find((span) => !span.parentSpanId) ?? loadedSpans[0] ?? null,
  'Failed to load trace spans'
);

/**
 * Go back to database view
 */
function goBack() {
  router.push({
    name: 'telemetry-database',
    params: { filename: route.params.filename }
  });
}

/**
 * Load spans for the trace
 */
async function loadTraceSpans() {
  await load();
}

/**
 * Open agent dialog
 */
function openAgentDialog() {
  showAgentDialog.value = true;
}

onMounted(() => {
  void loadTraceSpans();
});
</script>

<template>
  <div class="telemetry-trace-view">
    <TelemetrySpanPage
      :title="rootSpan?.name || 'Trace View'"
      :loading="loading"
      loading-message="Loading trace spans..."
      :error="error"
      :spans="spans"
      :root-span="rootSpan"
      @back="goBack"
    >
      <template #controls>
        <Button
          icon="pi pi-comment"
          @click="openAgentDialog"
          label="Chat with Telepathist"
          severity="primary"
          size="small"
        />
      </template>
    </TelemetrySpanPage>

    <!-- Agent Selection Dialog -->
    <AgentSelectDialog
      v-model:visible="showAgentDialog"
      :databasePath="`telemetry/${filename}`"
      :turn="rootSpan?.attributes?.turn || rootSpan?.turn"
      :span="rootSpan || undefined"
    />
  </div>
</template>
