<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Message from 'primevue/message';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import ActiveSessionPanel from '../components/session/ActiveSessionPanel.vue';
import ConfigDialog from '../components/session/ConfigDialog.vue';
import GameSetupWizard from '../components/session/GameSetupWizard.vue';
import GameModeDialog from '../components/session/GameModeDialog.vue';
import PlayersSummaryDialog from '../components/session/PlayersSummaryDialog.vue';
import SessionConfigList from '../components/session/SessionConfigList.vue';
import type { GameMode } from '../components/session/GameModeDialog.vue';
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
import type {
  AgentInfo,
  ConfigDialogMode,
  SessionConfigEntry,
  StrategistSessionConfig,
  VoxAgentsConfig
} from '../utils/types';
import { errorMessage } from '../utils/errors';
import { loadAgentCatalogue } from '../stores/agents';

/**
 * Session Control view for managing game sessions and configurations
 */

// Local state
const configs = ref<SessionConfigEntry[]>([]);
const agents = ref<AgentInfo[]>([]);
const globalLlms = ref<VoxAgentsConfig['llms']>({});
const loadingConfigs = ref(false);
const configError = ref<string | null>(null);
const loadingAgents = ref(false);
const agentCatalogueWarning = ref<string | null>(null);
const highlightedConfigName = ref<string | null>(null);

// Dialog state
const showConfigDialog = ref(false);
const configDialogMode = ref<ConfigDialogMode>('add');
const editingConfig = ref<StrategistSessionConfig | undefined>(undefined);
const editingConfigName = ref('');

// Game setup wizard state
const showGameSetupWizard = ref(false);

// Game mode dialog state
const showGameModeDialog = ref(false);
const pendingConfig = ref<StrategistSessionConfig | null>(null);

// Players summary dialog state
const showPlayersDialog = ref(false);

// Starting session state
const startingSession = ref(false);
let releaseSessionPolling: (() => void) | null = null;

// Services
const confirm = useConfirm();
const toast = useToast();
const route = useRoute();
const router = useRouter();

/**
 * Load configurations from server
 */
async function loadConfigs() {
  loadingConfigs.value = true;
  configError.value = null;

  try {
    const response = await api.getSessionConfigs();
    configs.value = response.configs;
    globalLlms.value = response.globalLlms;
  } catch (caught) {
    configError.value = errorMessage(caught, 'Failed to load configurations');
  } finally {
    loadingConfigs.value = false;
  }
}

/** Load the agent catalogue once for session summaries and the game setup wizard. */
async function loadAgents() {
  loadingAgents.value = true;
  agentCatalogueWarning.value = null;
  try {
    agents.value = await loadAgentCatalogue();
  } catch (caught) {
    agentCatalogueWarning.value = caught instanceof Error
      ? `Game setup styles are unavailable: ${caught.message}`
      : 'Game setup styles are unavailable. Reload the page before creating a guided game.';
  } finally {
    loadingAgents.value = false;
  }
}

/**
 * Show game mode dialog before starting session
 */
function showGameModeSelection(config: StrategistSessionConfig) {
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
    await api.startSession(pendingConfig.value, mode);
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
      detail: errorMessage(caught, 'Failed to start session'),
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
  const wasPaused = !!sessionStatus.value?.session?.paused;
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
      detail: errorMessage(caught, 'Failed to toggle pause'),
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
          detail: errorMessage(caught, 'Failed to stop session'),
          life: 5000
        });
      }
    }
  });
}

/**
 * Delete a configuration with confirmation
 */
function confirmDeleteConfig(config: StrategistSessionConfig) {
  const configFilename = configs.value.find(entry => entry.name === config.name)?.filename ?? `${config.name}.json`;

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
          detail: errorMessage(caught, 'Failed to delete configuration'),
          life: 5000
        });
      }
    }
  });
}

/**
 * Open the configuration dialog for adding or editing
 */
function openConfigDialog(mode: ConfigDialogMode, config?: StrategistSessionConfig, configName?: string) {
  configDialogMode.value = mode;

  if ((mode === 'edit' || mode === 'duplicate') && config) {
    editingConfig.value = config;
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
function duplicateConfig(config: StrategistSessionConfig) {
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
      detail: errorMessage(caught, 'Failed to save configuration'),
      life: 5000
    });
  }
}

/** Refresh saved configurations and continue to launch when the wizard requested it. */
async function handleWizardSaved(config: StrategistSessionConfig, play: boolean): Promise<void> {
  await loadConfigs();
  highlightedConfigName.value = config.name;
  if (play) showGameModeSelection(config);
}

/** Return from guided setup to the advanced editor when setup styles are unavailable. */
function openAdvancedFromGameSetup(): void {
  showGameSetupWizard.value = false;
  openConfigDialog('add');
}

/** Open game setup from the model wizard handoff once, then remove the trigger query. */
function openRequestedGameSetup(): void {
  if (route.query.setup !== 'game') return;
  showGameSetupWizard.value = true;
  const query = { ...route.query };
  delete query.setup;
  void router.replace({ query });
}

watch(() => route.query.setup, openRequestedGameSetup, { immediate: true });


// Initialize on mount
onMounted(async () => {
  releaseSessionPolling = startSessionPolling();
  await Promise.all([loadConfigs(), loadAgents()]);
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

    <Message v-if="agentCatalogueWarning" severity="warn" :closable="false" class="mb-4">
      {{ agentCatalogueWarning }}
    </Message>

    <SessionConfigList
      :configs="configs"
      :agents="agents"
      :global-llms="globalLlms"
      :loading="loadingConfigs"
      :error="configError"
      :session-active="!!sessionStatus?.active"
      :starting-session="startingSession"
      :highlighted-config-name="highlightedConfigName"
      @create="showGameSetupWizard = true"
      @advanced-create="openConfigDialog('add')"
      @start="showGameModeSelection"
      @edit="openConfigDialog('edit', $event)"
      @duplicate="duplicateConfig"
      @delete="confirmDeleteConfig"
    />

    <GameSetupWizard
      v-model:visible="showGameSetupWizard"
      :agents="agents"
      :agents-loading="loadingAgents"
      :agents-error="agentCatalogueWarning"
      :global-llms="globalLlms"
      :existing-config-names="configs.map(config => config.name)"
      @saved="handleWizardSaved"
      @retry-agents="loadAgents"
      @advanced="openAdvancedFromGameSetup"
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
