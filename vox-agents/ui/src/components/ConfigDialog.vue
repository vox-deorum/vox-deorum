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
import type {
  PacingInterruption,
  PlayerConfig,
  ProductionMode,
  RandomSeedsConfig,
  StrategistSessionConfig
} from '../utils/types';
import { apiClient } from '../api/client';

type ConfigDialogMode = 'add' | 'edit' | 'duplicate';
type SelectOption<T> = { label: string; value: T; description?: string };
type PlayerListEntry = { id: number; player: PlayerConfig };
type ProductionOption = ProductionMode | 'default';

const UINT32_MAX = 0xffffffff;

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
const selectedPlayerId = ref<number | null>(null);
const strategistOptions = ref<SelectOption<string>[]>([]);
const loadingStrategists = ref(false);
const interruptionOptions = ref<SelectOption<PacingInterruption>[]>([
  { label: 'None', value: 'none' }
]);
const loadingInterruptions = ref(false);
const interruptionOptionsLoaded = ref(false);
const runControlsExpanded = ref(false);
const selectedProduction = ref<ProductionOption>('default');
const seatingCycleSeed = ref<number | null>(-1);
const mapSeedsInput = ref('');
const gameSeedsInput = ref('');

const productionOptions: SelectOption<ProductionOption>[] = [
  { label: 'Default', value: 'default' },
  { label: 'Test', value: 'test' },
  { label: 'Livestream', value: 'livestream' },
  { label: 'Recording', value: 'recording' }
];

// Computed properties
const dialogTitle = computed(() => {
  if (props.mode === 'edit') return 'Edit Configuration';
  if (props.mode === 'duplicate') return 'Duplicate Configuration';
  return 'New Configuration';
});

const isEditMode = computed(() => props.mode === 'edit');

const sortedPlayerIds = computed(() =>
  Object.keys(localConfig.value.llmPlayers).map(Number).sort((a, b) => a - b)
);

const playerListEntries = computed<PlayerListEntry[]>(() =>
  sortedPlayerIds.value
    .map(id => ({ id, player: localConfig.value.llmPlayers[id] }))
    .filter((entry): entry is PlayerListEntry => entry.player !== undefined)
);

const selectedPlayer = computed<PlayerConfig | null>(() => {
  if (selectedPlayerId.value === null) return null;
  return localConfig.value.llmPlayers[selectedPlayerId.value] ?? null;
});

const selectedPlayerTitle = computed(() =>
  selectedPlayerId.value === null ? 'No Player Selected' : `Player ${selectedPlayerId.value}`
);

const seatingCycleSeedError = computed(() => {
  const value = seatingCycleSeed.value;
  if (value == null || !Number.isInteger(value) || value < -1 || value > UINT32_MAX) {
    return 'Seating cycle seed must be -1 or a uint32 integer.';
  }
  return null;
});

const seatingCycleSeedSuffix = computed(() =>
  seatingCycleSeed.value === -1 ? ' (disabled)' : ' (enabled)'
);

const seedValidationError = computed(() => validateControlledSeedInputs());

const hasRunControlError = computed(() =>
  seatingCycleSeedError.value !== null || seedValidationError.value !== null
);

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
      localConfig.value = {
        name: `session-${new Date().toISOString().slice(0, 10)}`,
        type: 'strategist',
        autoPlay: false,
        gameMode: 'wait',
        llmPlayers: {}
      };
      localName.value = localConfig.value.name;
      hydrateRunControls(localConfig.value);
      addPlayer();
    } else if (props.config) {
      // Copy config for editing
      localConfig.value = JSON.parse(JSON.stringify(props.config));
      hydratePacing(localConfig.value);
      hydrateRunControls(localConfig.value);
      localName.value = props.configName || props.config.name;
      if (props.mode === 'duplicate') {
        localConfig.value.name = localName.value;
      }
      selectFirstPlayer();
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
    if (selectedPlayerId.value === 0) {
      selectedPlayerId.value = 1;
    }
  } else if (newVal && playerIds[0] === 1 && !playerIds.includes(0)) {
    // Switching from non-observed to observed: shift player 1 to player 0
    const newPlayers: typeof players = {};
    for (const [id, player] of Object.entries(players)) {
      const numId = Number(id);
      const newId = numId === 1 ? 0 : numId;
      newPlayers[newId] = player;
    }
    localConfig.value.llmPlayers = newPlayers;
    if (selectedPlayerId.value === 1) {
      selectedPlayerId.value = 0;
    }
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
  selectedPlayerId.value = nextId;
}

