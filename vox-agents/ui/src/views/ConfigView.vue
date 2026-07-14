<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '../api/client';
import type { AgentMapping, LLMConfig, VoxAgentsConfig, AgentInfo } from '../utils/types';
import { apiKeyFields } from '../utils/types';
import AgentModelMappings from '../components/config/AgentModelMappings.vue';
import ApiKeysSection from '../components/config/ApiKeysSection.vue';
import ModelDefinitions from '../components/config/ModelDefinitions.vue';
import PathSettingsSection from '../components/config/PathSettingsSection.vue';
import ModelOptionsDialog from '../components/ModelOptionsDialog.vue';
import {
  parseLLMConfig,
  buildLLMConfig,
  getAgentsUsingModel,
  validateMappings
} from '../utils/config-utils';

// State
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const success = ref(false);
const apiKeys = ref<Record<string, string>>({});
const config = ref<VoxAgentsConfig | null>(null);

// LLM Configuration State
const agentMappings = ref<AgentMapping[]>([]);
const modelDefinitions = ref<LLMConfig[]>([]);
const embedderModel = ref<string | null>(null);

// Agent registry state
const agents = ref<AgentInfo[]>([]);

// Initialize confirmation service
const confirm = useConfirm();

// Model options dialog state
const modelOptionsVisible = ref(false);
const editingModel = ref<LLMConfig | null>(null);

// Computed available chat models for agent dropdowns (excludes embedding models)
const availableModels = computed(() => {
  return modelDefinitions.value
    .filter(m => !m.options?.embeddingSize && m.id)
    .map(m => ({ label: m.id!, value: m.id! }));
});

// Computed available embedding models for the embedder dropdown
const embeddingModels = computed(() => {
  return modelDefinitions.value
    .filter(m => m.options?.embeddingSize && m.id)
    .map(m => ({ label: m.id!, value: m.id! }));
});

// Computed agent types from dynamic registry
const agentTypes = computed(() => {
  // Add "default" as the first option (it's not a registered agent, but a config key)
  const types = [
    { label: 'Default', value: 'default' }
  ];

  // Add all registered agents
  agents.value.forEach(agent => {
    types.push({
      label: agent.name,
      value: agent.name
    });
  });

  return types;
});

// Load configuration and agents on mount
onMounted(async () => {
  await Promise.all([loadConfig(), loadAgents()]);
});

// Load agents from server
async function loadAgents() {
  try {
    const data = await api.getAgents();
    agents.value = data.agents;
  } catch (err: any) {
    error.value = err.message || 'Failed to load agents';
    console.error('Error loading agents:', err);
  }
}

// Load configuration from server
async function loadConfig() {
  loading.value = true;
  error.value = null;

  try {
    const data = await api.getCurrentConfig();

    // Initialize API keys with empty strings for missing keys
    const loadedKeys: Record<string, string> = {};
    for (const field of apiKeyFields) {
      loadedKeys[field.key] = data.apiKeys[field.key] || '';
    }
    apiKeys.value = loadedKeys;

    // Parse LLM configuration
    const { mappings, definitions, embedder } = parseLLMConfig(data.config.llms || {});
    agentMappings.value = mappings;
    embedderModel.value = embedder;
    // Ensure all model definitions have an options object
    modelDefinitions.value = definitions.map(def => ({
      ...def,
      options: def.options || {}
    }));

    // Keep other parts
    config.value = data.config;
  } catch (err: any) {
    error.value = err.message || 'Failed to load configuration';
    console.error('Error loading config:', err);
  } finally {
    loading.value = false;
  }
}

