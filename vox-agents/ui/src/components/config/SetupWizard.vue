<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import ProgressSpinner from 'primevue/progressspinner';
import { api } from '@/api/client';
import ModelPickerList from '@/components/config/ModelPickerList.vue';
import { useModelDiscovery } from '@/composables/useModelDiscovery';
import type { DiscoveredModel, LLMConfig, VoxAgentsConfig } from '@/utils/types';

type SetupStep = 'path' | 'credentials' | 'models' | 'confirm';
type SetupDoor = 'subscription' | 'api' | 'local';

interface Props {
  visible: boolean;
  apiKeys: Record<string, string>;
  config: VoxAgentsConfig | null;
}

interface Emits {
  (event: 'update:visible', value: boolean): void;
  (event: 'update:config', value: VoxAgentsConfig): void;
  (event: 'update:apiKeys', value: Record<string, string>): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const router = useRouter();
const {
  selectedProvider,
  enteredCredentials,
  discoveredModels,
  selectedModelId,
  discoveryPending,
  discoveryErrorKind,
  selectedProviderLabel,
  credentialFields,
  selectedModel,
  recommendedSmallModel,
  discoveryStatusCopy,
  updateCredential,
  clearDiscoveryError,
  nonEmptySelectedCredentials,
  discover,
  reset,
  invalidate
} = useModelDiscovery({ isActive: () => props.visible });

const currentStep = ref<SetupStep>('path');
const selectedDoor = ref<SetupDoor | null>(null);
const saving = ref(false);
const saveError = ref('');
const codexState = ref<'stopped' | 'starting' | 'ready'>('stopped');
const codexLogin = ref<{ verificationUrl: string; userCode: string } | null>(null);
const codexError = ref('');
const codeCopied = ref(false);
let codexPollTimer: ReturnType<typeof setInterval> | null = null;
let wizardGeneration = 0;
let codexStartPending = false;
let codexDiscoveryPending = false;

const doorOptions: Array<{ value: SetupDoor; title: string }> = [
  { value: 'subscription', title: 'I have a subscription' },
  { value: 'api', title: 'I have an API account' },
  { value: 'local', title: 'I have a local deployment' }
];

const serviceOptions: Record<Exclude<SetupDoor, 'local'>, Array<{ label: string; value: string }>> = {
  subscription: [
    { label: 'ChatGPT', value: 'codex' },
    { label: 'Claude', value: 'claude-code' },
    { label: 'Synthetic.new', value: 'synthetic' },
    { label: 'Chutes.ai', value: 'chutes' }
  ],
  api: [
    { label: 'OpenRouter', value: 'openrouter' },
    { label: 'Anthropic', value: 'anthropic' },
    { label: 'OpenAI', value: 'openai' },
    { label: 'Google AI', value: 'google' }
  ]
};

const dialogVisible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value)
});

const credentialsHeading = computed(() => {
  if (selectedProvider.value === 'codex') return 'Sign in with ChatGPT';
  if (selectedProvider.value === 'claude-code') return 'Use Claude Code';
  if (selectedProvider.value === 'openai-compatible') return 'Connect your local deployment';
  return `Connect your ${selectedProviderLabel.value} account`;
});

const visibleServiceOptions = computed(() => {
  if (!selectedDoor.value || selectedDoor.value === 'local') return [];
  return serviceOptions[selectedDoor.value];
});

const canContinueFromPath = computed(() => selectedDoor.value !== null && selectedProvider.value.length > 0);

/** Reset the wizard to a clean first step while preserving configuration passed by the host. */
function resetWizard(): void {
  invalidatePendingWork();
  reset({ ...props.apiKeys });
  currentStep.value = 'path';
  selectedDoor.value = null;
  saving.value = false;
  saveError.value = '';
  resetCodexState();
}

