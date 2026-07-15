<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Toolbar from 'primevue/toolbar';
import type { SessionStatus } from '@/utils/types';

const props = defineProps<{
  session: SessionStatus;
  loading: boolean;
}>();

defineEmits<{
  viewPlayers: [];
  togglePause: [];
  stop: [];
}>();

/** Whether the active session is paused. */
const isPaused = computed(() => !!props.session.paused);

/** Whether pause or resume is available for the current session state. */
const canTogglePause = computed(() => {
  return props.session.state === 'running' || props.session.state === 'recovering';
});

/** Map the session state to a PrimeVue severity. */
const stateSeverity = computed(() => {
  switch (props.session.state) {
    case 'starting': return 'info';
    case 'running': return 'success';
    case 'recovering': return 'warning';
    case 'stopping': return 'warning';
    case 'stopped': return undefined;
    case 'error': return 'danger';
    default: return undefined;
  }
});

/** Format the time elapsed since the session started. */
const elapsedTime = computed(() => {
  if (!props.session.startTime) return '';

  const start = new Date(props.session.startTime);
  const elapsed = Math.floor((Date.now() - start.getTime()) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
});
</script>

<template>
  <div class="panel-container mb-4">
    <Toolbar>
      <template #start>
        <h3>Active Session</h3>
        <Tag class="ml-2" :severity="stateSeverity" :value="session.state.toUpperCase()" />
        <Tag v-if="isPaused" class="ml-2" severity="warning" value="PAUSED" />
      </template>
      <template #end>
        <Button
          label="View Players"
          icon="pi pi-users"
          severity="info"
          size="small"
          class="mr-2"
          :disabled="loading"
          @click="$emit('viewPlayers')"
        />
        <Button
          :label="isPaused ? 'Resume' : 'Pause'"
          :icon="isPaused ? 'pi pi-play' : 'pi pi-pause'"
          severity="secondary"
          size="small"
          class="mr-2"
          :disabled="!canTogglePause"
          :loading="loading"
          @click="$emit('togglePause')"
        />
        <Button
          label="Stop Session"
          icon="pi pi-stop"
          severity="danger"
          size="small"
          :loading="loading"
          @click="$emit('stop')"
        />
      </template>
    </Toolbar>

    <div class="data-table">
      <div v-if="session.config?.name" class="table-row">
        <div class="col-fixed-150">Configuration</div>
        <div class="col-expand">{{ session.config.name }}</div>
      </div>
      <div class="table-row">
        <div class="col-fixed-150">Session ID</div>
        <div class="col-expand">{{ session.id }}</div>
      </div>
      <div v-if="session.gameID" class="table-row">
        <div class="col-fixed-150">Game ID</div>
        <div class="col-expand">{{ session.gameID }}</div>
      </div>
      <div v-if="session.turn !== undefined" class="table-row">
        <div class="col-fixed-150">Current Turn</div>
        <div class="col-expand">{{ session.turn }}</div>
      </div>
      <div v-if="elapsedTime" class="table-row">
        <div class="col-fixed-150">Duration</div>
        <div class="col-expand">{{ elapsedTime }}</div>
      </div>
      <div class="table-row">
        <div class="col-fixed-150">Observe</div>
        <div class="col-expand">
          <i :class="session.config.autoPlay ? 'pi pi-check text-green-500' : 'pi pi-times text-red-500'"></i>
          {{ session.config.autoPlay ? 'Yes' : 'No' }}
        </div>
      </div>
      <div class="table-row">
        <div class="col-fixed-150">Game Mode</div>
        <div class="col-expand">{{ session.config.gameMode }}</div>
      </div>
      <div v-if="session.config.repetition" class="table-row">
        <div class="col-fixed-150">Repetitions</div>
        <div class="col-expand">{{ session.config.repetition }}</div>
      </div>
      <div v-if="session.error" class="table-row error">
        <div class="col-fixed-150">Error</div>
        <div class="col-expand text-wrap">{{ session.error }}</div>
      </div>
    </div>
  </div>
</template>
