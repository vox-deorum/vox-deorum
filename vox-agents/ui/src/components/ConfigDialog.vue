<script setup lang="ts">
/**
 * Configuration dialog component for creating and editing session configurations.
 * Provides a form interface for setting up session parameters including game mode,
 * auto-play settings, and player LLM assignments.
 */

import { ref, computed, watch, onMounted } from 'vue';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Dropdown from 'primevue/dropdown';
import Checkbox from 'primevue/checkbox';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';
import Card from 'primevue/card';
import type { PacingInterruption, StrategistSessionConfig } from '../utils/types';
import { apiClient } from '../api/client';

// Props
const props = defineProps<{
  visible: boolean;
  mode: 'add' | 'edit';
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
const strategistOptions = ref<{ label: string; value: string }[]>([]);
const loadingStrategists = ref(false);
const interruptionOptions = ref<{ label: string; value: PacingInterruption }[]>([
  { label: 'None', value: 'none' }
]);
const loadingInterruptions = ref(false);
const interruptionOptionsLoaded = ref(false);

// Computed properties
const dialogTitle = computed(() =>
  props.mode === 'add' ? 'New Configuration' : 'Edit Configuration'
);

const isEditMode = computed(() => props.mode === 'edit');

// Backend allows `number | "auto"`; the UI splits this into a numeric input plus an "Auto" checkbox.
const isRepetitionAuto = computed<boolean>({
  get: () => localConfig.value.repetition === 'auto',
  set: (val) => {
    if (val) {
      localConfig.value.repetition = 'auto';
    } else {
      delete localConfig.value.repetition;
    }
  }
});

const repetitionValue = computed<number | null>({
  get: () => (typeof localConfig.value.repetition === 'number' ? localConfig.value.repetition : null),
  set: (val) => {
    if (val == null) {
      delete localConfig.value.repetition;
    } else {
      localConfig.value.repetition = val;
    }
  }
});

// Watch for prop changes to update local state
watch(() => props.visible, (newVal) => {
  if (newVal) {
    if (props.mode === 'add') {
      // Reset to default config for new
      const defaultStrategist = strategistOptions.value[0]!.value;
      localConfig.value = {
        name: `session-${new Date().toISOString().slice(0, 10)}`,
        type: 'strategist',
        autoPlay: false,
        gameMode: 'wait',
        llmPlayers: {}
      };
      addPlayer();
      localName.value = localConfig.value.name;
    } else if (props.config) {
      // Copy config for editing
      localConfig.value = JSON.parse(JSON.stringify(props.config));
      hydratePacing(localConfig.value);
      localName.value = props.configName || props.config.name;
    }
  }
});

// Watch for observed mode changes to adjust player IDs
watch(() => localConfig.value.autoPlay, (newVal, oldVal) => {
  // Skip if dialog is not visible or values are the same
  if (!props.visible || newVal === oldVal) return;

  const players = { ...localConfig.value.llmPlayers };
  const playerIds = Object.keys(players).map(Number).sort((a, b) => a - b);

  // If there are no players, just add one with the correct ID
  if (playerIds.length === 0) {
    addPlayer();
    return;
  }

  // Adjust player IDs based on observed mode
  // When observed mode is OFF (autoPlay = false), ensure no player 0
  // When observed mode is ON (autoPlay = true), allow player 0
  if (!newVal && playerIds.includes(0)) {
    // Switching from observed to non-observed: shift player 0 to player 1
    const newPlayers: typeof players = {};
    for (const [id, player] of Object.entries(players)) {
      const numId = Number(id);
      const newId = numId === 0 ? 1 : numId;
      newPlayers[newId] = player;
    }
    localConfig.value.llmPlayers = newPlayers;
  } else if (newVal && playerIds[0] === 1 && !playerIds.includes(0)) {
    // Switching from non-observed to observed: shift player 1 to player 0
    const newPlayers: typeof players = {};
    for (const [id, player] of Object.entries(players)) {
      const numId = Number(id);
      const newId = numId === 1 ? 0 : numId;
      newPlayers[newId] = player;
    }
    localConfig.value.llmPlayers = newPlayers;
  }
});

/**
 * Add a new player to the configuration
 */
function addPlayer() {
  // When observed mode is off (autoPlay = false), start with player 1
  // When observed mode is on (autoPlay = true), start with player 0
  const startingId = localConfig.value.autoPlay ? -1 : 0;
  const nextId = Math.max(startingId, ...Object.keys(localConfig.value.llmPlayers).map(Number)) + 1;
  const defaultStrategist = strategistOptions.value[0]?.value || '';
  localConfig.value.llmPlayers[nextId] = {
    strategist: defaultStrategist,
    pacing: {
      everyTurns: 1,
      interruption: 'none'
    },
    llms: {}
  };
}

/**
 * Remove a player from the configuration
 */
function removePlayer(playerId: number) {
  delete localConfig.value.llmPlayers[playerId];
}

/**
 * Handle save action
 */
function handleSave() {
  const configToSave: StrategistSessionConfig = JSON.parse(JSON.stringify(localConfig.value));
  cleanDefaultPacing(configToSave);

  // Update the config name from the input (only in add mode)
  if (props.mode === 'add') {
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
    const response = await apiClient.getAgents();
    // Filter for strategist agents (those with 'strategist' tag or in their name)
    const strategists = response.agents.filter(agent =>
      agent.tags.includes('strategist') ||
      agent.name.toLowerCase().includes('strategist')
    );

    // Convert to dropdown options
    strategistOptions.value = strategists.map(agent => ({
      label: `${agent.name} - ${agent.description}`,
      value: agent.name
    }));
  } catch (error) {
    console.error('Failed to load strategist options:', error);
  } finally {
    loadingStrategists.value = false;
  }
}

async function loadPacingInterruptionOptions() {
  loadingInterruptions.value = true;
  try {
    const response = await apiClient.getPacingInterruptions();
    // The backend registry is the source of truth so future strategies appear
    // in the dialog without adding more hardcoded dropdown options here.
    interruptionOptions.value = response.interruptions.map(interruption => ({
      label: interruption.description
        ? `${interruption.label} - ${interruption.description}`
        : interruption.label,
      value: interruption.name
    }));
    interruptionOptionsLoaded.value = true;
    hydratePacing(localConfig.value);
  } catch (error) {
    console.error('Failed to load pacing interruption options:', error);
  } finally {
    loadingInterruptions.value = false;
  }
}

function hydratePacing(config: StrategistSessionConfig) {
  for (const player of Object.values(config.llmPlayers)) {
    const interruption = player.pacing?.interruption ?? 'none';
    const knownInterruption = interruptionOptions.value.some(option => option.value === interruption);
    // Bind the UI to explicit defaults even when older configs omit pacing.
    player.pacing = {
      everyTurns: player.pacing?.everyTurns ?? 1,
      interruption: interruptionOptionsLoaded.value && !knownInterruption ? 'none' : interruption
    };
  }
}

function cleanDefaultPacing(config: StrategistSessionConfig) {
  for (const player of Object.values(config.llmPlayers)) {
    const everyTurns = player.pacing?.everyTurns ?? 1;
    const interruption = player.pacing?.interruption ?? 'none';
    const pacing: NonNullable<typeof player.pacing> = {};

    // Keep saved config files compact; missing pacing means backend defaults.
    if (everyTurns !== 1) pacing.everyTurns = everyTurns;
    if (interruption !== 'none') pacing.interruption = interruption;

    if (Object.keys(pacing).length === 0) {
      delete player.pacing;
    } else {
      player.pacing = pacing;
    }
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
    :style="{ width: '700px' }"
    @update:visible="handleClose"
  >
    <div class="config-dialog-content">
      <!-- Game Settings -->
      <Card class="config-section">
        <template #content>
          <div class="settings-grid">
            <div class="field-row">
              <label for="autoPlay">Name: </label>
              <InputText
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
            <!-- Repetitions -->
            <div class="field-row">
              <label for="repetition">Repetitions:</label>
              <InputNumber
                id="repetition"
                v-model="repetitionValue"
                :min="1"
                :max="100"
                :disabled="isRepetitionAuto"
                placeholder="# of repeated games (research only)"
                class="field-input"
              />
              <div class="checkbox-wrapper">
                <Checkbox
                  id="repetitionAuto"
                  v-model="isRepetitionAuto"
                  :binary="true"
                />
                <label for="repetitionAuto" class="checkbox-label">
                  Auto (run until seating × seed cycle completes)
                </label>
              </div>
            </div>
          </div>
        </template>
      </Card>

      <!-- LLM Players -->
      <Card class="config-section">
        <template #title>
          <i class="pi pi-users" /> LLM Players
          <Button
            label="Add Player"
            icon="pi pi-plus"
            text
            size="small"
            @click="addPlayer"
            style="margin-left: auto"
          />
        </template>
        <template #content>
          <div class="players-list">
            <div v-if="Object.keys(localConfig.llmPlayers).length === 0" class="empty-state">
              <i class="pi pi-user-plus" />
              <p>No players configured. Click "Add Player" to add one.</p>
            </div>
            <div
              v-for="(player, playerId) in localConfig.llmPlayers"
              :key="playerId"
              class="field-row"
            >
              <span class="player-label">Player {{ playerId }}:</span>
              <Dropdown
                v-model="player.strategist"
                :options="strategistOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Select strategist"
                :loading="loadingStrategists"
                class="strategist-input"
              />
              <div v-if="player.pacing" class="pacing-controls">
                <label :for="`pacing-turns-${playerId}`">Every turns</label>
                <InputNumber
                  :id="`pacing-turns-${playerId}`"
                  v-model="player.pacing.everyTurns"
                  :min="1"
                  :max="100"
                  showButtons
                  class="pacing-input"
                />
                <label :for="`pacing-interruption-${playerId}`">Interruption</label>
                <Dropdown
                  :id="`pacing-interruption-${playerId}`"
                  v-model="player.pacing.interruption"
                  :options="interruptionOptions"
                  optionLabel="label"
                  optionValue="value"
                  :loading="loadingInterruptions"
                  class="interruption-input"
                />
              </div>
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                @click="removePlayer(Number(playerId))"
                class="delete-btn in-row"
              />
            </div>
          </div>
        </template>
      </Card>
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
        :disabled="!localName.trim()"
      />
    </template>
  </Dialog>
</template>

<style scoped>
/* Import shared styles */
@import '@/styles/states.css';
@import '@/styles/config.css';

/* Dialog specific styles */
.config-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.pacing-controls {
  align-items: center;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: auto 8rem auto 10rem;
}

.pacing-input,
.interruption-input {
  width: 100%;
}
</style>