/** Clear service selection when the user chooses another setup door. */
function selectDoor(door: SetupDoor): void {
  selectedDoor.value = door;
  selectedProvider.value = door === 'local' ? 'openai-compatible' : '';
  clearDiscoveryError();
}

/** Move from path selection into the matching credential experience. */
function continueFromPath(): void {
  if (!canContinueFromPath.value) return;
  currentStep.value = 'credentials';
  clearDiscoveryError();
  if (selectedProvider.value === 'openai-compatible' && !enteredCredentials.value.OPENAI_COMPATIBLE_URL) {
    enteredCredentials.value.OPENAI_COMPATIBLE_URL = 'http://127.0.0.1:11434';
  }
  if (selectedProvider.value === 'codex') void beginCodexLogin();
}

/** Discover models and advance only while this wizard still owns the successful result. */
async function discoverSelectedModels(): Promise<void> {
  if (await discover()) {
    currentStep.value = 'models';
    invalidatePendingWork();
  }
}

/** Clear the visible ChatGPT login state without changing the current wizard path. */
function resetCodexState(): void {
  codexState.value = 'stopped';
  codexLogin.value = null;
  codexError.value = '';
  codeCopied.value = false;
  codexStartPending = false;
  codexDiscoveryPending = false;
}

/** Stop login polling and invalidate all pending login or discovery callbacks. */
function invalidatePendingWork(): void {
  wizardGeneration += 1;
  invalidate();
  if (codexPollTimer) {
    clearInterval(codexPollTimer);
    codexPollTimer = null;
  }
  codexStartPending = false;
  codexDiscoveryPending = false;
}

/** Start ChatGPT sign-in once and begin checking for its browser prompt. */
async function beginCodexLogin(): Promise<void> {
  if (codexStartPending || codexPollTimer || currentStep.value !== 'credentials' || !props.visible) return;
  invalidatePendingWork();
  resetCodexState();
  const generation = wizardGeneration;
  codexStartPending = true;
  codexState.value = 'starting';
  try {
    await api.startCodexLogin();
    if (!props.visible || generation !== wizardGeneration || currentStep.value !== 'credentials') return;
    await refreshCodexStatus(generation);
    if (generation === wizardGeneration && currentStep.value === 'credentials') {
      codexPollTimer = setInterval(() => void refreshCodexStatus(generation), 2000);
    }
  } catch (error) {
    if (generation !== wizardGeneration) return;
    codexState.value = 'stopped';
    codexError.value = error instanceof Error ? error.message : 'ChatGPT sign-in could not start.';
  } finally {
    if (generation === wizardGeneration) codexStartPending = false;
  }
}

/** Refresh ChatGPT login status and advance once its model list is available. */
async function refreshCodexStatus(generation: number): Promise<void> {
  try {
    const status = await api.getCodexLoginStatus();
    if (!props.visible || generation !== wizardGeneration || currentStep.value !== 'credentials') return;
    codexState.value = status.state;
    codexLogin.value = status.login;
    codexError.value = status.error ?? '';
    if (status.state === 'ready' && !codexDiscoveryPending) {
      codexDiscoveryPending = true;
      await discoverSelectedModels();
    }
  } catch (error) {
    if (generation !== wizardGeneration) return;
    codexError.value = error instanceof Error ? error.message : 'ChatGPT sign-in status could not be checked.';
  }
}

/** Retry the complete ChatGPT login sequence after an error. */
function retryCodexLogin(): void {
  invalidatePendingWork();
  void beginCodexLogin();
}

/** Copy the browser sign-in code when clipboard access is available. */
async function copyCodexCode(): Promise<void> {
  if (!codexLogin.value) return;
  try {
    if (!navigator.clipboard) throw new Error('Clipboard access is unavailable.');
    await navigator.clipboard.writeText(codexLogin.value.userCode);
    codeCopied.value = true;
  } catch {
    codexError.value = 'Copy is unavailable. Select the code and copy it manually.';
  }
}

