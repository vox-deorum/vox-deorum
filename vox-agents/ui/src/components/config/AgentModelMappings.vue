<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import Dropdown from 'primevue/dropdown';
import type { AgentMapping } from '@/utils/types';

type SelectOption = { label: string; value: string };

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
}>();

/** Add a mapping using the first available agent and model choices. */
function addMapping(): void {
  emit('update:mappings', [...props.mappings, {
    agent: props.agentTypes[0]?.value || 'default',
    model: props.availableModels[0]?.value || ''
  }]);
}

/** Replace one mapping without mutating the route-owned array. */
function updateMapping(index: number, patch: Partial<AgentMapping>): void {
  emit('update:mappings', props.mappings.map((mapping, current) => current === index ? { ...mapping, ...patch } : mapping));
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
      <Button label="Add Mapping" icon="pi pi-plus" text size="small" style="margin-left: auto"
        :disabled="availableModels.length === 0" @click="addMapping" />
    </template>
    <template #subtitle>If you need to use other models, add model configurations below.</template>
    <template #content>
      <div class="mappings-list">
        <div v-for="(mapping, index) in mappings" :key="index" class="field-row">
          <Dropdown :modelValue="mapping.agent" :options="agentTypes" optionLabel="label" optionValue="value"
            placeholder="Select agent type" class="agent-input" @update:modelValue="updateMapping(index, { agent: $event })" />
          <Dropdown :modelValue="mapping.model" :options="availableModels" optionLabel="label" optionValue="value"
            placeholder="Select model" class="model-dropdown" :disabled="availableModels.length === 0"
            @update:modelValue="updateMapping(index, { model: $event })" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" @click="deleteMapping(index)" />
        </div>
        <div class="field-row">
          <span class="agent-input embedder-label">Embedder</span>
          <Dropdown :modelValue="embedderModel" :options="embeddingModels" optionLabel="label" optionValue="value"
            placeholder="No embedding model" showClear class="model-dropdown" @update:modelValue="$emit('update:embedderModel', $event)" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" style="visibility: hidden" aria-hidden="true" tabindex="-1" />
        </div>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.embedder-label { align-items: center; color: var(--p-text-muted-color); display: flex; font-size: 0.875rem; font-weight: 500; padding: 0.5rem 0.75rem; }
</style>
