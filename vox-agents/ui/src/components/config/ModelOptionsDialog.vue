<script setup lang="ts">
/**
 * Dialog component for editing advanced model options.
 * Handles all LLMConfig options: toolMiddleware, reasoningEffort,
 * thinkMiddleware, concurrencyLimit, systemPromptFirst, and embeddingSize.
 */
import { ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Dropdown from 'primevue/dropdown';
import InputNumber from 'primevue/inputnumber';
import Checkbox from 'primevue/checkbox';
import Button from 'primevue/button';
import type { LLMConfig, ToolMiddlewareType } from '@/utils/types';
import { toolMiddlewareOptions } from '@/utils/types';

const props = defineProps<{
  visible: boolean;
  model: LLMConfig | null;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'apply': [options: LLMConfig['options']];
}>();

const reasoningEffortOptions = [
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
];

// Local editing state — initialized when dialog opens
const localToolMiddleware = ref<ToolMiddlewareType | null>(null);
const localReasoningEffort = ref<string | null>(null);
const localThinkMiddleware = ref(false);
const localConcurrencyLimit = ref<number | null>(null);
const localSystemPromptFirst = ref(false);
const localEmbeddingSize = ref<number | null>(null);

// Sync from model props when dialog becomes visible
watch(() => props.visible, (visible) => {
  if (visible && props.model) {
    const opts = props.model.options ?? {};
    localToolMiddleware.value = opts.toolMiddleware ?? null;
    localReasoningEffort.value = opts.reasoningEffort ?? null;
    localThinkMiddleware.value = !!opts.thinkMiddleware;
    localConcurrencyLimit.value = opts.concurrencyLimit ?? null;
    localSystemPromptFirst.value = opts.systemPromptFirst ?? false;
    localEmbeddingSize.value = opts.embeddingSize ?? null;
  }
});

/** Collect non-default values and emit to parent */
function handleApply() {
  const options: Record<string, unknown> = {};
  if (localToolMiddleware.value != null) options.toolMiddleware = localToolMiddleware.value;
  if (localReasoningEffort.value != null) options.reasoningEffort = localReasoningEffort.value;
  if (localThinkMiddleware.value) options.thinkMiddleware = 'think';
  if (localConcurrencyLimit.value != null) options.concurrencyLimit = localConcurrencyLimit.value;
  if (localSystemPromptFirst.value) options.systemPromptFirst = true;
  if (localEmbeddingSize.value != null) options.embeddingSize = localEmbeddingSize.value;

  emit('apply', Object.keys(options).length > 0 ? (options as LLMConfig['options']) : undefined);
  emit('update:visible', false);
}

function handleClose() {
  emit('update:visible', false);
}
</script>

<template>
  <Dialog
    :visible="visible"
    :header="model ? `Options: ${model.id || model.name}` : 'Model Options'"
    :modal="true"
    :style="{ width: '480px' }"
    @update:visible="handleClose"
  >
    <div class="model-options-content">
      <div class="field-row">
        <label>Tool Middleware</label>
        <Dropdown
          v-model="localToolMiddleware"
          :options="toolMiddlewareOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="None"
          showClear
          class="field-input"
        >
          <template #option="slotProps">
            <div v-tooltip.top="slotProps.option.tooltip">{{ slotProps.option.label }}</div>
          </template>
        </Dropdown>
      </div>

      <div class="field-row">
        <label>Reasoning Effort</label>
        <Dropdown
          v-model="localReasoningEffort"
          :options="reasoningEffortOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Default"
          showClear
          class="field-input"
        />
      </div>

      <div class="field-row">
        <label>Concurrency Limit</label>
        <InputNumber
          v-model="localConcurrencyLimit"
          :min="1"
          :max="50"
          placeholder="5 (default)"
          class="field-input"
        />
      </div>

      <div class="field-row">
        <label>Embedding Size</label>
        <InputNumber
          v-model="localEmbeddingSize"
          :min="64"
          :max="8192"
          placeholder="Not an embedding model"
          showButtons
          class="field-input"
        />
      </div>

      <div class="field-row">
        <label>Think Middleware</label>
        <div class="checkbox-wrapper">
          <Checkbox v-model="localThinkMiddleware" :binary="true" inputId="thinkMiddleware" />
          <label for="thinkMiddleware" class="checkbox-label">Extract from "think" tag</label>
        </div>
      </div>

      <div class="field-row">
        <label>System Prompt</label>
        <div class="checkbox-wrapper">
          <Checkbox v-model="localSystemPromptFirst" :binary="true" inputId="sysPromptFirst" />
          <label for="sysPromptFirst" class="checkbox-label">Only in the first message</label>
        </div>
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" icon="pi pi-times" text @click="handleClose" />
      <Button label="Apply" icon="pi pi-check" @click="handleApply" />
    </template>
  </Dialog>
</template>

<style scoped>
.model-options-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
