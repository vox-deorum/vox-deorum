<template>
  <div class="log-pane">
    <div class="log-toolbar">
      <SelectButton
        v-model="selectedLevel"
        :options="levelOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        size="small"
      />
      <MultiSelect
        v-model="selectedSources"
        :options="sourceOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="All sources"
        display="chip"
        size="small"
        :showToggleAll="false"
        class="source-filter"
      />
      <span class="toolbar-spacer"></span>
      <span class="stream-state" :class="{ offline: !isConnected }">
        <i class="pi pi-circle-fill"></i>
        {{ isConnected ? 'Streaming' : 'Disconnected' }}
      </span>
      <Button
        :icon="autoscroll ? 'pi pi-lock' : 'pi pi-lock-open'"
        @click="autoscroll = !autoscroll"
        v-tooltip.bottom="autoscroll ? 'Following new entries' : 'Follow new entries'"
        :severity="autoscroll ? 'primary' : 'secondary'"
        text
        size="small"
      />
      <Button
        icon="pi pi-trash"
        @click="clearLogs"
        v-tooltip.bottom="'Clear'"
        severity="secondary"
        text
        size="small"
      />
    </div>

    <LogTable
      ref="table"
      :entries="filteredLogs"
      emptyHint="New entries appear here as VD runs."
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import { logs, isConnected, clearLogs } from '@/stores/logs';
import { filterLogs, levelOptions } from '@/presentation/log-utils';
import type { LogEntry } from '@/utils/types';
import Button from 'primevue/button';
import MultiSelect from 'primevue/multiselect';
import SelectButton from 'primevue/selectbutton';
import LogTable from './LogTable.vue';

// State
const autoscroll = ref(true);
const selectedSources = ref<string[]>(['agents', 'webui']); // Show all sources by default
const selectedLevel = ref<LogEntry['level']>('info');
const table = ref<InstanceType<typeof LogTable>>();

// Source options for the multi-select
const sourceOptions = [
  { label: 'Agents', value: 'agents' },
  { label: 'WebUI', value: 'webui' }
];

// Filtered logs based on level and source
const filteredLogs = computed(() => {
  return filterLogs(logs.value, selectedLevel.value, selectedSources.value);
});

// Follow the newest entry while auto-scroll is on
watch(filteredLogs, (newLogs, oldLogs) => {
  if (autoscroll.value && newLogs.length > (oldLogs?.length ?? 0)) {
    nextTick(() => requestAnimationFrame(() => table.value?.scrollToIndex(newLogs.length - 1)));
  }
});
</script>

<style scoped>
.source-filter {
  min-width: 150px;
  max-width: 250px;
}

.stream-state {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.8125rem;
  color: var(--p-text-secondary-color);
}

.stream-state .pi {
  font-size: 0.5rem;
  color: var(--p-green-500);
}

.stream-state.offline .pi {
  color: var(--p-orange-500);
}
</style>
