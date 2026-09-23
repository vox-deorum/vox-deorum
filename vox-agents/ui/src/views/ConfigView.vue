<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '../api/client';
import type { AgentMapping, LLMConfig, VoxAgentsConfig, AgentInfo, DiscoveredModel, ModelSize } from '../utils/types';
import { apiKeyFields, isEvaluationOnlyProvider } from '../utils/types';
import AgentModelMappings from '../components/config/AgentModelMappings.vue';
import ApiKeysSection from '../components/config/ApiKeysSection.vue';
import ModelDiscoveryDialog from '../components/config/ModelDiscoveryDialog.vue';
import ModelDefinitions from '../components/config/ModelDefinitions.vue';
import PathSettingsSection from '../components/config/PathSettingsSection.vue';
import ModelOptionsDialog from '../components/config/ModelOptionsDialog.vue';
import SetupWizard from '../components/config/SetupWizard.vue';
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
const setupWizardVisible = ref(false);
const route = useRoute();

// LLM Configuration State
const agentMappings = ref<AgentMapping[]>([]);
const modelDefinitions = ref<LLMConfig[]>([]);
const embedderModel = ref<string | null>(null);

// config.llms aliases that own a dedicated row instead of a free-form mapping row.
const tierAliases: ModelSize[] = ['default', 'small', 'large'];

/** Tier aliases and the shared evaluator are edited through their own controls. */
function isDedicatedAgent(agent: string): boolean {
  return agent === 'evaluator' || (tierAliases as string[]).includes(agent);
}

/** Keep the shared evaluator in configuration while giving it a dedicated control. */
const evaluatorModel = computed({
  get: () => agentMappings.value.find(mapping => mapping.agent === 'evaluator')?.model ?? null,
  set: (model: string | null) => {
    agentMappings.value = agentMappings.value.filter(mapping => mapping.agent !== 'evaluator');
    if (model) agentMappings.value.push({ agent: 'evaluator', model });
  }
});

/** Read the three tier rows from the mapping list so they stay a single source of truth. */
const tierModels = computed(() => Object.fromEntries(tierAliases.map(tier =>
  [tier, agentMappings.value.find(mapping => mapping.agent === tier)?.model ?? null]
)) as Record<ModelSize, string | null>);

/** Replace or clear the model assigned to one tier alias. */
function setTierModel(tier: ModelSize, model: string | null): void {
  agentMappings.value = agentMappings.value.filter(mapping => mapping.agent !== tier);
  if (model) agentMappings.value.push({ agent: tier, model });
}

/** Show ordinary mappings separately without dropping the dedicated evaluator and tier rows on edits. */
const visibleMappings = computed({
  get: () => agentMappings.value.filter(mapping => !isDedicatedAgent(mapping.agent)),
  set: (mappings: AgentMapping[]) => {
    const dedicated = agentMappings.value.filter(mapping => isDedicatedAgent(mapping.agent));
    agentMappings.value = [...mappings, ...dedicated];
  }
});

// Agent registry state
const agents = ref<AgentInfo[]>([]);

// Initialize confirmation service
const confirm = useConfirm();

// Model options dialog state
const modelOptionsVisible = ref(false);
const editingModel = ref<LLMConfig | null>(null);
const modelDiscoveryVisible = ref(false);
type DiscoveryTarget = { kind: 'mapping'; index: number } | { kind: 'embedder' } | { kind: 'evaluator' }
  | { kind: 'tier'; tier: ModelSize };
const discoveryTarget = ref<DiscoveryTarget | null>(null);

/** Allow evaluation-only services when discovering a shared or agent-specific evaluator. */
const discoveringEvaluator = computed(() => discoveryTarget.value?.kind === 'evaluator'
  || (discoveryTarget.value?.kind === 'mapping'
    && !!visibleMappings.value[discoveryTarget.value.index]?.agent.endsWith('.evaluator')));