/**
 * Remove a player from the configuration
 */
function removePlayer(playerId: number) {
  delete localConfig.value.llmPlayers[playerId];
  if (selectedPlayerId.value === playerId) {
    selectFirstPlayer();
  }
}

/**
 * Select the requested player for detail editing.
 */
function selectPlayer(playerId: number) {
  selectedPlayerId.value = playerId;
}

/**
 * Select the first configured player, or clear selection when none remain.
 */
function selectFirstPlayer() {
  selectedPlayerId.value = sortedPlayerIds.value[0] ?? null;
}

/**
 * Return the label shown for a strategist value.
 */
function strategistLabel(value: string): string {
  return strategistOptions.value.find(option => option.value === value)?.label || value || 'No strategist';
}

/**
 * Return a compact pacing summary for the player list.
 */
function pacingSummary(player: PlayerConfig): string {
  const everyTurns = player.pacing?.everyTurns ?? 1;
  const interruption = player.pacing?.interruption ?? 'none';
  const interruptionLabel = interruptionOptions.value.find(option => option.value === interruption)?.label || interruption;
  return interruption === 'none'
    ? `Every ${everyTurns} turn${everyTurns === 1 ? '' : 's'}`
    : `Every ${everyTurns}, ${interruptionLabel}`;
}

/**
 * Handle save action
 */
function handleSave() {
  if (hasRunControlError.value) return;

  const configToSave: StrategistSessionConfig = JSON.parse(JSON.stringify(localConfig.value));
  cleanDefaultPacing(configToSave);
  applyRunControls(configToSave);

  // Update the config name from the input for configs saved as new files.
  if (props.mode !== 'edit') {
    configToSave.name = localName.value;
  }

  emit('save', localName.value, configToSave);
}

/**
 * Toggle the advanced run controls disclosure panel.
 */
function toggleRunControls() {
  runControlsExpanded.value = !runControlsExpanded.value;
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
      label: agent.name,
      value: agent.name,
      description: agent.description
    }));
  } catch (error) {
    console.error('Failed to load strategist options:', error);
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
    const response = await apiClient.getPacingInterruptions();
    // The backend registry is the source of truth so future strategies appear
    // in the dialog without adding more hardcoded dropdown options here.
    interruptionOptions.value = response.interruptions.map(interruption => ({
      label: interruption.label,
      value: interruption.name,
      description: interruption.description
    }));
    interruptionOptionsLoaded.value = true;
    hydratePacing(localConfig.value);
  } catch (error) {
    console.error('Failed to load pacing interruption options:', error);
  } finally {
    loadingInterruptions.value = false;
  }
}

/**
 * Ensure every player has explicit UI pacing defaults.
 */
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

/**
 * Remove default pacing fields before saving configs to disk.
 */
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

/**
 * Reset advanced run control UI state from the config being edited.
 */
function hydrateRunControls(config: StrategistSessionConfig) {
  runControlsExpanded.value = false;
  selectedProduction.value = config.production && config.production !== 'none' ? config.production : 'default';
  seatingCycleSeed.value = config.randomizeSeating === true
    ? 0
    : typeof config.randomizeSeating === 'number'
      ? config.randomizeSeating
      : -1;

  const seedSets = Array.isArray(config.randomSeeds)
    ? config.randomSeeds
    : config.randomSeeds
      ? [config.randomSeeds]
      : [];

  mapSeedsInput.value = seedSets
    .map(seed => seed.map)
    .filter((seed): seed is number => seed !== undefined)
    .join(', ');
  gameSeedsInput.value = seedSets
    .map(seed => seed.sync)
    .filter((seed): seed is number => seed !== undefined)
    .join(', ');
}

/**
 * Apply cleaned advanced run control values to a config clone before saving.
 */
