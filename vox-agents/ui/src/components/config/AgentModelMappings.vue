<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Dropdown from 'primevue/dropdown';
import type { AgentMapping, ModelSize, SelectOption } from '@/utils/types';

const MORE_MODELS = '__more-models__';

/** Dedicated tier rows rendered above the free-form mapping rows. */
const tierRows: Array<{ tier: ModelSize; label: string }> = [
  { tier: 'default', label: 'Main AI' },
  { tier: 'small', label: 'Quick AI' },
  { tier: 'large', label: 'Deep AI' }
];

const props = defineProps<{
  mappings: AgentMapping[];
  agentTypes: SelectOption[];
  availableModels: SelectOption[];
  embeddingModels: SelectOption[];
  embedderModel: string | null;
  evaluationModels: SelectOption[];
  evaluatorModel: string | null;
  tierModels: Record<ModelSize, string | null>;
}>();
const emit = defineEmits<{
  'update:mappings': [value: AgentMapping[]];
  'update:embedderModel': [value: string | null];
  'update:evaluatorModel': [value: string | null];
  'update:tierModel': [tier: ModelSize, value: string | null];
  'discover-model': [index: number];
  'discover-embedder': [];
  'discover-evaluator': [];
  'discover-tier': [tier: ModelSize];
}>();

/** Add the model discovery action after every configured chat model. */
const modelOptions = computed(() => [
  ...props.availableModels,
  { label: 'More...', value: MORE_MODELS }
]);

/** Add the model discovery action after every configured embedding model. */
const embedderOptions = computed(() => [
  ...props.embeddingModels,
  { label: 'More...', value: MORE_MODELS }
]);

/** Add the model discovery action after every evaluator-capable model. */
const evaluatorOptions = computed(() => [
  ...props.evaluationModels,
  { label: 'More...', value: MORE_MODELS }
]);

/** Offer evaluation-capable choices to agent-specific evaluator rows and chat choices to the rest. */
function modelOptionsForMapping(mapping: AgentMapping): SelectOption[] {
  return mapping.agent.endsWith('.evaluator') ? evaluatorOptions.value : modelOptions.value;
}

/** Add a mapping using the first available agent and model choices. */
function addMapping(): void {
  emit('update:mappings', [...props.mappings, {
    agent: props.agentTypes[0]?.value || '',
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

/** Update the selected evaluator or open model discovery for the More option. */
function updateEvaluator(value: string | null): void {
  if (value === MORE_MODELS) {
    emit('discover-evaluator');
    return;
  }
  emit('update:evaluatorModel', value);
}

/** Update one tier alias or open model discovery for the More option. */
function updateTier(tier: ModelSize, value: string | null): void {
  if (value === MORE_MODELS) {
    emit('discover-tier', tier);
    return;
  }
  emit('update:tierModel', tier, value);
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
    <template #subtitle>Main AI makes most decisions. Quick AI takes small jobs and Deep AI takes big moments; both use Main AI when empty.</template>
    <template #content>
      <div class="mappings-list">
        <div v-for="row in tierRows" :key="row.tier" class="field-row">
          <span class="mapping-label">{{ row.label }}</span>
          <Dropdown :modelValue="tierModels[row.tier]" :options="modelOptions" optionLabel="label" optionValue="value"
            :placeholder="row.tier === 'default' ? 'Select model' : 'Same as Main AI'"
            :showClear="row.tier !== 'default'" class="model-dropdown"
            @update:modelValue="updateTier(row.tier, $event)" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" style="visibility: hidden" aria-hidden="true" tabindex="-1" />
        </div>
        <div v-for="(mapping, index) in mappings" :key="index" class="field-row">
          <Dropdown :modelValue="mapping.agent" :options="agentTypes" optionLabel="label" optionValue="value"
            placeholder="Select agent type" class="agent-input" @update:modelValue="updateMapping(index, { agent: $event })" />
          <Dropdown :modelValue="mapping.model" :options="modelOptionsForMapping(mapping)" optionLabel="label" optionValue="value"
            placeholder="Select model" class="model-dropdown"
            @update:modelValue="updateMapping(index, { model: $event })" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" @click="deleteMapping(index)" />
        </div>
        <div class="field-row">
          <span class="mapping-label">Embedder</span>
          <Dropdown :modelValue="embedderModel" :options="embedderOptions" optionLabel="label" optionValue="value"
            placeholder="No embedding model" showClear class="model-dropdown" @update:modelValue="updateEmbedder" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" style="visibility: hidden" aria-hidden="true" tabindex="-1" />
        </div>
        <div class="field-row">
          <span class="mapping-label">Judge AI</span>
          <Dropdown :modelValue="evaluatorModel" :options="evaluatorOptions" optionLabel="label" optionValue="value"
            placeholder="No judge" showClear class="model-dropdown" @update:modelValue="updateEvaluator" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" style="visibility: hidden" aria-hidden="true" tabindex="-1" />
        </div>
      </div>
    </template>
  </Card>
</template>
