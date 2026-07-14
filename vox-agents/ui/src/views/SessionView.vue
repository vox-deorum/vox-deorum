<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import Message from 'primevue/message';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import ActiveSessionPanel from '../components/ActiveSessionPanel.vue';
import ConfigDialog from '../components/ConfigDialog.vue';
import GameModeDialog from '../components/GameModeDialog.vue';
import PlayersSummaryDialog from '../components/PlayersSummaryDialog.vue';
import SessionConfigList from '../components/SessionConfigList.vue';
import type { GameMode } from '../components/GameModeDialog.vue';
import { api } from '../api/client';
import {
  sessionStatus,
  loading as sessionLoading,
  error as sessionError,
  fetchFreshSessionStatus,
  stopSession,
  pauseSession,
  resumeSession,
  startSessionPolling
} from '../stores/session';
import type { SessionConfig, StrategistSessionConfig } from '../utils/types';

type ConfigDialogMode = 'add' | 'edit' | 'duplicate';

/**
 * Session Control view for managing game sessions and configurations
 */

// Local state
const configs = ref<SessionConfig[]>([]);
const loadingConfigs = ref(false);
const configError = ref<string | null>(null);

// Dialog state
const showConfigDialog = ref(false);
const configDialogMode = ref<ConfigDialogMode>('add');
const editingConfig = ref<StrategistSessionConfig | undefined>(undefined);
const editingConfigName = ref('');

// Game mode dialog state
const showGameModeDialog = ref(false);
const pendingConfig = ref<SessionConfig | null>(null);

// Players summary dialog state
const showPlayersDialog = ref(false);

// Starting session state
const startingSession = ref(false);
let releaseSessionPolling: (() => void) | null = null;

// Services
const confirm = useConfirm();
const toast = useToast();

/**
 * Whether the active session is paused (orthogonal to state, which stays 'running')
 */
const isPaused = computed(() => !!sessionStatus.value?.session?.paused);

/**
 * Load configurations from server
 */
async function loadConfigs() {
  loadingConfigs.value = true;
  configError.value = null;

  try {
    const response = await api.getSessionConfigs();
    configs.value = response.configs;
  } catch (caught) {
    configError.value = caught instanceof Error ? caught.message : 'Failed to load configurations';
  } finally {
    loadingConfigs.value = false;
  }
}

/**
 * Show game mode dialog before starting session
 */
function showGameModeSelection(config: SessionConfig) {
  pendingConfig.value = config;
  showGameModeDialog.value = true;
}

/**
 * Start a new session with the given configuration and game mode
 */
async function startSessionWithGameMode(mode: GameMode) {
  if (!pendingConfig.value) return;

  startingSession.value = true;

  try {
    // Create a copy of the config with the selected game mode
    const configWithMode = {
      ...pendingConfig.value,
      gameMode: mode
    };

    await api.startSession(configWithMode);
    await fetchFreshSessionStatus();
    toast.add({
      severity: 'success',
      summary: 'Session Started',
      detail: `Game session started in ${mode} mode`,
      life: 3000
    });
  } catch (caught) {
    toast.add({
      severity: 'error',
      summary: 'Failed to Start',
      detail: caught instanceof Error ? caught.message : 'Failed to start session',
      life: 5000
    });
  } finally {
    startingSession.value = false;
    pendingConfig.value = null;
  }
}

/**
 * Toggle pause/resume on the active session. Pause is reversible, so no confirm.
 */
async function togglePause() {
  const wasPaused = isPaused.value;
  try {
    if (wasPaused) {
      await resumeSession();
    } else {
      await pauseSession();
    }
    toast.add({
      severity: 'success',
      summary: wasPaused ? 'Session Resumed' : 'Session Paused',
      detail: wasPaused
        ? 'Game session resumed'
        : 'Game session paused: no new agent runs will start',
      life: 3000
    });
  } catch (caught) {
    toast.add({
      severity: 'error',
      summary: wasPaused ? 'Failed to Resume' : 'Failed to Pause',
      detail: caught instanceof Error ? caught.message : 'Failed to toggle pause',
      life: 5000
    });
  }
}

/**
 * Stop the current session with confirmation
 */
function confirmStopSession() {
  confirm.require({
    message: 'Are you sure you want to stop the current session?',
    header: 'Stop Session',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await stopSession();
        toast.add({
          severity: 'success',
          summary: 'Session Stopped',
          detail: 'Game session stopped successfully',
          life: 3000
        });
      } catch (caught) {
        toast.add({
          severity: 'error',
          summary: 'Failed to Stop',
          detail: caught instanceof Error ? caught.message : 'Failed to stop session',
          life: 5000
        });
      }
    }
  });
}

