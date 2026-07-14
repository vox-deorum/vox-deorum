<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Tag from 'primevue/tag';
import Toolbar from 'primevue/toolbar';
import type { SessionConfig, StrategistSessionConfig } from '@/utils/types';

defineProps<{
  configs: readonly SessionConfig[];
  loading: boolean;
  error: string | null;
  sessionActive: boolean;
  startingSession: boolean;
}>();

defineEmits<{
  create: [];
  start: [config: SessionConfig];
  edit: [config: SessionConfig];
  duplicate: [config: SessionConfig];
  delete: [config: SessionConfig];
}>();

/** Calculate the total player count using the backend's even-seat rule. */
function getPlayerCount(config: SessionConfig): number {
  const strategistConfig = config as StrategistSessionConfig;
  if (!strategistConfig.llmPlayers || Object.keys(strategistConfig.llmPlayers).length === 0) return 0;

  const playerIds = Object.keys(strategistConfig.llmPlayers).map(Number);
  const rawCount = Math.max(...playerIds) + 1;
  return Math.ceil(rawCount / 2) * 2;
}

/** Count the players controlled by an LLM strategist. */
function getLlmPlayerCount(config: SessionConfig): number {
  const strategistConfig = config as StrategistSessionConfig;
  if (!strategistConfig.llmPlayers) return 0;
  return Object.values(strategistConfig.llmPlayers)
    .filter(player => player.strategist !== 'none-strategist').length;
}

/** Estimate the map size from the configured player count. */
function getMapSize(config: SessionConfig): string {
  const playerCount = getPlayerCount(config);
  if (playerCount <= 2) return 'Duel';
  if (playerCount <= 4) return 'Tiny';
  if (playerCount <= 6) return 'Small';
  if (playerCount <= 8) return 'Standard';
  if (playerCount <= 10) return 'Large';
  return 'Huge';
}
</script>

<template>
  <div class="panel-container">
    <Toolbar>
      <template #start>
        <h3>Configurations</h3>
      </template>
      <template #end>
        <Button
          icon="pi pi-plus"
          label="New Config"
          severity="success"
          size="small"
          @click="$emit('create')"
        />
      </template>
    </Toolbar>

    <div v-if="loading" class="table-loading">
      <ProgressSpinner />
      <span class="ml-2">Loading configurations...</span>
    </div>

    <div v-else-if="error" class="p-3">
      <Message severity="error" :closable="false">
        {{ error }}
      </Message>
    </div>

    <div v-else-if="configs.length === 0" class="table-empty">
      <i class="pi pi-inbox"></i>
      <p>No configurations found</p>
      <Button
        label="Create First Config"
        icon="pi pi-plus"
        @click="$emit('create')"
      />
    </div>

    <div v-else class="data-table">
      <div class="table-header">
        <div class="col-expand">Name</div>
        <div class="col-fixed-100">Type</div>
        <div class="col-fixed-100">Players</div>
        <div class="col-fixed-100">Map</div>
        <div class="col-fixed-80">Observe</div>
        <div class="col-fixed-250">Actions</div>
      </div>

      <div class="table-body">
        <div v-for="config in configs" :key="config.name" class="table-row">
          <div class="col-expand text-truncate">{{ config.name }}</div>
          <div class="col-fixed-100">
            <Tag value="Strategist" severity="info" />
          </div>
          <div class="col-fixed-100">
            {{ getLlmPlayerCount(config) }} / {{ getPlayerCount(config) }}
          </div>
          <div class="col-fixed-100">
            {{ getMapSize(config) }}
          </div>
          <div class="col-fixed-80">
            <i :class="config.autoPlay ? 'pi pi-check text-green-500' : 'pi pi-times text-red-500'"></i>
          </div>
          <div class="col-fixed-250">
            <div class="flex gap-2">
              <Button
                icon="pi pi-play"
                severity="success"
                size="small"
                rounded
                v-tooltip="'Start Session'"
                :disabled="sessionActive || startingSession"
                :loading="startingSession"
                @click="$emit('start', config)"
              />
              <Button
                icon="pi pi-pencil"
                severity="info"
                size="small"
                rounded
                v-tooltip="'Edit Config'"
                @click="$emit('edit', config)"
              />
              <Button
                icon="pi pi-copy"
                severity="secondary"
                size="small"
                rounded
                v-tooltip="'Duplicate Config'"
                @click="$emit('duplicate', config)"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                size="small"
                rounded
                v-tooltip="'Delete Config'"
                @click="$emit('delete', config)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
