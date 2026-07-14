<script setup lang="ts">
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import { apiKeyFields } from '@/utils/types';

const props = defineProps<{ modelValue: Record<string, string> }>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>();

/** Update one API key without mutating the route-owned object. */
function updateKey(key: string, value: string): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}
</script>

<template>
  <Card class="config-card">
    <template #title><i class="pi pi-key" /> LLM API Keys</template>
    <template #subtitle>You would need them to play with LLMs. API keys are stored locally and never uploaded</template>
    <template #content>
      <table class="api-keys-table">
        <tbody>
          <tr v-for="field in apiKeyFields" :key="field.key">
            <td class="label-cell">
              <label :for="field.key">{{ field.label }}</label>
              <a v-if="field.helpLink" :href="field.helpLink" target="_blank" rel="noopener noreferrer"
                class="help-link" v-tooltip.top="field.helpTooltip"><i class="pi pi-question-circle" /></a>
              <span v-else-if="field.helpTooltip" class="help-icon" v-tooltip.top="field.helpTooltip"><i class="pi pi-question-circle" /></span>
            </td>
            <td class="input-cell">
              <Password v-if="field.type === 'password'" :id="field.key" :modelValue="modelValue[field.key]"
                inputClass="password-field" :placeholder="`Enter ${field.label}`" toggleMask :feedback="false"
                @update:modelValue="updateKey(field.key, $event ?? '')" />
              <InputText v-else :id="field.key" :modelValue="modelValue[field.key]"
                :placeholder="field.placeholder || `Enter ${field.label}`" @update:modelValue="updateKey(field.key, $event ?? '')" />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </Card>
</template>

<style scoped>
.api-keys-table { vertical-align: middle; width: 100%; }
.api-keys-table .label-cell { font-size: 0.875rem; padding-right: 1rem; white-space: nowrap; }
.api-keys-table .label-cell label { margin-right: 0.5rem; }
.api-keys-table .help-link, .api-keys-table .help-icon { color: var(--p-text-muted-color); font-size: 0.875rem; transition: color 0.2s; vertical-align: middle; }
.api-keys-table .help-link:hover { color: var(--p-primary-color); }
.api-keys-table .input-cell input, .api-keys-table .input-cell :deep(.p-password input), .api-keys-table .input-cell :deep(.p-inputtext) { width: 28rem !important; }
</style>
