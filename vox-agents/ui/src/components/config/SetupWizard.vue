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
import TierChoiceCard, { type TierOption } from '@/components/config/TierChoiceCard.vue';
import { useModelDiscovery } from '@/composables/useModelDiscovery';
import type { DiscoveredModel, LLMConfig, VoxAgentsConfig } from '@/utils/types';

type SetupStep = 'path' | 'credentials' | 'models' | 'helpers' | 'judge' | 'confirm';
type SetupDoor = 'subscription' | 'api' | 'local';

/** A tier card answer: a preset value, or 'custom' with a model picked from the full list. */
interface TierChoice {
  choice: string;
  customId: string;
}

/** Judge value that leaves an already configured evaluator in place. */
const keepJudge = 'keep';

const stepLabels: Record<SetupStep, string> = {
  path: 'Connection',
  credentials: 'Account',
  models: 'Main AI',
  helpers: 'Helpers',
  judge: 'Judge',
  confirm: 'Confirm'
};

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
  recommendedDefaultModel,
  recommendedSmallModel,
  recommendedLargeModel,
  discoveryStatusCopy,
  findModel,
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

const quickChoice = ref<TierChoice>({ choice: '', customId: '' });
const deepChoice = ref<TierChoice>({ choice: '', customId: '' });
const judgeChoice = ref<TierChoice>({ choice: '', customId: '' });

/** Turn a card answer into a model ID, or '' when the card saves no model. */
function resolveChoice({ choice, customId }: TierChoice): string {
  return choice === 'custom' ? customId : choice;
}

/** A card is complete unless the player opened the full list without picking a model. */
function choiceComplete({ choice, customId }: TierChoice): boolean {
  return choice !== 'custom' || customId !== '';
}

const quickModelId = computed(() => resolveChoice(quickChoice.value));
const deepModelId = computed(() => resolveChoice(deepChoice.value));
const judgeModelId = computed(() => resolveChoice(judgeChoice.value));

/** Helpers are only reached through a judge routing work between tiers, so they follow one. */
const hasJudge = computed(() => judgeChoice.value.choice !== '' && choiceComplete(judgeChoice.value));

/** The evaluator already saved on this PC, if any. */
const existingJudge = computed(() => props.config?.llms.evaluator);

/** Visible steps in order; the helpers step only appears once a judge is chosen. */
const steps = computed<SetupStep[]>(() => [
  'path', 'credentials', 'models', 'judge', ...(hasJudge.value ? ['helpers' as const] : []), 'confirm'
]);

/** Heading prefix such as "Setup Step 3 of 6". */
function stepPrefix(step: SetupStep): string {
  return `Setup Step ${steps.value.indexOf(step) + 1} of ${steps.value.length}`;
}

/** Show a model by its display name, falling back to its ID. */
function modelName(id: string): string {
  return findModel(id)?.name ?? id;
}

/** Describe the configured evaluator for the keep option and the summary. */
const existingJudgeLabel = computed(() => {
  const judge = existingJudge.value;
  if (judge === undefined) return '';
  return typeof judge === 'string' ? judge : `${judge.provider}/${judge.name}`;
});

/** Quick AI presets: the service's routine pick (when known), then the Main AI. */
const quickOptions = computed<TierOption[]>(() => [
  ...(recommendedSmallModel.value
    ? [{ value: recommendedSmallModel.value.id, label: recommendedSmallModel.value.name, detail: recommendedSmallModel.value.id, badge: 'Recommended' }]
    : []),
  { value: '', label: 'Same as Main AI', detail: selectedModel.value?.name }
]);

/** Deep AI presets: the service's high-stakes pick (when known), then the Main AI. */
const deepOptions = computed<TierOption[]>(() => [
  ...(recommendedLargeModel.value
    ? [{ value: recommendedLargeModel.value.id, label: recommendedLargeModel.value.name, detail: recommendedLargeModel.value.id, badge: 'Recommended' }]
    : []),
  { value: '', label: 'Same as Main AI', detail: selectedModel.value?.name }
]);

/** Judge presets: none by default, then keeping a configured judge or using the Main AI. Nothing is recommended. */
const judgeOptions = computed<TierOption[]>(() => [
  { value: '', label: 'No judge', detail: 'The Main AI handles everything.' },
  ...(existingJudge.value !== undefined
    ? [{ value: keepJudge, label: 'Keep current judge', detail: existingJudgeLabel.value }]
    : []),
  ...(selectedModel.value
    ? [{ value: selectedModel.value.id, label: 'Main AI', detail: selectedModel.value.name }]
    : [])
]);

