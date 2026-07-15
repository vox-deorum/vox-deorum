<template>
  <Dialog
    v-model:visible="dialogVisible"
    :header="header"
    modal
    :style="{ width: '80rem' }"
    :breakpoints="{ '1400px': '90vw', '960px': '95vw', '640px': '100vw' }"
    :closeOnEscape="true"
  >
    <div v-if="entries.length > 0" class="detail-dialog-content">
      <template v-for="(entry, index) in entries" :key="index">
        <hr v-if="entry.dividerBefore" class="details-divider" />
        <div class="detail-row">
          <strong>{{ entry.label }}:</strong>
          <!-- Primitive values -->
          <span v-if="isPrimitive(entry.value)">{{ entry.value }}</span>
          <!-- AI Messages -->
          <div v-else-if="isAIMessageData(entry.value)" class="ai-messages-container">
            <AIMessagesViewer :messages="(entry.value as any)" />
          </div>
          <!-- Complex JSON -->
          <div v-else class="json-container">
            <VueJsonPretty
              :data="(entry.value as any)"
              :show-icon="true"
              :show-line-number="false"
              :deep="3"
              :collapsed-on-click-brackets="true"
              :show-double-quotes="true"
              :virtual="false"
              :highlight-selected-node="false"
              class="json-pretty"
            />
          </div>
        </div>
      </template>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
/**
 * DetailDialog - Reusable dialog for displaying structured key-value data.
 * Used by both the chat tool call detail view and the telemetry span detail view.
 */

import { computed } from 'vue';
import Dialog from 'primevue/dialog';
import VueJsonPretty from 'vue-json-pretty';
import 'vue-json-pretty/lib/styles.css';
import AIMessagesViewer from './AIMessagesViewer.vue';

/** A single key-value entry to display in the dialog. */
export interface DetailEntry {
  label: string;
  value: unknown;
  /** If true, renders a horizontal divider before this entry. */
  dividerBefore?: boolean;
}

interface Props {
  visible: boolean;
  header: string;
  entries: DetailEntry[];
}

interface Emits {
  (e: 'update:visible', value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
});

/** Check if a value is a primitive type that can be rendered as plain text. */
function isPrimitive(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

/** Check if the value looks like an array of AI messages (has .role on elements). */
function isAIMessageData(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value[0]?.role !== undefined;
}
</script>

<style scoped>
.detail-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.detail-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

.detail-row strong {
  min-width: 160px;
  flex-shrink: 0;
}

.detail-row span {
  flex: 1;
  word-break: break-word;
  white-space: pre-wrap;
}

.json-container,
.ai-messages-container {
  flex: 1;
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius);
}

.json-container {
  padding: 0.5rem;
  background: var(--p-content-hover-background);
  overflow-x: auto;
}

.ai-messages-container {
  max-height: 600px;
  overflow-y: auto;
}

.json-pretty {
  font-family: monospace;
  font-size: 0.875rem;
}

/* Override vue-json-pretty default colors for PrimeVue theme integration */
:deep(.vjs-tree) {
  color: var(--p-text-color) !important;
}

:deep(.vjs-key) {
  color: var(--p-primary-color) !important;
}

:deep(.vjs-value__string) {
  color: var(--p-green-500) !important;
}

:deep(.vjs-value__number) {
  color: var(--p-blue-500) !important;
}

:deep(.vjs-value__boolean) {
  color: var(--p-orange-500) !important;
}

:deep(.vjs-value__null) {
  color: var(--p-gray-500) !important;
}

:deep(.vjs-tree__brackets) {
  color: var(--p-text-muted-color) !important;
}

.details-divider {
  border: none;
  border-top: 1px solid var(--p-content-border-color);
  margin: 0.5rem 0;
}
</style>
