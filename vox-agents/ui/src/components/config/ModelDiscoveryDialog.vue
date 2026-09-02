<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Dropdown from 'primevue/dropdown';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import ModelPickerList from '@/components/config/ModelPickerList.vue';
import { useModelDiscovery } from '@/composables/useModelDiscovery';
import type { DiscoveredModel } from '@/utils/types';
import { llmProviders } from '@/utils/types';

type DiscoveryPhase = 'connect' | 'pick';

interface Props {
  visible: boolean;
  apiKeys: Record<string, string>;
}

interface Emits {
  (event: 'update:visible', value: boolean): void;
  (event: 'select', model: DiscoveredModel): void;
  (event: 'update:apiKeys', value: Record<string, string>): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const {
  selectedProvider,
  enteredCredentials,
  discoveredModels,
  selectedModelId,
  discoveryPending,
  discoveryErrorKind,
  credentialFields,
  selectedModel,
  discoveryStatusCopy,
  updateCredential,
  clearDiscoveryError,
  nonEmptySelectedCredentials,
  discover,
  reset,
  invalidate
} = useModelDiscovery({ isActive: () => props.visible });
const phase = ref<DiscoveryPhase>('connect');

/** AWS is excluded because server discovery is unsupported. */
const providerOptions = computed(() => llmProviders.filter(provider => provider.value !== 'aws'));

/** Invalidate stale checks and clear feedback when the user chooses a different service. */
function selectProvider(): void {
  if (selectedProvider.value === 'openai-compatible' && !enteredCredentials.value.OPENAI_COMPATIBLE_URL) {
    updateCredential('OPENAI_COMPATIBLE_URL', 'http://127.0.0.1:11434');
    return;
  }
  invalidate();
  clearDiscoveryError();
}

/** Check the selected service and advance only after a successful discovery. */
async function checkConnection(): Promise<void> {
  if (await discover()) phase.value = 'pick';
}

/** Return to connection details while retaining the current credential draft. */
function returnToConnection(): void {
  phase.value = 'connect';
}

/** Add the selected model and retain only credentials entered for this service. */
function addModel(): void {
  const model = selectedModel.value;
  if (!model) return;
  const credentials = nonEmptySelectedCredentials();
  if (Object.keys(credentials).length > 0) emit('update:apiKeys', { ...props.apiKeys, ...credentials });
  emit('select', model);
  closeDialog();
}

/** Close the dialog and invalidate a model discovery request that may still be pending. */
function closeDialog(): void {
  invalidate();
  emit('update:visible', false);
}

/** Forward PrimeVue visibility changes to the parent while cancelling closed work. */
function updateVisibility(visible: boolean): void {
  if (!visible) invalidate();
  emit('update:visible', visible);
}

watch(
  () => props.visible,
  visible => {
    if (visible) {
      phase.value = 'connect';
      reset({ ...props.apiKeys });
    } else {
      invalidate();
    }
  },
  { immediate: true }
);

onUnmounted(invalidate);
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    class="model-discovery-dialog"
    header="Add AI model"
    @update:visible="updateVisibility"
  >
    <section v-if="phase === 'connect'" class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>Connect a service</h3>
        <p>Choose the account or local service that can provide this model.</p>
      </div>

      <div class="setup-wizard-field">
        <label for="model-discovery-provider">Service</label>
        <Dropdown
          id="model-discovery-provider"
          v-model="selectedProvider"
          :options="providerOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Choose a service"
          @update:modelValue="selectProvider"
        />
      </div>

      <p v-if="selectedProvider === 'codex'" class="text-muted">
        Vox Deorum uses the ChatGPT account already configured on this PC.
      </p>
      <p v-else-if="selectedProvider === 'claude-code'" class="text-muted">
        Vox Deorum lists the models available to your local Claude Code sign-in. If the list is empty, check that Claude Code is installed and signed in.
      </p>

      <div class="setup-wizard-credentials">
        <div v-for="field in credentialFields" :key="field.key" class="setup-wizard-field">
          <div class="setup-wizard-label-row">
            <label :for="`model-discovery-${field.key}`">{{ field.label }}</label>
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
            :id="`model-discovery-${field.key}`"
            :modelValue="enteredCredentials[field.key]"
            toggleMask
            :feedback="false"
            @update:modelValue="updateCredential(field.key, $event ?? '')"
          />
          <InputText
            v-else
            :id="`model-discovery-${field.key}`"
            :modelValue="enteredCredentials[field.key]"
            :placeholder="field.placeholder"
            @update:modelValue="updateCredential(field.key, $event ?? '')"
          />
        </div>
      </div>

      <div v-if="discoveryErrorKind" class="setup-wizard-error-panel" aria-live="polite">
        <strong>We could not check that connection.</strong>
        <p>{{ discoveryStatusCopy }}</p>
        <p v-if="selectedProvider === 'codex'" class="text-muted">
          Run Setup wizard first to sign in with ChatGPT.
        </p>
        <p v-if="selectedProvider === 'claude-code'" class="text-muted">
          Check that you are signed in to Claude Code, then try again.
        </p>
      </div>
    </section>

    <section v-else class="setup-wizard-step">
      <div class="setup-wizard-heading">
        <h3>Pick a model</h3>
        <p>Your account works. Choose the AI model to add.</p>
      </div>
      <ModelPickerList v-model="selectedModelId" :models="discoveredModels" />
    </section>

    <template #footer>
      <div class="setup-wizard-footer">
        <Button label="Cancel" severity="secondary" @click="closeDialog" />
        <div class="setup-wizard-footer-next">
          <Button
            v-if="phase === 'connect'"
            label="Check and continue"
            :loading="discoveryPending"
            :disabled="!selectedProvider || discoveryPending"
            @click="checkConnection"
          />
          <template v-else>
            <Button label="Back" severity="secondary" @click="returnToConnection" />
            <Button label="Add model" :disabled="!selectedModel" @click="addModel" />
          </template>
        </div>
      </div>
    </template>
  </Dialog>
</template>
