<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import LogViewer from '@/components/logging/LogViewer.vue';
import LogFileViewer from '@/components/logging/LogFileViewer.vue';
import { api } from '@/api/client';
import type { DebugLogSource, DebugStatusResponse } from '@/utils/types';
import { errorMessage } from '@/utils/errors';

/** File-backed tabs, in display order. */
const fileSources: { id: DebugLogSource; label: string; preferredFile?: string; emptyHint?: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'bridge', label: 'Bridge' },
  { id: 'mcp', label: 'MCP' },
  { id: 'civ5', label: 'Civ 5', preferredFile: 'Lua.log', emptyHint: 'Turn on Civ 5 logging above, then restart the game.' }
];

const toast = useToast();
const activeTab = ref<string>('live');
const status = ref<DebugStatusResponse>();
const civLogging = ref(false);
const savingLogging = ref(false);
/** Logging state Civ 5 is running with, as far as this page knows. */
const loggingAtLoad = ref<boolean>();

/** Civ 5 reads config.ini only at startup, so any change needs a restart. */
const restartNeeded = computed(() => loggingAtLoad.value !== undefined && civLogging.value !== loggingAtLoad.value);

/** Counts logging saves so a status response requested before or during a save cannot undo the switch. */
let loggingSaves = 0;

/** Fetch log listings and the current logging switch. */
async function loadStatus() {
  const savesAtRequest = loggingSaves;
  const savingAtRequest = savingLogging.value;
  try {
    status.value = await api.getDebugStatus();
    if (!savingAtRequest && savesAtRequest === loggingSaves) civLogging.value = status.value.civLogging;
    loggingAtLoad.value ??= status.value.civLogging;
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Could not load logs', detail: errorMessage(error), life: 5000 });
  }
}

/** Save the Civ 5 logging switch, reverting it if the write fails. */
async function setCivLogging(enabled: boolean) {
  loggingSaves++;
  savingLogging.value = true;
  try {
    civLogging.value = (await api.setCivLogging(enabled)).civLogging;
  } catch (error) {
    civLogging.value = !enabled;
    toast.add({ severity: 'error', summary: 'Could not change Civ 5 logging', detail: errorMessage(error), life: 5000 });
  } finally {
    savingLogging.value = false;
  }
}

onMounted(loadStatus);
</script>

<template>
  <div class="debug-view">
    <div class="page-header">
      <div class="page-header-left">
        <h1>Debug</h1>
      </div>
      <div class="page-header-controls">
        <Transition name="fade">
          <span v-if="restartNeeded" class="restart-hint">
            <i class="pi pi-replay"></i>
            Restart Civ 5 to apply
          </span>
        </Transition>
        <label for="civ-logging" class="switch-label">Civ 5 logging</label>
        <ToggleSwitch
          v-model="civLogging"
          inputId="civ-logging"
          :disabled="!status || savingLogging"
          @update:modelValue="setCivLogging"
        />
      </div>
    </div>

    <Tabs v-model:value="activeTab" lazy class="logs-card panel-container">
      <div class="tab-bar">
        <TabList class="tab-list">
          <Tab value="live">Live</Tab>
          <Tab v-for="source in fileSources" :key="source.id" :value="source.id">{{ source.label }}</Tab>
        </TabList>
        <Button
          as="a"
          :href="api.debugBundleUrl"
          download
          icon="pi pi-download"
          label="Download all"
          size="small"
          severity="secondary"
          outlined
          v-tooltip.bottom="'Latest logs plus a setup summary, as one zip for bug reports'"
        />
      </div>
      <TabPanels class="tab-panels">
        <TabPanel value="live" class="tab-panel">
          <LogViewer />
        </TabPanel>
        <TabPanel v-for="source in fileSources" :key="source.id" :value="source.id" class="tab-panel">
          <LogFileViewer
            :source="source.id"
            :files="status?.sources[source.id] ?? []"
            :preferredFile="source.preferredFile"
            :emptyHint="source.emptyHint"
            @refresh="loadStatus"
          />
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>

<style scoped>
.debug-view {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 3rem);
}

.switch-label {
  font-size: 0.9375rem;
  cursor: pointer;
}

.restart-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin-right: 0.75rem;
  font-size: 0.875rem;
  color: var(--p-orange-500);
}

.logs-card {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.tab-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-right: 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.tab-list {
  flex: 1;
  min-width: 0;
}

.tab-list :deep(.p-tablist-tab-list) {
  border: none;
  background: transparent;
}

.tab-panels {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  background: transparent;
}

.tab-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
