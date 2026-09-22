<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Dropdown from 'primevue/dropdown';
import type { AgentMapping, SelectOption } from '@/utils/types';

const MORE_MODELS = '__more-models__';

const props = defineProps<{
  mappings: AgentMapping[];
  agentTypes: SelectOption[];
  availableModels: SelectOption[];
  embeddingModels: SelectOption[];
  embedderModel: string | null;
}>();
const emit = defineEmits<{
  'update:mappings': [value: AgentMapping[]];
  'update:embedderModel': [value: string | null];
  'discover-model': [index: number];
  'discover-embedder': [];
}>();

/** Add the model discovery action after every configured chat model. */
const modelOptions = computed(() => [
  ...props.availableModels,
  { label: 'More...', value: MORE_MODELS }
]);

/** Keep an evaluator's current assignment visible without offering it to chat agents. */
function modelOptionsForMapping(mapping: AgentMapping): SelectOption[] {
  const isEvaluator = mapping.agent === 'evaluator' || mapping.agent.endsWith('.evaluator');
  if (isEvaluator && mapping.model && !modelOptions.value.some(option => option.value === mapping.model)) {
    return [{ label: mapping.model, value: mapping.model }, ...modelOptions.value];
  }
  return modelOptions.value;
}

/** Add the model discovery action after every configured embedding model. */
const embedderOptions = computed(() => [
  ...props.embeddingModels,
  { label: 'More...', value: MORE_MODELS }
]);

/** Add a mapping using the first available agent and model choices. */
function addMapping(): void {
  emit('update:mappings', [...props.mappings, {
    agent: props.agentTypes[0]?.value || 'default',
    model: props.availableModels[0]?.value || ''
  }]);
}

/** Replace one mapping without mutating the route-owned array. */
function updateMapping(index: number, patch: Partial<AgentMapping>): void {
  if (patch.model === MORE_MODELS) {
    emit('discover-model', index);
    return;
  }
  emit('update:mappings', props.mappings.map((mapping, current) => current === index ? { ...mapping, ...patch } : mapping));
}

/** Update the selected embedder or open model discovery for the More option. */
function updateEmbedder(value: string | null): void {
  if (value === MORE_MODELS) {
    emit('discover-embedder');
    return;
  }
  emit('update:embedderModel', value);
}

/** Remove one mapping by its visible index. */
function deleteMapping(index: number): void {
  emit('update:mappings', props.mappings.filter((_, current) => current !== index));
}
</script>

<template>
  <Card class="config-card">
    <template #title>
      <i class="pi pi-link" /> Agent-Model Assignments
      <Button label="Add Mapping" icon="pi pi-plus" text size="small" style="margin-left: auto" @click="addMapping" />
    </template>
    <template #subtitle>If you need to use other models, add model configurations below.</template>
    <template #content>
      <div class="mappings-list">
        <div v-for="(mapping, index) in mappings" :key="index" class="field-row">
          <Dropdown :modelValue="mapping.agent" :options="agentTypes" optionLabel="label" optionValue="value"
            placeholder="Select agent type" class="agent-input" @update:modelValue="updateMapping(index, { agent: $event })" />
          <Dropdown :modelValue="mapping.model" :options="modelOptionsForMapping(mapping)" optionLabel="label" optionValue="value"
            placeholder="Select model" class="model-dropdown"
            @update:modelValue="updateMapping(index, { model: $event })" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" @click="deleteMapping(index)" />
        </div>
        <div class="field-row">
          <span class="agent-input embedder-label">Embedder</span>
          <Dropdown :modelValue="embedderModel" :options="embedderOptions" optionLabel="label" optionValue="value"
            placeholder="No embedding model" showClear class="model-dropdown" @update:modelValue="updateEmbedder" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" style="visibility: hidden" aria-hidden="true" tabindex="-1" />
        </div>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.embedder-label { align-items: center; color: var(--p-text-muted-color); display: flex; font-size: 0.875rem; font-weight: 500; padding: 0.5rem 0.75rem; }
</style>
