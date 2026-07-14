<script setup lang="ts">
/**
 * Configuration dialog component for creating and editing session configurations.
 * Provides a form interface for setting up session parameters including game mode,
 * auto-play settings, and player LLM assignments.
 */

import { ref, computed, watch, onMounted, nextTick } from 'vue';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Checkbox from 'primevue/checkbox';
import Button from 'primevue/button';
import Card from 'primevue/card';
import type {
  PacingInterruption,
  StrategistSessionConfig
} from '../utils/types';
import { api } from '../api/client';
import PlayerConfigEditor from './config/PlayerConfigEditor.vue';
import SessionRunControls from './config/SessionRunControls.vue';
import {
  applyRunControls,
  cleanDefaultPacing,
  hydratePacing,
  hydrateRunControls,
  type RunControlFormState,
  validateRunControls
} from '@/utils/config-dialog-utils';

type ConfigDialogMode = 'add' | 'edit' | 'duplicate';
type SelectOption<T> = { label: string; value: T; description?: string };
type PlayerEditorHandle = { addPlayer: () => void };

// Props
const props = defineProps<{
  visible: boolean;
  mode: ConfigDialogMode;
  config?: StrategistSessionConfig;
  configName?: string;
}>();

// Emits
const emit = defineEmits<{
  'update:visible': [value: boolean];
  'save': [name: string, config: StrategistSessionConfig];
}>();

// Local state for editing
const localConfig = ref<StrategistSessionConfig>({
  name: '',
  type: 'strategist',
  autoPlay: false,
  gameMode: 'wait',
  llmPlayers: {}
});

const localName = ref('');
const playerEditor = ref<PlayerEditorHandle | null>(null);
const strategistOptions = ref<SelectOption<string>[]>([]);
const loadingStrategists = ref(false);
const interruptionOptions = ref<SelectOption<PacingInterruption>[]>([
  { label: 'None', value: 'none' }
]);
const loadingInterruptions = ref(false);
const interruptionOptionsLoaded = ref(false);
const runControlState = ref<RunControlFormState>(hydrateRunControls(localConfig.value));

// Computed properties
const dialogTitle = computed(() => {
  if (props.mode === 'edit') return 'Edit Configuration';
  if (props.mode === 'duplicate') return 'Duplicate Configuration';
  return 'New Configuration';
});

const isEditMode = computed(() => props.mode === 'edit');

const hasRunControlError = computed(() => validateRunControls(runControlState.value) !== null);

// Watch for prop changes to update local state
watch(() => props.visible, async (newVal) => {
  if (newVal) {
    if (props.mode === 'add') {
      // Reset to default config for new
      localConfig.value = {
        name: `session-${new Date().toISOString().slice(0, 10)}`,
        type: 'strategist',
        autoPlay: false,
        gameMode: 'wait',
        llmPlayers: {}
      };
      localName.value = localConfig.value.name;
      runControlState.value = hydrateRunControls(localConfig.value);
      await nextTick();
      playerEditor.value?.addPlayer();
    } else if (props.config) {
      // Copy config for editing
      localConfig.value = JSON.parse(JSON.stringify(props.config));
      hydratePacing(
        localConfig.value,
        interruptionOptions.value.map(option => option.value),
        interruptionOptionsLoaded.value
      );
      runControlState.value = hydrateRunControls(localConfig.value);
      localName.value = props.configName || props.config.name;
      if (props.mode === 'duplicate') {
        localConfig.value.name = localName.value;
      }
    }
  }
});

/** Replace the player map emitted by the editor. */
function updatePlayers(players: StrategistSessionConfig['llmPlayers']): void {
  localConfig.value.llmPlayers = players;
}

/**
 * Handle save action
 */
function handleSave() {
  if (hasRunControlError.value) return;

  const configToSave: StrategistSessionConfig = JSON.parse(JSON.stringify(localConfig.value));
  cleanDefaultPacing(configToSave);
  applyRunControls(configToSave, runControlState.value);

  // Update the config name from the input for configs saved as new files.
  if (props.mode !== 'edit') {
    configToSave.name = localName.value;
  }

  emit('save', localName.value, configToSave);
}

/**
 * Handle dialog close
 */