/** Name what the judge card saved, for the summary. */
const judgeSummary = computed(() => {
  if (judgeChoice.value.choice === keepJudge) return existingJudgeLabel.value;
  return judgeModelId.value ? modelName(judgeModelId.value) : 'None';
});

/** Name what a tier card saved, for the summary. */
function tierSummary(modelId: string): string {
  return modelId ? modelName(modelId) : 'Same as Main AI';
}

/** Summary rows for the confirm step; helper rows only appear alongside a judge. */
const summaryRows = computed(() => [
  { icon: 'pi pi-star', label: 'Main AI', value: selectedModel.value?.name ?? '', role: 'most decisions' },
  { icon: 'pi pi-sitemap', label: 'Judge AI', value: judgeSummary.value, role: 'picks the AI for each moment' },
  ...(hasJudge.value
    ? [
        { icon: 'pi pi-bolt', label: 'Quick AI', value: tierSummary(quickModelId.value), role: 'small jobs' },
        { icon: 'pi pi-lightbulb', label: 'Deep AI', value: tierSummary(deepModelId.value), role: 'big moments' }
      ]
    : []),
  { icon: 'pi pi-user', label: 'Account', value: selectedProviderLabel.value, role: '' }
]);

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
  } else if (currentStep.value === 'judge') {
    currentStep.value = 'models';
  } else if (currentStep.value === 'helpers') {
    currentStep.value = 'judge';
  } else if (currentStep.value === 'confirm') {
    currentStep.value = hasJudge.value ? 'helpers' : 'judge';
  }
  clearDiscoveryError();
}

/** Advance from the Main AI to the optional judge, which starts at none. */
function continueFromModels(): void {
  if (!selectedModel.value) return;
  judgeChoice.value = { choice: '', customId: '' };
  currentStep.value = 'judge';
}

/** Advance from the judge to the helpers when one is set, starting from the service's picks. */
function continueFromJudge(): void {
  if (!choiceComplete(judgeChoice.value)) return;
  saveError.value = '';
  if (!hasJudge.value) {
    currentStep.value = 'confirm';
    return;
  }
  quickChoice.value = { choice: recommendedSmallModel.value?.id ?? '', customId: '' };
  deepChoice.value = { choice: recommendedLargeModel.value?.id ?? '', customId: '' };
  currentStep.value = 'helpers';
}

/** Advance from the helpers to the save summary. */
function continueFromHelpers(): void {
  if (!choiceComplete(quickChoice.value) || !choiceComplete(deepChoice.value)) return;
  currentStep.value = 'confirm';
}

