<script setup lang="ts">
/**
 * TelemetryDatabaseView - Display traces from a telemetry database file
 * Shows a list of root spans (traces) with search and navigation capabilities
 */

import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Tag from 'primevue/tag';
import Paginator from 'primevue/paginator';
import ProgressSpinner from 'primevue/progressspinner';
import Toolbar from 'primevue/toolbar';
import AgentSelectDialog from '@/components/chat/launch/AgentSelectDialog.vue';
import StrategistTurnDialog from '@/components/telemetry/strategist/StrategistTurnDialog.vue';
import TurnViewButton from '@/components/telemetry/strategist/TurnViewButton.vue';
import { isStrategistTurnSpan } from '@/api/strategist-turn';
import { api } from '@/api/client';
import type { Span } from '../utils/types';
import {
  formatDuration,
  formatTimestamp,
  formatTokenCount,
  getStatusSeverity,
  getStatusText,
  parseSpanAttributes
} from '@/api/telemetry-utils';

const route = useRoute();
const router = useRouter();
const toast = useToast();

// State
const loading = ref(false);
const error = ref<string | null>(null);
const traces = ref<Span[]>([]);
const searchQuery = ref('');
const first = ref(0); // PrimeVue Paginator uses 'first' for the first row index
const rows = ref(20); // Number of rows per page

// Dialog state
const showAgentDialog = ref(false);
const selectedTrace = ref<Span | null>(null);

// Strategist turn view state
const turnRoot = ref<Span | null>(null);
const turnSpans = ref<Span[]>([]);
const showTurnDialog = ref(false);
const loadingTurnId = ref<string | null>(null);
let turnRequestGeneration = 0;

// Extract filename from route params
const filename = computed(() => {
  // The filename param can include folder path (e.g., "uploaded/game123.db")
  return Array.isArray(route.params.filename)
    ? route.params.filename.join('/')
    : route.params.filename!;
});

/**
 * Frontend search filtering
 */
const filteredTraces = computed(() => {
  if (!searchQuery.value.trim()) {
    return traces.value;
  }

  const query = searchQuery.value.toLowerCase();
  return traces.value.filter(trace => {
    // Search in name
    if (trace.name.toLowerCase().includes(query)) return true;

    return JSON.stringify(trace.attributes).toLowerCase().includes(query);
  });
});

/**
 * Paginated traces for display
 */
const paginatedTraces = computed(() => {
  const end = first.value + rows.value;
  return filteredTraces.value.slice(first.value, end);
});

/**
 * Navigate to trace detail view
 */
function viewTrace(trace: Span) {
  router.push({
    name: 'telemetry-trace',
    params: {
      filename: route.params.filename,
      traceId: trace.traceId
    }
  });
}

/**
 * Go back to telemetry main view
 */
function goBack() {
  router.push({ name: 'telemetry' });
}

/**
 * Load traces from the database
 */
async function loadTraces() {
  loading.value = true;
  error.value = null;

  try {
    // Load all traces (root spans) from the database
    // Using a high limit to get all traces for frontend filtering
    const response = await api.getDatabaseTraces(filename.value, 1000, 0);

    traces.value = response.traces.map(parseSpanAttributes);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load traces';
    console.error('Error loading traces:', err);
  } finally {
    loading.value = false;
  }
}

/**
 * Open agent dialog for a specific trace
 */
function openAgentDialog(trace: Span) {
  selectedTrace.value = trace;
  showAgentDialog.value = true;
}

/**
 * Load a strategist turn trace's spans and open its turn view
 */
async function openTurnView(trace: Span) {
  const requestGeneration = ++turnRequestGeneration;
  loadingTurnId.value = trace.traceId;
  try {
    const response = await api.getTraceSpans(filename.value, trace.traceId);
    if (requestGeneration !== turnRequestGeneration) return;
    turnSpans.value = response.spans.map(parseSpanAttributes);
    turnRoot.value = turnSpans.value.find(s => s.spanId === trace.spanId) ?? trace;
    showTurnDialog.value = true;
  } catch (err) {
    if (requestGeneration !== turnRequestGeneration) return;
    toast.add({ severity: 'error', summary: 'Could not load turn', detail: err instanceof Error ? err.message : String(err), life: 5000 });
  } finally {
    if (requestGeneration === turnRequestGeneration) loadingTurnId.value = null;
  }
}

// Reset pagination when search changes
watch(searchQuery, () => {
  first.value = 0;
});

onMounted(() => {
  loadTraces();
});
</script>

