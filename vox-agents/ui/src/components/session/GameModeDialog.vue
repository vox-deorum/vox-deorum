<script setup lang="ts">
/**
 * Game mode selection dialog for choosing how to start a session
 */

import Dialog from 'primevue/dialog';
import Button from 'primevue/button';

export type GameMode = 'start' | 'load' | 'wait';

interface Props {
  visible: boolean;
  loading?: boolean;
}

interface Emits {
  (e: 'update:visible', value: boolean): void;
  (e: 'select', mode: GameMode): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

function selectMode(mode: GameMode) {
  emit('select', mode);
  emit('update:visible', false);
}

function closeDialog() {
  if (!props.loading) {
    emit('update:visible', false);
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    header="Select Game Mode"
    :modal="true"
    :style="{ width: '45vw', minWidth: '560px' }"
    :closable="!loading"
    :dismissableMask="!loading"
    @update:visible="closeDialog"
  >
    <div class="mode-selection">
      <p class="mb-4">Choose how to start your session:</p>

      <div class="mode-options">
        <Button
          label="Start New Game"
          icon="pi pi-plus"
          severity="primary"
          class="mode-button"
          @click="selectMode('start')"
          :disabled="loading"
        >
          <template #default>
            <i class="pi pi-plus mr-2"></i>
            <div class="text-left">
              <div class="font-bold">Start New Game</div>
              <div class="text-sm">Start Civilization V with Vox Deorum and start a fresh game</div>
            </div>
          </template>
        </Button>

        <Button
          label="Load Game"
          icon="pi pi-folder-open"
          severity="secondary"
          class="mode-button"
          @click="selectMode('load')"
          :disabled="loading"
        >
          <template #default>
            <i class="pi pi-folder-open mr-2"></i>
            <div class="text-left">
              <div class="font-bold">Load Last Save</div>
              <div class="text-sm">Start Civilization V with Vox Deorum and load the latest save</div>
            </div>
          </template>
        </Button>

        <Button
          label="Wait for Game"
          icon="pi pi-clock"
          severity="info"
          class="mode-button"
          @click="selectMode('wait')"
          :disabled="loading"
        >
          <template #default>
            <i class="pi pi-clock mr-2"></i>
            <div class="text-left">
              <div class="font-bold">Manual Start</div>
              <div class="text-sm opacity-80">Start the game with Vox Deorum (mods loaded <strong>automatically</strong>) and load your game manually</div>
            </div>
          </template>
        </Button>
      </div>
    </div>

    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        @click="closeDialog"
        :disabled="loading"
      />
    </template>
  </Dialog>
</template>

<style scoped>
.mode-selection {
  padding: 1rem 0;
}

.mode-options {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.mode-button {
  width: 100%;
  padding: 1rem;
  justify-content: flex-start;
  text-align: left;
}

.mode-button :deep(.p-button-label) {
  flex: 1;
}
</style>