/** Rebuild the editable LLM form state from one complete LLM configuration. */
function rehydrateLlmForm(llms: VoxAgentsConfig['llms']): void {
  const { mappings, definitions, embedder } = parseLLMConfig(llms);
  agentMappings.value = mappings;
  embedderModel.value = embedder;
  modelDefinitions.value = definitions.map(definition => ({
    ...definition,
    options: definition.options || {}
  }));
}

/** Retain non-LLM configuration separately from the editable LLM form state. */
function storeNonLlmConfig(updatedConfig: VoxAgentsConfig): void {
  config.value = { ...updatedConfig, llms: {} };
}

/** Build a complete configuration from the current non-LLM and editable LLM state. */
function buildCurrentConfig(): VoxAgentsConfig | null {
  if (!config.value) return null;
  return {
    ...config.value,
    llms: buildLLMConfig(agentMappings.value, modelDefinitions.value, embedderModel.value)
  };
}

/** Provide the setup wizard with the current editable configuration, including unsaved LLM changes. */
const wizardConfig = computed(() => buildCurrentConfig());

/** Resolve configured choices once so chat and evaluator selectors use the same aliases. */
const modelChoices = computed(() => {
  const options = modelDefinitions.value
    .filter(m => m.id)
    .map(m => ({ label: m.id!, value: m.id! }));
  const known = new Set(options.map(option => option.value));
  for (const modelId of agentMappings.value.map(mapping => mapping.model)) {
    if (modelId && !known.has(modelId)) {
      options.push({ label: modelId, value: modelId });
      known.add(modelId);
    }
  }
  const llms = buildLLMConfig(agentMappings.value, modelDefinitions.value, embedderModel.value);
  // Classify the resolved model so aliases cannot reintroduce evaluation or embedding models.
  return options.flatMap(option => {
    const { value } = option;
    let reference = value;
    const visited = new Set<string>();
    while (!visited.has(reference)) {
      visited.add(reference);
      const definition = llms[reference];
      if (typeof definition === 'string') {
        reference = definition;
      } else if (definition) {
        return definition.options?.embeddingSize ? [] : [{
          ...option, evaluationOnly: isEvaluationOnlyProvider(definition.provider)
        }];
      } else {
        return [{ ...option, evaluationOnly: isEvaluationOnlyProvider(reference.split('/')[0]!) }];
      }
    }
    return [];
  });
});

/** Chat agents cannot use evaluation-only models. */
const availableModels = computed(() => modelChoices.value
  .filter(option => !option.evaluationOnly)
  .map(({ label, value }) => ({ label, value })));

/** Evaluators can use either chat models or dedicated evaluation models. */
const evaluationModels = computed(() => modelChoices.value.map(({ label, value }) => ({ label, value })));

// Computed available embedding models for the embedder dropdown
const embeddingModels = computed(() => {
  const options = modelDefinitions.value
    .filter(m => m.options?.embeddingSize && m.id)
    .map(m => ({ label: m.id!, value: m.id! }));
  if (embedderModel.value && !options.some(option => option.value === embedderModel.value)) {
    options.push({ label: embedderModel.value, value: embedderModel.value });
  }
  return options;
});

/** Registered agents only: the tier aliases have dedicated rows and are not free-form choices. */
const agentTypes = computed(() => agents.value.map(agent => ({
  label: agent.name,
  value: agent.name
})));

// Load configuration and agents on mount
onMounted(async () => {
  await Promise.all([loadConfig(), loadAgents()]);
});

