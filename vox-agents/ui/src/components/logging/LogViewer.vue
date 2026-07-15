<template>
  <div class="flex align-items-center gap-2">
    <h1>Real-time Logs</h1>
    <Tag :severity="isConnected ? 'success' : 'warn'">
      {{ isConnected ? 'Connected' : 'Disconnected' }}
    </Tag>
    <Tag severity="info">{{ filteredLogs.length }}/{{ logs.length }} Logs</Tag>
  </div>

  <div class="panel-container">
    <Toolbar>
      <template #start>
        <SelectButton
          v-model="selectedLevel"
          :options="[
            { label: 'Debug', value: 'debug' },
            { label: 'Info', value: 'info' },
            { label: 'Warn', value: 'warn' },
            { label: 'Error', value: 'error' }
          ]"
          optionLabel="label"
          optionValue="value"
          size="small"
          class="mr-2"
        />
        <MultiSelect
          v-model="selectedSources"
          :options="sourceOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="All Sources"
          display="chip"
          size="small"
          :showToggleAll="false"
          class="source-filter"
        />
      </template>
      <template #end>
        <Button
          :icon="autoscroll ? 'pi pi-lock' : 'pi pi-lock-open'"
          @click="autoscroll = !autoscroll"
          label="Auto-scroll"
          severity="secondary"
          size="small"
          class="mr-2"
        />
        <Button
          icon="pi pi-trash"
          @click="clearLogs"
          label="Clear"
          severity="danger"
          size="small"
        />
      </template>
    </Toolbar>

    <div v-if="filteredLogs.length === 0" class="log-content table-empty">
      <i class="pi pi-inbox"></i>
      <p>No log entries to display</p>
      <p class="text-small text-muted">Logs will appear here as the application runs</p>
    </div>

    <div v-else class="log-content data-table" ref="logContainer">
      <!-- Header row -->
      <div class="table-header">
        <div class="col-fixed-100">Time</div>
        <div class="col-fixed-150">Level</div>
        <div class="col-expand">Message</div>
      </div>

      <!-- Log entries using Virtua VList -->
      <VList
        :data="filteredLogs"
        ref="virtualScroller"
        class="table-body"
        #default="{ item, index }"
      >
        <div :key="`${item.timestamp}-${index}`"
             :class="getLogRowClass(item.level)">
          <div class="col-fixed-100">{{ formatTimestamp(item.timestamp) }}</div>
          <div class="col-fixed-150">
            <span class="level-emoji">{{ getLevelEmoji(item.level) }}</span>
            <span class="level-context text-muted text-small">{{ item.context }}</span>
          </div>
          <div class="col-expand text-wrap">
            {{ item.message }}
            <div v-if="item.params" class="params-list">
              <ParamsList :params="item.params" />
            </div>
          </div>
        </div>
      </VList>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { logs, isConnected, clearLogs as clearLogsStore } from '@/stores/logs';
import { getLevelEmoji, formatTimestamp, levelHierarchy } from '@/api/log-utils';
import { VList } from 'virtua/vue';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import MultiSelect from 'primevue/multiselect';
import SelectButton from 'primevue/selectbutton';
import Toolbar from 'primevue/toolbar';
import ParamsList from './ParamsList.vue';

// State
const autoscroll = ref(true);
const selectedSources = ref<string[]>(['agents', 'webui']); // Show all sources by default
const selectedLevel = ref('info');

// Source options for the multi-select
const sourceOptions = [
  { label: 'Agents', value: 'agents' },
  { label: 'WebUI', value: 'webui' }
];
const virtualScroller = ref<InstanceType<typeof VList>>();
const logContainer = ref<HTMLElement>();

// Get appropriate row class based on log level
const getLogRowClass = (level: string) => {
  const baseClass = 'table-row';
  switch(level) {
    case 'error':
      return `${baseClass} error`;
    case 'warn':
      return `${baseClass} warning`;
    default:
      return baseClass;
  }
};


// Filtered logs based on level and source
const filteredLogs = computed(() => {
  return logs.value.filter(log => {
    // Filter by level hierarchy
    const logLevel = levelHierarchy[log.level] ?? 0;
    const minLevel = levelHierarchy[selectedLevel.value] ?? 0;
    if (logLevel < minLevel) return false;

    // Filter by source if specific sources are selected
    if (selectedSources.value.length > 0) {
      const logSource = log.source || 'agents'; // Default to 'agents' if no source
      if (!selectedSources.value.includes(logSource)) return false;
    }

    return true;
  });
});

// Watch for new logs to handle autoscroll
watch(filteredLogs, (newLogs, oldLogs) => {
  // Only autoscroll if there are new logs
  if (autoscroll.value && virtualScroller.value && newLogs.length > oldLogs?.length) {
    nextTick(() => {
      const targetIndex = newLogs.length - 1;
      if (targetIndex >= 0) {
        requestAnimationFrame(() => {
          // Virtua uses scrollToIndex method directly on the ref
          virtualScroller.value!.scrollToIndex(targetIndex);
        });
      }
    });
  }
});

// Use the store's clear function
const clearLogs = () => clearLogsStore();
</script>

<style scoped>
.logs-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.log-content {
  flex: 1;
  overflow: hidden;
}

/* Log-specific styling */
.level-emoji {
  margin-right: 0.25rem;
}

.level-context {
  margin-left: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Params container styling */
.params-list {
  color: var(--p-text-secondary-color);
  display: block;
  font-size: 0.75rem;
  margin-top: 0.25rem;
}

/* Multi-select source filter styling */
.source-filter {
  min-width: 150px;
  max-width: 250px;
}

.source-filter :deep(.p-multiselect-label) {
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
}
</style>