function handleClose() {
  emit('update:visible', false);
}

/**
 * Load available strategist agents
 */
async function loadStrategistOptions() {
  loadingStrategists.value = true;
  try {
    const response = await api.getAgents();
    // Filter for strategist agents (those with 'strategist' tag or in their name)
    const strategists = response.agents.filter(agent =>
      agent.tags.includes('strategist') ||
      agent.name.toLowerCase().includes('strategist')
    );

    // Convert to dropdown options
    strategistOptions.value = strategists.map(agent => ({
      label: agent.name,
      value: agent.name,
      description: agent.description
    }));
  } catch {
    // Keep the editor usable with an empty strategist list when discovery is unavailable.
  } finally {
    loadingStrategists.value = false;
  }
}

/**
 * Load available pacing interruption strategies from the backend registry.
 */
async function loadPacingInterruptionOptions() {
  loadingInterruptions.value = true;
  try {
    const response = await api.getPacingInterruptions();
    // The backend registry is the source of truth so future strategies appear
    // in the dialog without adding more hardcoded dropdown options here.
    interruptionOptions.value = response.interruptions.map(interruption => ({
      label: interruption.label,
      value: interruption.name,
      description: interruption.description
    }));
    interruptionOptionsLoaded.value = true;
    hydratePacing(
      localConfig.value,
      interruptionOptions.value.map(option => option.value),
      interruptionOptionsLoaded.value
    );
  } catch {
    // Retain the safe "None" fallback when registry discovery is unavailable.
  } finally {
    loadingInterruptions.value = false;
  }
}

// Load strategist options on mount
onMounted(() => {
  loadStrategistOptions();
  loadPacingInterruptionOptions();
});
</script>

<template>
  <Dialog
    :visible="visible"
    :header="dialogTitle"
    :modal="true"
    :style="{ width: 'min(960px, 95vw)' }"
    :contentStyle="{ maxHeight: 'min(72vh, 720px)', overflow: 'auto' }"
    @update:visible="handleClose"
  >
    <div class="config-dialog-content">
      <!-- Game Settings -->
      <Card class="config-section">
        <template #content>
          <div class="settings-grid">
            <div class="field-row">
              <label for="configName">Name:</label>
              <InputText
                id="configName"
                v-model="localName"
                :disabled="isEditMode"
                placeholder="Enter configuration name"
                class="config-name-input"
              />
            </div>
            <!-- Auto-play -->
            <div class="field-row">
              <label for="autoPlay">Observe:</label>
              <div class="checkbox-wrapper">
                <Checkbox
                  id="autoPlay"
                  v-model="localConfig.autoPlay"
                  :binary="true"
                />
                <label for="autoPlay" class="checkbox-label">
                  Enable observation mode when starting the session
                </label>
              </div>
            </div>
          </div>
        </template>
      </Card>

      <SessionRunControls
        v-model="runControlState"
        v-model:repetition="localConfig.repetition"
      />

      <PlayerConfigEditor
        ref="playerEditor"
        :players="localConfig.llmPlayers"
        :auto-play="localConfig.autoPlay"
        :strategist-options="strategistOptions"
        :interruption-options="interruptionOptions"
        :loading-strategists="loadingStrategists"
        :loading-interruptions="loadingInterruptions"
        @update:players="updatePlayers"
      />
    </div>

    <!-- Dialog Footer -->
    <template #footer>
      <Button
        label="Cancel"
        icon="pi pi-times"
        @click="handleClose"
        text
      />
      <Button
        label="Save"
        icon="pi pi-check"
        @click="handleSave"
        :disabled="!localName.trim() || hasRunControlError"
      />
    </template>
  </Dialog>
</template>

<style scoped>
/* Dialog specific styles */
.config-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.config-dialog-content :deep(.p-card-body) {
  padding: 0.8rem 1rem;
}

.config-dialog-content :deep(.p-card-content) {
  padding-top: 0.4rem;
}

.config-dialog-content :deep(.p-card-title) {
  line-height: 1.2;
}

.settings-grid {
  gap: 0.55rem;
}

.config-dialog-content .field-row {
  gap: 0.65rem;
  margin-bottom: 0.25rem;
}

</style>