watch(
  () => route.query.setup,
  setup => {
    if (setup === '1') setupWizardVisible.value = true;
  },
  { immediate: true }
);

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

    rehydrateLlmForm(data.config.llms || {});
    storeNonLlmConfig(data.config);
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
  modelDefinitions.value = modelDefinitions.value.filter((_, index) => index !== modelIndex);
  if (!modelDefinitions.value.some(model => model.id === modelId)) {
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

/** Open model discovery for the assignment that requested a new model. */
function openModelDiscovery(target: DiscoveryTarget): void {
  discoveryTarget.value = target;
  modelDiscoveryVisible.value = true;
}

/** Add a discovered definition when needed, then assign it to the requesting control. */
function applyDiscoveredModel(model: DiscoveredModel): void {
  if (!modelDefinitions.value.some(definition => definition.id === model.id)) {
    modelDefinitions.value = [...modelDefinitions.value, {
      id: model.id,
      provider: model.provider,
      name: model.name,
      options: { ...(model.recommendedOptions ?? {}) }
    }];
  }

  const target = discoveryTarget.value;
  if (target?.kind === 'mapping') {
    visibleMappings.value = visibleMappings.value.map((mapping, index) =>
      index === target.index ? { ...mapping, model: model.id } : mapping
    );
  } else if (target?.kind === 'embedder') {
    embedderModel.value = model.id;
  } else if (target?.kind === 'evaluator') {
    evaluatorModel.value = model.id;
  } else if (target?.kind === 'tier') {
    setTierModel(target.tier, model.id);
  }
  discoveryTarget.value = null;
}

// Save configuration (API keys and config)
async function saveConfig() {
  saving.value = true;
  error.value = null;
  success.value = false;

  try {
    // Validate mappings before saving
    const validationErrors = validateMappings(agentMappings.value, modelDefinitions.value);
    if (validationErrors.length > 0) {
      error.value = validationErrors.join('. ');
      saving.value = false;
      return;
    }

    // Filter out empty API key values
    const nonEmptyKeys = Object.fromEntries(
      Object.entries(apiKeys.value).filter(([_, value]) => value !== '')
    );

    // Build the updated config with LLM settings
    const updatedConfig = buildCurrentConfig();
    if (!updatedConfig) return;

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

/** Retain non-LLM edits emitted by the path settings section. */
function updatePathSettings(updatedConfig: VoxAgentsConfig): void {
  storeNonLlmConfig(updatedConfig);
}

/** Rehydrate the editable form immediately after the setup wizard saves a configuration. */
function updateWizardConfig(updatedConfig: VoxAgentsConfig): void {
  rehydrateLlmForm(updatedConfig.llms);
  storeNonLlmConfig(updatedConfig);
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
          label="Setup wizard"
          icon="pi pi-sparkles"
          text
          @click="setupWizardVisible = true"
          :disabled="loading || saving"
        />
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

    <PathSettingsSection v-if="config" :config="config" @update:config="updatePathSettings" />

    <AgentModelMappings
      v-model:mappings="visibleMappings"
      v-model:embedderModel="embedderModel"
      v-model:evaluatorModel="evaluatorModel"
      :agentTypes="agentTypes"
      :availableModels="availableModels"
      :embeddingModels="embeddingModels"
      :evaluationModels="evaluationModels"
      :tierModels="tierModels"
      @update:tierModel="setTierModel"
      @discover-model="openModelDiscovery({ kind: 'mapping', index: $event })"
      @discover-embedder="openModelDiscovery({ kind: 'embedder' })"
      @discover-evaluator="openModelDiscovery({ kind: 'evaluator' })"
      @discover-tier="openModelDiscovery({ kind: 'tier', tier: $event })"
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

    <ModelDiscoveryDialog
      v-model:visible="modelDiscoveryVisible"
      :apiKeys="apiKeys"
      :evaluation="discoveringEvaluator"
      @select="applyDiscoveredModel"
      @update:apiKeys="apiKeys = $event"
    />

    <SetupWizard
      v-model:visible="setupWizardVisible"
      :apiKeys="apiKeys"
      :config="wizardConfig"
      @update:apiKeys="apiKeys = $event"
      @update:config="updateWizardConfig"
    />
  </div>
</template>

<style scoped>
.status-messages {
  margin-bottom: 1.5rem;
}
</style>