function applyRunControls(config: StrategistSessionConfig) {
  if (selectedProduction.value === 'default') {
    delete config.production;
  } else {
    config.production = selectedProduction.value;
  }

  if (seatingCycleSeed.value == null || seatingCycleSeed.value < 0) {
    delete config.randomizeSeating;
  } else {
    config.randomizeSeating = seatingCycleSeed.value;
  }

  const randomSeeds = buildControlledSeeds();
  if (randomSeeds === undefined) {
    delete config.randomSeeds;
  } else {
    config.randomSeeds = randomSeeds;
  }
}

/**
 * Validate comma-separated controlled seed fields.
 */
function validateControlledSeedInputs(): string | null {
  const mapSeeds = parseSeedInput(mapSeedsInput.value, 'Map seeds');
  if (mapSeeds.error) return mapSeeds.error;

  const gameSeeds = parseSeedInput(gameSeedsInput.value, 'Game seeds');
  if (gameSeeds.error) return gameSeeds.error;

  if (
    mapSeeds.values.length > 0 &&
    gameSeeds.values.length > 0 &&
    mapSeeds.values.length !== gameSeeds.values.length
  ) {
    return 'Map seeds and game seeds must have the same number of entries.';
  }

  return null;
}

/**
 * Build `randomSeeds` from the validated map/game seed inputs.
 */
function buildControlledSeeds(): RandomSeedsConfig | RandomSeedsConfig[] | undefined {
  const mapSeeds = parseSeedInput(mapSeedsInput.value, 'Map seeds').values;
  const gameSeeds = parseSeedInput(gameSeedsInput.value, 'Game seeds').values;
  const seedCount = Math.max(mapSeeds.length, gameSeeds.length);
  if (seedCount === 0) return undefined;

  const seedSets = Array.from({ length: seedCount }, (_, index) => {
    const seedSet: RandomSeedsConfig = {};
    if (mapSeeds[index] !== undefined) seedSet.map = mapSeeds[index];
    if (gameSeeds[index] !== undefined) seedSet.sync = gameSeeds[index];
    return seedSet;
  });

  return seedSets.length === 1 ? seedSets[0] : seedSets;
}

/**
 * Parse a comma-separated uint32 seed list.
 */