/**
 * Delete a configuration with confirmation
 */
function confirmDeleteConfig(config: SessionConfig) {
  // Use config name to derive filename
  const configFilename = `${config.name}.json`;

  confirm.require({
    message: `Are you sure you want to delete configuration "${config.name}"?`,
    header: 'Delete Configuration',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await api.deleteSessionConfig(configFilename);
        await loadConfigs();
        toast.add({
          severity: 'success',
          summary: 'Configuration Deleted',
          detail: 'Configuration deleted successfully',
          life: 3000
        });
      } catch (caught) {
        toast.add({
          severity: 'error',
          summary: 'Failed to Delete',
          detail: caught instanceof Error ? caught.message : 'Failed to delete configuration',
          life: 5000
        });
      }
    }
  });
}

/**
 * Open the configuration dialog for adding or editing
 */
function openConfigDialog(mode: ConfigDialogMode, config?: SessionConfig, configName?: string) {
  configDialogMode.value = mode;

  if ((mode === 'edit' || mode === 'duplicate') && config) {
    editingConfig.value = config as StrategistSessionConfig;
    editingConfigName.value = configName || config.name;
  } else {
    editingConfig.value = undefined;
    editingConfigName.value = '';
  }

  showConfigDialog.value = true;
}

/**
 * Open the configuration dialog with an unsaved copy of an existing config.
 */
function duplicateConfig(config: SessionConfig) {
  const duplicate = JSON.parse(JSON.stringify(config)) as StrategistSessionConfig;
  const duplicateName = getUniqueDuplicateName(config.name);
  duplicate.name = duplicateName;
  openConfigDialog('duplicate', duplicate, duplicateName);
}

/**
 * Generate a unique copy name from the existing config list.
 */
function getUniqueDuplicateName(sourceName: string): string {
  const existingNames = new Set(configs.value.map(config => config.name));
  const baseName = `${sourceName}-copy`;
  let candidate = baseName;
  let suffix = 2;

  while (existingNames.has(candidate)) {
    candidate = `${baseName}-${suffix}`;
    suffix++;
  }

  return candidate;
}

/**
 * Handle configuration save from dialog
 */
async function handleConfigSave(name: string, config: StrategistSessionConfig) {
  try {
    // Ensure the config has the correct name
    config.name = name;

    await api.saveSessionConfig(name, config);
    await loadConfigs();
    showConfigDialog.value = false;
    toast.add({
      severity: 'success',
      summary: 'Configuration Saved',
      detail: 'Configuration saved successfully',
      life: 3000
    });
  } catch (caught) {
    toast.add({
      severity: 'error',
      summary: 'Failed to Save',
      detail: caught instanceof Error ? caught.message : 'Failed to save configuration',
      life: 5000
    });
  }
}


// Initialize on mount
onMounted(async () => {
  releaseSessionPolling = startSessionPolling();
  await loadConfigs();
});

// Cleanup on unmount
onUnmounted(() => {
  releaseSessionPolling?.();
  releaseSessionPolling = null;
});
</script>

<template>
  <div class="session-view">
    <div class="page-header">
      <div class="page-header-left">
        <h1>Session Control</h1>
      </div>
    </div>

    <ActiveSessionPanel
      v-if="sessionStatus?.active && sessionStatus.session"
      :session="sessionStatus.session"
      :loading="sessionLoading"
      @view-players="showPlayersDialog = true"
      @toggle-pause="togglePause"
      @stop="confirmStopSession"
    />

    <!-- Session Error -->
    <Message v-if="sessionError" severity="error" :closable="false" class="mb-4">
      {{ sessionError }}
    </Message>

    <SessionConfigList
      :configs="configs"
      :loading="loadingConfigs"
      :error="configError"
      :session-active="!!sessionStatus?.active"
      :starting-session="startingSession"
      @create="openConfigDialog('add')"
      @start="showGameModeSelection"
      @edit="openConfigDialog('edit', $event)"
      @duplicate="duplicateConfig"
      @delete="confirmDeleteConfig"
    />

    <!-- Configuration Dialog -->
    <ConfigDialog
      v-model:visible="showConfigDialog"
      :mode="configDialogMode"
      :config="editingConfig"
      :configName="editingConfigName"
      @save="handleConfigSave"
    />

    <!-- Game Mode Dialog -->
    <GameModeDialog
      v-model:visible="showGameModeDialog"
      :loading="startingSession"
      @select="startSessionWithGameMode"
    />

    <!-- Players Summary Dialog -->
    <PlayersSummaryDialog
      v-model:visible="showPlayersDialog"
    />
  </div>
</template>