/** Ask for confirmation when deleting the last definition of an assigned model. */
function confirmDeleteModel(modelIndex: number): void {
  const modelId = modelDefinitions.value[modelIndex]?.id;
  if (modelId === undefined) return;
  const hasDuplicateDefinition = modelDefinitions.value.some((model, index) =>
    index !== modelIndex && model.id === modelId
  );
  const inUse = hasDuplicateDefinition ? [] : getAgentsUsingModel(modelId, agentMappings.value);

  if (inUse.length > 0) {
    confirm.require({
      message: `This model is used by the following agents: ${inUse.join(', ')}. Deleting this model will also remove these assignments. Do you want to continue?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      rejectClass: 'p-button-text',
      acceptClass: 'p-button-danger',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => deleteModel(modelIndex)
    });
  } else {
    deleteModel(modelIndex);
  }
}

/** Remove the selected row and clear mappings only when its model ID no longer exists. */
function deleteModel(modelIndex: number): void {
  const modelId = modelDefinitions.value[modelIndex]?.id;
  if (modelId === undefined) return;
  modelDefinitions.value = modelDefinitions.value.filter((_, index) => index !== modelIndex);
  if (modelId && !modelDefinitions.value.some(model => model.id === modelId)) {
    agentMappings.value = agentMappings.value.filter(mapping => mapping.model !== modelId);
  }
}

/** Open the options dialog for the given model */
function openModelOptions(model: LLMConfig): void {
  editingModel.value = model;
  modelOptionsVisible.value = true;
}

/** Apply options emitted from the dialog back onto the model */
function applyModelOptions(options: LLMConfig['options']): void {
  const target = editingModel.value;
  if (!target) return;
  const updated = { ...target, options };
  modelDefinitions.value = modelDefinitions.value.map(model => model === target ? updated : model);
  editingModel.value = updated;
}

// Save configuration (API keys and config)
async function saveConfig() {
  saving.value = true;
  error.value = null;
  success.value = false;

  try {
    // Validate mappings before saving
    const validation = validateMappings(agentMappings.value, modelDefinitions.value);
    if (!validation.valid) {
      error.value = validation.errors.join('. ');
      saving.value = false;
      return;
    }

    // Filter out empty API key values
    const nonEmptyKeys = Object.fromEntries(
      Object.entries(apiKeys.value).filter(([_, value]) => value !== '')
    );

    // Build the updated config with LLM settings
    const updatedConfig = {
      ...config.value!,
      llms: buildLLMConfig(agentMappings.value, modelDefinitions.value, embedderModel.value)
    };

    await api.updateCurrentConfig({
      apiKeys: nonEmptyKeys,
      config: updatedConfig
    });

    success.value = true;
    setTimeout(() => {
      success.value = false;
    }, 3000);
  } catch (err: any) {
    error.value = err.message || 'Failed to save configuration';
    console.error('Error saving config:', err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="config-view">
    <!-- Page Header with Title and Actions -->
    <div class="page-header">
      <div class="page-header-left">
        <h1>System Settings</h1>
        <!-- Loading Spinner Icon -->
        <ProgressSpinner v-if="loading" style="width: 24px; height: 24px" />
      </div>
      <div class="page-header-controls">
        <Button
          label="Reload"
          icon="pi pi-refresh"
          text
          @click="loadConfig"
          :disabled="loading || saving"
        />
        <Button
          label="Save All"
          icon="pi pi-save"
          severity="success"
          @click="saveConfig"
          :loading="saving"
          :disabled="loading"
        />
      </div>
    </div>

    <!-- Status Messages -->
    <div class="status-messages" v-if="success || error">
      <!-- Success Message -->
      <Message v-if="success" severity="success" :closable="false">
        Saved successfully
      </Message>
      <!-- Error Message -->
      <Message v-if="error" severity="error" :closable="true" @close="error = null">
        {{ error }}
      </Message>
    </div>

    <ApiKeysSection v-model="apiKeys" />

    <PathSettingsSection v-if="config" :config="config" @update:config="config = $event" />

    <AgentModelMappings
      v-model:mappings="agentMappings"
      v-model:embedderModel="embedderModel"
      :agentTypes="agentTypes"
      :availableModels="availableModels"
      :embeddingModels="embeddingModels"
    />

    <ModelDefinitions
      v-model:models="modelDefinitions"
      @open-options="openModelOptions"
      @delete-model="confirmDeleteModel"
    />

    <ModelOptionsDialog
      v-model:visible="modelOptionsVisible"
      :model="editingModel"
      @apply="applyModelOptions"
    />
  </div>
</template>

<style scoped>
.status-messages {
  margin-bottom: 1.5rem;
}
</style>
