<script setup lang="ts">
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import type { VoxAgentsConfig } from '@/utils/types';

type PathField = 'configsDir' | 'episodeDbPath';

const props = defineProps<{ config: VoxAgentsConfig }>();
const emit = defineEmits<{ 'update:config': [value: VoxAgentsConfig] }>();

/** Update one path without mutating the route-owned configuration. */
function updatePath(field: PathField, value: string): void {
  emit('update:config', { ...props.config, [field]: value });
}
</script>

<template>
  <Card class="config-card">
    <template #title><i class="pi pi-folder" /> Path Settings</template>
    <template #subtitle>File and directory paths used by the application</template>
    <template #content>
      <div class="field-row">
        <label for="configsDir">Game Configs
          <span class="help-icon" v-tooltip.top="'Directory containing session configuration files'"><i class="pi pi-question-circle" /></span>
        </label>
        <InputText id="configsDir" :modelValue="config.configsDir" placeholder="configs" class="field-input"
          @update:modelValue="updatePath('configsDir', $event ?? '')" />
      </div>
      <div class="field-row">
        <label for="episodeDbPath">Episode Database
          <span class="help-icon" v-tooltip.top="'Path to the DuckDB database for archived game episodes'"><i class="pi pi-question-circle" /></span>
        </label>
        <InputText id="episodeDbPath" :modelValue="config.episodeDbPath" placeholder="episodes.duckdb" class="field-input"
          @update:modelValue="updatePath('episodeDbPath', $event ?? '')" />
      </div>
    </template>
  </Card>
</template>

<style scoped>
.field-row label { min-width: 170px; }
.help-icon { color: var(--p-text-muted-color); font-size: 0.875rem; margin-left: 0.25rem; vertical-align: middle; }
</style>
