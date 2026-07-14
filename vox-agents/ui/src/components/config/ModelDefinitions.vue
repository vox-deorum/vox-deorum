<script setup lang="ts">
import Button from 'primevue/button';
import Card from 'primevue/card';
import Dropdown from 'primevue/dropdown';
import InputText from 'primevue/inputtext';
import type { LLMConfig } from '@/utils/types';
import { llmProviders } from '@/utils/types';
import { updateModelId } from '@/utils/config-utils';

const props = defineProps<{ models: LLMConfig[] }>();
const emit = defineEmits<{
  'update:models': [value: LLMConfig[]];
  'open-options': [model: LLMConfig];
  'delete-model': [modelIndex: number];
}>();

/** Add a blank OpenRouter model definition. */
function addModel(): void {
  emit('update:models', [...props.models, { id: '', provider: 'openrouter', name: '', options: {} }]);
}

/** Replace one model and keep its derived identifier synchronized. */
function updateModel(index: number, patch: Partial<LLMConfig>): void {
  const models = props.models.map((model, current) => {
    if (current !== index) return model;
    const updated = { ...model, ...patch };
    updateModelId(updated);
    return updated;
  });
  emit('update:models', models);
}

/** Duplicate a model with a unique generated name. */
function duplicateModel(model: LLMConfig): void {
  const existingIds = new Set(props.models.map(item => item.id));
  let newName = model.name;
  let suffix = 2;
  while (existingIds.has(`${model.provider}/${newName}`)) {
    newName = `${model.name}-${suffix}`;
    suffix++;
  }
  emit('update:models', [...props.models, {
    ...model,
    options: { ...model.options },
    name: newName,
    id: `${model.provider}/${newName}`
  }]);
}

/** Return whether the model has any non-default options. */
function hasModelOptions(model: LLMConfig): boolean {
  if (!model.options) return false;
  return Object.values(model.options).some(value => value !== null && value !== undefined && value !== '' && value !== false);
}

/** Return a compact tooltip summary of configured options. */
function modelOptionsSummary(model: LLMConfig): string {
  if (!hasModelOptions(model)) return 'Model options';
  const options = model.options!;
  const parts: string[] = [];
  if (options.toolMiddleware) parts.push(`Tool: ${options.toolMiddleware}`);
  if (options.reasoningEffort) parts.push(`Reasoning: ${options.reasoningEffort}`);
  if (options.thinkMiddleware) parts.push('Think tag postprocessing: on');
  if (options.concurrencyLimit != null) parts.push(`Concurrency: ${options.concurrencyLimit}`);
  if (options.systemPromptFirst) parts.push('Sys first: on');
  if (options.embeddingSize) parts.push(`Embedding: ${options.embeddingSize}d`);
  return parts.join(' | ');
}
</script>

<template>
  <Card class="config-card">
    <template #title>
      <i class="pi pi-box" /> Model Configurations
      <Button label="Add Model" icon="pi pi-plus" text size="small" style="margin-left: auto" @click="addModel" />
    </template>
    <template #subtitle>Make sure to configure API keys above for providers you want to use</template>
    <template #content>
      <div class="models-list">
        <div v-for="(model, index) in models" :key="index" class="field-row">
          <Dropdown :modelValue="model.provider" :options="llmProviders" optionLabel="label" optionValue="value"
            placeholder="Select provider" class="provider-dropdown" @update:modelValue="updateModel(index, { provider: $event })" />
          <InputText :modelValue="model.name" placeholder="Model name" class="model-name"
            @update:modelValue="updateModel(index, { name: $event })" />
          <Button icon="pi pi-sliders-h" text :severity="hasModelOptions(model) ? 'info' : 'secondary'"
            v-tooltip.top="modelOptionsSummary(model)" class="delete-btn" @click="$emit('open-options', model)" />
          <Button icon="pi pi-copy" text severity="secondary" v-tooltip.top="'Duplicate model'"
            class="delete-btn" @click="duplicateModel(model)" />
          <Button icon="pi pi-trash" text severity="danger" class="delete-btn" @click="$emit('delete-model', index)" />
        </div>
      </div>
    </template>
  </Card>
</template>