/** Skip the helpers so the Main AI does everything the judge would hand off. */
function skipHelpers(): void {
  quickChoice.value = { choice: '', customId: '' };
  deepChoice.value = { choice: '', customId: '' };
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

/** Build the saved model entries: the Main AI, the judge, and the tier aliases a judge routes to. */
function buildSetupLlms(config: VoxAgentsConfig, mainId: string): VoxAgentsConfig['llms'] {
  const llms = { ...config.llms };
  /** Add a discovered model's definition; configured aliases are already present. */
  const addModel = (id: string): void => {
    const model = findModel(id);
    if (model) llms[id] = selectedModelDefinition(model);
  };
  /** Point a tier alias at its model, or drop it so the tier uses the Main AI. */
  const setAlias = (alias: 'small' | 'large', id: string): void => {
    if (!id) {
      delete llms[alias];
      return;
    }
    addModel(id);
    llms[alias] = id;
  };

  addModel(mainId);
  llms.default = mainId;
  if (judgeChoice.value.choice !== keepJudge) {
    if (judgeModelId.value) {
      addModel(judgeModelId.value);
      llms.evaluator = judgeModelId.value;
    } else {
      delete llms.evaluator;
    }
  }
  setAlias('small', hasJudge.value ? quickModelId.value : '');
  setAlias('large', hasJudge.value ? deepModelId.value : '');
  return llms;
}

/** Save the selected models while retaining all existing configuration and model entries. */
async function saveSetup(): Promise<void> {
  const model = selectedModel.value;
  if (!props.config || !model || saving.value) return;
  saving.value = true;
  saveError.value = '';
  const updatedConfig: VoxAgentsConfig = {
    ...props.config,
    llms: buildSetupLlms(props.config, model.id)
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
        <span
          v-for="(step, index) in steps"
          :key="step"
          :aria-current="currentStep === step ? 'step' : undefined"
        >{{ index + 1 }}. {{ stepLabels[step] }}<small v-if="step === 'judge'">optional</small></span>
      </div>
    </template>

    <section v-if="currentStep === 'path'" class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>{{ stepPrefix('path') }} · How will you power your AI opponents?</h3>
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
        <h3>{{ stepPrefix('credentials') }} · {{ credentialsHeading }}</h3>
        <p v-if="selectedProvider === 'openai-compatible'">
          Start Ollama or LM Studio first, then enter the address it shows.
        </p>
        <p v-else-if="selectedProvider === 'claude-code'">
          Vox Deorum lists the models available to your local Claude Code sign-in, then recommends Sonnet for the main job and Haiku for routine work.
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
        <h3>{{ stepPrefix('models') }} · Pick your Main AI</h3>
        <p>It makes most of your rivals' decisions, so choose the best one you're happy to run.</p>
      </div>
      <ModelPickerList
        v-model="selectedModelId"
        :models="discoveredModels"
        :recommendedId="recommendedDefaultModel?.id"
      />
    </section>

    <section v-else-if="currentStep === 'judge'" class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>{{ stepPrefix('judge') }} · Add a Judge AI? (optional, experimental)</h3>
        <p>A judge sizes up each moment and hands it to a quicker or deeper AI. We are still testing how well this works.</p>
      </div>
      <TierChoiceCard
        v-model:choice="judgeChoice.choice"
        v-model:customId="judgeChoice.customId"
        name="setup-judge"
        icon="pi pi-sitemap"
        title="Judge AI"
        purpose="Decides which AI handles each moment"
        traits="experimental"
        :options="judgeOptions"
        :models="discoveredModels"
      />
    </section>

    <section v-else-if="currentStep === 'helpers'" class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>{{ stepPrefix('helpers') }} · Pick the AIs your judge hands work to</h3>
        <p>Your judge sends small jobs to the Quick AI and big moments to the Deep AI.</p>
      </div>
      <div class="setup-tier-ladder" aria-hidden="true">
        <span><i class="pi pi-bolt" /> Quick AI<small>small jobs</small></span>
        <i class="pi pi-arrow-left" />
        <span class="setup-tier-ladder-main"><i class="pi pi-star" /> Main AI<small>{{ selectedModel?.name }}</small></span>
        <i class="pi pi-arrow-right" />
        <span><i class="pi pi-lightbulb" /> Deep AI<small>big moments</small></span>
      </div>
      <div class="setup-tier-cards">
        <TierChoiceCard
          v-model:choice="quickChoice.choice"
          v-model:customId="quickChoice.customId"
          name="setup-quick"
          icon="pi pi-bolt"
          title="Quick AI"
          purpose="Reports, summaries, and small talk"
          traits="cheaper · faster"
          :options="quickOptions"
          :models="discoveredModels"
        />
        <TierChoiceCard
          v-model:choice="deepChoice.choice"
          v-model:customId="deepChoice.customId"
          name="setup-deep"
          icon="pi pi-lightbulb"
          title="Deep AI"
          purpose="War, peace, and major deals"
          traits="smarter · slower · pricier"
          :options="deepOptions"
          :models="discoveredModels"
        />
      </div>
    </section>

    <section v-else class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>{{ stepPrefix('confirm') }} · Ready to play</h3>
        <p>Review these choices before Vox Deorum writes them to this PC.</p>
      </div>
      <div class="setup-wizard-summary">
        <dl class="setup-wizard-tiers">
          <div v-for="row in summaryRows" :key="row.label" class="setup-wizard-tier-row">
            <dt><i :class="row.icon" /> {{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
            <dd class="setup-wizard-tier-role">{{ row.role }}</dd>
          </div>
        </dl>
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
          <template v-else-if="currentStep === 'helpers'">
            <Button label="Skip: use Main AI for both" severity="secondary" @click="skipHelpers" />
            <Button
              label="Next"
              :disabled="!choiceComplete(quickChoice) || !choiceComplete(deepChoice)"
              @click="continueFromHelpers"
            />
          </template>
          <Button
            v-else-if="currentStep === 'judge'"
            label="Next"
            :disabled="!choiceComplete(judgeChoice)"
            @click="continueFromJudge"
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