function parseSeedInput(value: string, label: string): { values: number[]; error: string | null } {
  const trimmed = value.trim();
  if (trimmed === '') return { values: [], error: null };

  const tokens = trimmed.split(',').map(token => token.trim());
  const values: number[] = [];

  for (const token of tokens) {
    if (token === '' || !/^\d+$/.test(token)) {
      return { values: [], error: `${label} must be comma-separated positive integers.` };
    }

    const parsed = Number(token);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > UINT32_MAX) {
      return { values: [], error: `${label} must use positive uint32 integers.` };
    }
    values.push(parsed);
  }

  return { values, error: null };
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

      <!-- Run Controls -->
      <Card class="config-section run-controls-section" :class="{ collapsed: !runControlsExpanded }">
        <template #title>
          <div
            class="run-controls-header"
            role="button"
            tabindex="0"
            :aria-expanded="runControlsExpanded"
            v-tooltip="runControlsExpanded ? 'Collapse run controls' : 'Expand run controls'"
            @click="toggleRunControls"
            @keydown.enter.prevent="toggleRunControls"
            @keydown.space.prevent="toggleRunControls"
          >
            <span class="run-controls-title">
              <i class="pi pi-sliders-h" />
              <span>Run Controls</span>
              <span v-if="hasRunControlError" class="run-control-badge">Invalid</span>
            </span>
            <i
              :class="[
                runControlsExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down',
                'run-controls-chevron'
              ]"
            />
          </div>
        </template>
        <template #content>
          <div v-if="runControlsExpanded" class="run-controls-grid">
            <div class="detail-field production-field">
              <label for="productionMode">Production</label>
              <Dropdown
                id="productionMode"
                v-model="selectedProduction"
                :options="productionOptions"
                optionLabel="label"
                optionValue="value"
                class="detail-input"
              />
            </div>

            <div class="detail-field compact-number-field seating-field">
              <label for="seatingCycleSeed">Seating cycle seed</label>
              <InputNumber
                id="seatingCycleSeed"
                v-model="seatingCycleSeed"
                :min="-1"
                :max="UINT32_MAX"
                :suffix="seatingCycleSeedSuffix"
                showButtons
                class="detail-input"
              />
            </div>

            <div class="repetition-group">
              <div class="detail-field compact-number-field repetition-field">
                <label for="repetition">Repetitions</label>
                <InputNumber
                  id="repetition"
                  v-model="repetitionValue"
                  :min="1"
                  :max="100"
                  :disabled="isRepetitionAuto"
                  placeholder="# repeated games"
                  class="detail-input"
                />
              </div>

              <div class="checkbox-wrapper run-auto-control">
                <Checkbox
                  id="repetitionAuto"
                  v-model="isRepetitionAuto"
                  :binary="true"
                />
                <label for="repetitionAuto" class="checkbox-label">
                  Auto repetition
                </label>
              </div>
            </div>

            <div class="detail-field seed-field map-seed-field">
              <label for="mapSeeds">Map seeds</label>
              <InputText
                id="mapSeeds"
                v-model="mapSeedsInput"
                placeholder="1, 2, 3"
                class="detail-input"
              />
            </div>

            <div class="detail-field seed-field game-seed-field">
              <label for="gameSeeds">Game seeds</label>
              <InputText
                id="gameSeeds"
                v-model="gameSeedsInput"
                placeholder="1, 2, 3"
                class="detail-input"
              />
            </div>

            <small v-if="seatingCycleSeedError" class="field-error run-control-error">
              {{ seatingCycleSeedError }}
            </small>
            <small v-else-if="seedValidationError" class="field-error run-control-error">
              {{ seedValidationError }}
            </small>
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
          <div class="player-editor">
            <div v-if="Object.keys(localConfig.llmPlayers).length === 0" class="empty-state">
              <i class="pi pi-user-plus" />
              <p>No players configured. Click "Add Player" to add one.</p>
            </div>
            <div v-else class="player-master-detail">
              <div class="player-list" role="listbox" aria-label="LLM players">
                <div
                  v-for="entry in playerListEntries"
                  :key="entry.id"
                  class="player-list-item"
                  :class="{ active: selectedPlayerId === entry.id }"
                  role="option"
                  tabindex="0"
                  :aria-selected="selectedPlayerId === entry.id"
                  @click="selectPlayer(entry.id)"
                  @keydown.enter="selectPlayer(entry.id)"
                  @keydown.space.prevent="selectPlayer(entry.id)"
                >
                  <span class="player-row-main">
                    <span class="player-label">Player {{ entry.id }}</span>
                    <Button
                      icon="pi pi-trash"
                      severity="danger"
                      text
                      rounded
                      size="small"
                      v-tooltip="'Remove player'"
                      @click.stop="removePlayer(entry.id)"
                    />
                  </span>
                  <span class="player-strategist text-truncate">
                    {{ strategistLabel(entry.player.strategist) }}
                  </span>
                  <span class="player-pacing">
                    {{ pacingSummary(entry.player) }}
                  </span>
                </div>
              </div>

              <div v-if="selectedPlayer && selectedPlayer.pacing" class="player-detail">
                <div class="player-detail-header">
                  <h4>{{ selectedPlayerTitle }}</h4>
                </div>

                <div class="detail-field">
                  <label :for="`strategist-${selectedPlayerId}`">Strategist</label>
                  <Dropdown
                    :id="`strategist-${selectedPlayerId}`"
                    v-model="selectedPlayer.strategist"
                    :options="strategistOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Select strategist"
                    :loading="loadingStrategists"
                    class="detail-input"
                  >
                    <template #option="{ option }">
                      <div class="dropdown-option">
                        <span>{{ option.label }}</span>
                        <small v-if="option.description">{{ option.description }}</small>
                      </div>
                    </template>
                  </Dropdown>
                </div>

                <div class="detail-grid">
                  <div class="detail-field cadence-field">
                    <label :for="`pacing-turns-${selectedPlayerId}`">Every turns</label>
                    <InputNumber
                      :id="`pacing-turns-${selectedPlayerId}`"
                      v-model="selectedPlayer.pacing.everyTurns"
                      :min="1"
                      :max="100"
                      showButtons
                      class="detail-input cadence-input"
                    />
                  </div>

                  <div class="detail-field">
                    <label :for="`pacing-interruption-${selectedPlayerId}`">Interruption</label>
                    <Dropdown
                      :id="`pacing-interruption-${selectedPlayerId}`"
                      v-model="selectedPlayer.pacing.interruption"
                      :options="interruptionOptions"
                      optionLabel="label"
                      optionValue="value"
                      :loading="loadingInterruptions"
                      class="detail-input"
                    >
                      <template #option="{ option }">
                        <div class="dropdown-option">
                          <span>{{ option.label }}</span>
                          <small v-if="option.description">{{ option.description }}</small>
                        </div>
                      </template>
                    </Dropdown>
                  </div>
                </div>
              </div>
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
        :disabled="!localName.trim() || hasRunControlError"
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