<template>
  <div class="telemetry-database-view">
    <!-- Header with navigation -->
    <div class="page-header">
      <div class="page-header-left">
        <Button
          icon="pi pi-arrow-left"
          text
          rounded
          @click="goBack"
        />
        <h1>{{ filename }}</h1>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <ProgressSpinner />
      <p>Loading traces...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <i class="pi pi-exclamation-triangle"></i>
      <p>{{ error }}</p>
      <Button label="Retry" @click="loadTraces" />
    </div>

    <!-- Traces List -->
    <div v-else class="panel-container">
      <Toolbar>
        <template #start>
          <Tag :value="`${filteredTraces.length} traces`" />
        </template>
        <template #end>
          <span class="p-input-icon-left search-box">
            <i class="pi pi-search" />
            <InputText
              v-model="searchQuery"
              placeholder="Search traces..."
              class="search-input"
            />
          </span>
        </template>
      </Toolbar>

      <div class="traces-content">
        <!-- Empty State -->
        <div v-if="traces.length === 0" class="empty-state">
          <i class="pi pi-inbox"></i>
          <p>No traces found in this database</p>
        </div>

        <!-- No Search Results -->
        <div v-else-if="filteredTraces.length === 0" class="empty-state">
          <i class="pi pi-search"></i>
          <p>No traces match your search</p>
          <Button
            label="Clear Search"
            text
            @click="searchQuery = ''"
          />
        </div>

        <!-- Traces Table -->
        <div v-else class="data-table">
          <!-- Table Header -->
          <div class="table-header">
            <div class="col-expand">Name</div>
            <div class="col-fixed-80">Turn</div>
            <div class="col-fixed-80">Status</div>
            <div class="col-fixed-80">Timestamp</div>
            <div class="col-fixed-100">Duration</div>
            <div class="col-fixed-80">Input</div>
            <div class="col-fixed-80">Reasoning</div>
            <div class="col-fixed-80">Output</div>
            <div class="col-fixed-100">Actions</div>
          </div>

          <!-- Table Body -->
          <div class="table-body">
            <div
              v-for="trace in paginatedTraces"
              :key="trace.spanId"
              class="table-row clickable"
              @click="viewTrace(trace)"
            >
              <div class="col-expand">
                {{ trace.name }}
              </div>
              <div class="col-fixed-80">
                {{ trace.turn }}
              </div>
              <div class="col-fixed-80">
                <Tag
                  :value="getStatusText(trace.statusCode)"
                  :severity="getStatusSeverity(trace.statusCode)"
                />
              </div>
              <div class="col-fixed-80">
                {{ formatTimestamp(trace.startTime) }}
              </div>
              <div class="col-fixed-100">
                {{ formatDuration(trace.durationMs) }}
              </div>
              <div class="col-fixed-80">
                {{ formatTokenCount(trace.attributes['tokens.input']) }}
              </div>
              <div class="col-fixed-80">
                {{ formatTokenCount(trace.attributes['tokens.reasoning']) }}
              </div>
              <div class="col-fixed-80">
                {{ formatTokenCount(trace.attributes['tokens.output']) }}
              </div>
              <div class="col-fixed-100">
                <TurnViewButton
                  v-if="isStrategistTurnSpan(trace)"
                  :loading="loadingTurnId === trace.traceId"
                  @click.stop="openTurnView(trace)"
                />
                <Button
                  icon="pi pi-chart-line"
                  text
                  rounded
                  size="small"
                  @click.stop="viewTrace(trace)"
                  v-tooltip="'View Details'"
                />
                <Button
                  icon="pi pi-comment"
                  text
                  rounded
                  size="small"
                  @click.stop="openAgentDialog(trace)"
                  v-tooltip="'Chat with Telepathist'"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination -->
        <Paginator
          v-if="filteredTraces.length > rows"
          v-model:first="first"
          v-model:rows="rows"
          :totalRecords="filteredTraces.length"
          :rowsPerPageOptions="[10, 20, 50]"
          class="traces-paginator"
        />
      </div>
    </div>

    <!-- Strategist turn view -->
    <StrategistTurnDialog
      v-if="turnRoot"
      v-model:visible="showTurnDialog"
      :root="turnRoot"
      :spans="turnSpans"
    />

    <!-- Agent Selection Dialog -->
    <AgentSelectDialog
      v-model:visible="showAgentDialog"
      :databasePath="`telemetry/${filename}`"
      :span="selectedTrace || undefined"
    />
  </div>
</template>

<style scoped>
.traces-content {
  flex: 1;
  overflow: hidden;
}

.search-box {
  width: 300px;
}

.search-input {
  width: 100%;
}

.traces-paginator {
  border-top: 1px solid var(--p-surface-border);
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .search-box {
    width: 200px;
  }
}
</style>