/** Move back one step and stop work that belongs to the abandoned step. */
function goBack(): void {
  if (saving.value) return;
  if (currentStep.value === 'credentials') {
    invalidatePendingWork();
    resetCodexState();
    currentStep.value = 'path';
  } else if (currentStep.value === 'models') {
    currentStep.value = 'credentials';
    selectedModelId.value = '';
    if (selectedProvider.value === 'codex') void beginCodexLogin();
  } else if (currentStep.value === 'confirm') {
    currentStep.value = 'models';
  }
  clearDiscoveryError();
}

/** Advance from model selection to the save summary. */
function continueFromModels(): void {
  if (!selectedModel.value) return;
  saveError.value = '';
  currentStep.value = 'confirm';
}

/** Build a selected model entry while retaining an explicit configured entry when one exists. */
function selectedModelDefinition(model: DiscoveredModel): LLMConfig | string {
  const existing = props.config?.llms[model.id];
  if (typeof existing === 'string') return existing;
  if (existing) {
    const options = { ...(model.recommendedOptions ?? {}), ...(existing.options ?? {}) };
    return {
      ...existing,
      ...(Object.keys(options).length > 0 ? { options } : {})
    };
  }

  return {
    provider: selectedProvider.value,
    name: model.name,
    ...(model.recommendedOptions && Object.keys(model.recommendedOptions).length > 0
      ? { options: model.recommendedOptions }
      : {})
  };
}

/** Save the selected model while retaining all existing configuration and model entries. */
async function saveSetup(): Promise<void> {
  const model = selectedModel.value;
  if (!props.config || !model || saving.value) return;
  saving.value = true;
  saveError.value = '';
  const modelDefinition = selectedModelDefinition(model);
  const smallModel = recommendedSmallModel.value;
  const updatedConfig: VoxAgentsConfig = {
    ...props.config,
    llms: {
      ...props.config.llms,
      [model.id]: modelDefinition,
      default: model.id,
      ...(smallModel
        ? { [smallModel.id]: selectedModelDefinition(smallModel), small: smallModel.id }
        : {})
    }
  };
  const savedKeys = Object.fromEntries(
    Object.entries({ ...props.apiKeys, ...nonEmptySelectedCredentials() })
      .filter(([, value]) => value !== '')
  );
  try {
    const update = Object.keys(savedKeys).length > 0
      ? { config: updatedConfig, apiKeys: savedKeys }
      : { config: updatedConfig };
    await api.updateCurrentConfig(update);
    emit('update:config', updatedConfig);
    emit('update:apiKeys', { ...props.apiKeys, ...savedKeys });
    dialogVisible.value = false;
    await router.push('/session?setup=game');
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : 'Setup could not be saved.';
  } finally {
    saving.value = false;
  }
}

/** Close the wizard unless a save is currently committing configuration. */
function closeWizard(): void {
  if (saving.value) return;
  invalidatePendingWork();
  dialogVisible.value = false;
}

watch(
  () => props.visible,
  visible => {
    if (visible) resetWizard();
    else invalidatePendingWork();
  },
  { immediate: true }
);

watch(
  () => props.apiKeys,
  keys => {
    if (props.visible && currentStep.value === 'path') enteredCredentials.value = { ...keys };
  }
);