.run-controls-section.collapsed :deep(.p-card-content) {
  display: none;
}

.run-controls-section :deep(.p-card-title) {
  width: 100%;
}

.run-controls-header {
  align-items: center;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  margin: -0.25rem;
  padding: 0.25rem;
  transition: background 0.15s ease;
  width: calc(100% + 0.5rem);
}

.run-controls-header:hover {
  background: var(--p-content-hover-background);
}

.run-controls-header:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}

.run-controls-title {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  min-width: 0;
}

.run-controls-chevron {
  color: var(--p-primary-color);
  font-size: 0.9rem;
  margin-left: auto;
}

.run-control-badge {
  background: var(--p-red-500);
  border-radius: 4px;
  color: var(--p-primary-contrast-color);
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1;
  padding: 0.2rem 0.35rem;
}

.run-controls-grid {
  align-items: end;
  display: grid;
  gap: 0.7rem 0.85rem;
  grid-template-areas:
    "production seating repetition"
    "map map game"
    "error error error";
  grid-template-columns: minmax(14rem, 1.4fr) 13rem minmax(16rem, 1fr);
}

.production-field {
  grid-area: production;
}

.seating-field {
  grid-area: seating;
}

.repetition-group {
  align-items: end;
  display: flex;
  gap: 0.75rem;
  grid-area: repetition;
  min-width: 0;
}

.repetition-field {
  flex: 0 0 8rem;
}

.run-auto-control {
  flex: 1;
  min-height: auto;
  padding-bottom: 0.35rem;
}

.compact-number-field :deep(.p-inputnumber-input) {
  width: 4.5rem;
}

.seating-field :deep(.p-inputnumber-input) {
  width: 8.5rem;
}

.seed-field {
  grid-column: auto;
}

.map-seed-field {
  grid-area: map;
}

.game-seed-field {
  grid-area: game;
}

.field-error {
  color: var(--p-red-500);
  font-size: 0.8rem;
}

.run-control-error {
  grid-area: error;
}

.player-master-detail {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(16rem, 0.9fr) minmax(20rem, 1.4fr);
}

.player-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.player-list-item {
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  color: var(--p-text-color);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.6rem 0.7rem;
  text-align: left;
  transition: background 0.2s, border-color 0.2s;
  width: 100%;
}

.player-list-item:hover,
.player-list-item.active {
  background: var(--p-content-hover-background);
  border-color: var(--p-primary-color);
}

.player-row-main {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.player-strategist {
  color: var(--p-text-color);
  font-weight: 500;
}

.player-pacing {
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

.player-detail {
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.85rem;
}

.player-detail-header h4 {
  font-size: 1rem;
  margin: 0;
}

.detail-grid {
  align-items: end;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 7.5rem minmax(12rem, 1fr);
}

.detail-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.detail-field label {
  color: var(--p-text-color);
  font-weight: 500;
}

.detail-input {
  width: 100%;
}

.cadence-field,
.cadence-input {
  max-width: 7.5rem;
}

.cadence-input :deep(.p-inputnumber-input) {
  width: 4rem;
}

.dropdown-option {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.dropdown-option small {
  color: var(--p-text-muted-color);
  white-space: normal;
}

@media (max-width: 760px) {
  .player-master-detail,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .run-controls-grid {
    grid-template-areas:
      "production"
      "seating"
      "repetition"
      "map"
      "game"
      "error";
    grid-template-columns: 1fr;
  }

  .repetition-group {
    align-items: stretch;
    flex-direction: column;
    gap: 0.45rem;
  }

  .repetition-field {
    flex: auto;
  }
}
</style>