onUnmounted(invalidatePendingWork);
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    class="setup-wizard-dialog"
    :closable="!saving"
    :dismissableMask="!saving"
    @hide="closeWizard"
  >
    <template #header>
      <div class="setup-wizard-progress" aria-label="Setup progress">
        <span :aria-current="currentStep === 'path' ? 'step' : undefined">1. Connection</span>
        <span :aria-current="currentStep === 'credentials' ? 'step' : undefined">2. Account</span>
        <span :aria-current="currentStep === 'models' ? 'step' : undefined">3. AI</span>
        <span :aria-current="currentStep === 'confirm' ? 'step' : undefined">4. Confirm</span>
      </div>
    </template>

    <section v-if="currentStep === 'path'" class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>Setup Step 1 of 4 · How will you power your AI opponents?</h3>
        <p>Pick the option that matches what you already have. Nothing is selected for you.</p>
      </div>

      <div class="setup-wizard-choices">
        <div v-for="door in doorOptions" :key="door.value" class="setup-wizard-choice">
          <input
            :id="`setup-door-${door.value}`"
            v-model="selectedDoor"
            type="radio"
            name="setup-door"
            :value="door.value"
            @change="selectDoor(door.value)"
          />
          <label :for="`setup-door-${door.value}`">
            <strong>{{ door.title }}</strong>
          </label>
          <button
            v-if="door.value === 'subscription'"
            type="button"
            class="setup-wizard-info"
            aria-label="About subscriptions"
            v-tooltip.top="'Flat monthly plans from ChatGPT, Claude, etc.'"
          ><i class="pi pi-info-circle" /></button>
          <button
            v-else-if="door.value === 'api'"
            type="button"
            class="setup-wizard-info"
            aria-label="About API accounts"
            v-tooltip.top="'You pay for what you use.'"
          ><i class="pi pi-info-circle" /></button>
          <button
            v-else
            type="button"
            class="setup-wizard-info"
            aria-label="About running AI locally"
            v-tooltip.top="'Run your LLMs locally with llama.cpp, etc.'"
          ><i class="pi pi-info-circle" /></button>
        </div>
      </div>

      <div v-if="selectedDoor && selectedDoor !== 'local'" class="setup-wizard-field">
        <label for="setup-service">Which service do you have?</label>
        <select id="setup-service" v-model="selectedProvider" @change="clearDiscoveryError">
          <option value="" disabled>Choose a service</option>
          <option v-for="service in visibleServiceOptions" :key="service.value" :value="service.value">
            {{ service.label }}
          </option>
        </select>
      </div>
    </section>

    <section v-else-if="currentStep === 'credentials'" class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>Setup Step 2 of 4 · {{ credentialsHeading }}</h3>
        <p v-if="selectedProvider === 'openai-compatible'">
          Start Ollama or LM Studio first, then enter the address it shows.
        </p>
        <p v-else-if="selectedProvider === 'claude-code'">
          Vox Deorum uses a bundled Claude Code runtime with your local Claude Code sign-in. Its static model choices cannot be checked here.
          <a
            href="https://docs.anthropic.com/en/docs/claude-code/getting-started"
            target="_blank"
            rel="noopener noreferrer"
          >Set up Claude Code</a>
        </p>
        <p v-else-if="selectedProvider !== 'codex'">
          Stored only on this PC.
        </p>
      </div>

      <div v-if="selectedProvider === 'codex'" class="setup-wizard-login" aria-live="polite">
        <template v-if="codexState === 'starting' && !codexLogin && !codexError">
          <ProgressSpinner class="setup-wizard-spinner" />
          <p>Preparing ChatGPT sign-in...</p>
        </template>
        <template v-else-if="codexLogin">
          <p>Open the sign-in page and enter this code:</p>
          <strong class="setup-wizard-code">{{ codexLogin.userCode }}</strong>
          <div class="setup-wizard-inline-actions">
            <a :href="codexLogin.verificationUrl" target="_blank" rel="noopener noreferrer" class="p-button">
              Open sign-in page
            </a>
            <Button :label="codeCopied ? 'Copied' : 'Copy code'" icon="pi pi-copy" @click="copyCodexCode" />
          </div>
          <p>Waiting for sign-in. This will continue automatically.</p>
          <p v-if="codexError" class="setup-wizard-error">{{ codexError }}</p>
        </template>
        <template v-else-if="codexError">
          <p class="setup-wizard-error">{{ codexError }}</p>
          <Button label="Retry" icon="pi pi-refresh" @click="retryCodexLogin" />
        </template>
      </div>

      <div v-else class="setup-wizard-credentials">
        <div v-for="field in credentialFields" :key="field.key" class="setup-wizard-field">
          <div class="setup-wizard-label-row">
            <label :for="`setup-${field.key}`">{{ field.label }}</label>
            <a
              v-if="field.helpLink"
              :href="field.helpLink"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="`Help finding ${field.label}`"
            ><i class="pi pi-question-circle" /></a>
            <button
              type="button"
              class="setup-wizard-info"
              aria-label="About keys and costs"
              v-tooltip.top="'A key lets this PC use your account. The service may charge your account based on its plan.'"
            ><i class="pi pi-info-circle" /></button>
          </div>
          <Password
            v-if="field.type === 'password'"
            :id="`setup-${field.key}`"
            :modelValue="enteredCredentials[field.key]"
            toggleMask
            :feedback="false"
            @update:modelValue="updateCredential(field.key, $event ?? '')"
          />
          <InputText
            v-else
            :id="`setup-${field.key}`"
            :modelValue="enteredCredentials[field.key]"
            :placeholder="field.placeholder"
            @update:modelValue="updateCredential(field.key, $event ?? '')"
          />
        </div>
      </div>

      <div v-if="discoveryErrorKind" class="setup-wizard-error-panel" aria-live="polite">
        <strong>We could not check that connection.</strong>
        <p>{{ discoveryStatusCopy }}</p>
      </div>
    </section>

    <section v-else-if="currentStep === 'models'" class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>Setup Step 3 of 4 · Pick the model your AI opponents will use</h3>
        <p>Your account works. Choose the AI Vox Deorum should use by default.</p>
      </div>
      <ModelPickerList v-model="selectedModelId" :models="discoveredModels" />
    </section>

    <section v-else class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>Setup Step 4 of 4 · Ready to play</h3>
        <p>Review these choices before Vox Deorum writes them to this PC.</p>
      </div>
      <div class="setup-wizard-summary">
        <p><strong>Main AI:</strong> {{ selectedModel?.name }} ({{ selectedModel?.id }})</p>
        <p v-if="recommendedSmallModel">
          <strong>Routine AI:</strong> {{ recommendedSmallModel.name }} ({{ recommendedSmallModel.id }}) (summaries and reports)
        </p>
        <p><strong>Account:</strong> {{ selectedProviderLabel }}</p>
        <p>You can change these choices anytime in Settings.</p>
      </div>
      <div v-if="saveError" class="setup-wizard-error-panel" aria-live="polite">
        <strong>Setup was not saved.</strong>
        <p>{{ saveError }}</p>
      </div>
    </section>

    <template #footer>
      <div class="setup-wizard-footer">
        <Button label="Cancel" severity="secondary" :disabled="saving" @click="closeWizard" />
        <div class="setup-wizard-footer-next">
          <Button
            v-if="currentStep !== 'path'"
            label="Back"
            severity="secondary"
            :disabled="saving"
            @click="goBack"
          />
          <Button
            v-if="currentStep === 'path'"
            label="Next"
            :disabled="!canContinueFromPath"
            @click="continueFromPath"
          />
          <Button
            v-else-if="currentStep === 'credentials' && selectedProvider !== 'codex'"
            :label="discoveryErrorKind ? 'Try again' : 'Check and continue'"
            :loading="discoveryPending"
            :disabled="discoveryPending"
            @click="discoverSelectedModels"
          />
          <Button
            v-else-if="currentStep === 'credentials' && discoveryErrorKind"
            label="Try again"
            :loading="discoveryPending"
            :disabled="discoveryPending"
            @click="discoverSelectedModels"
          />
          <Button
            v-else-if="currentStep === 'models'"
            label="Next"
            :disabled="!selectedModel"
            @click="continueFromModels"
          />
          <Button
            v-else-if="currentStep === 'confirm'"
            label="Save & start playing"
            :loading="saving"
            :disabled="saving || !config"
            @click="saveSetup"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>
