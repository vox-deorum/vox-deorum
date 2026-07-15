<template>
  <div class="tool-status" :class="{ 'tool-completed': completed }" @click="showDetails = true">
    <i v-if="!completed" class="pi pi-spin pi-spinner tool-status-icon" />
    <i v-else class="pi pi-check-circle tool-status-icon tool-success-icon" />
    <span class="tool-status-name">{{ toolName }}</span>
  </div>
  <DetailDialog
    v-model:visible="showDetails"
    :header="toolName"
    :entries="detailEntries"
  />
</template>

<script setup lang="ts">
/** Compact inline tool call status with click-to-inspect detail dialog. */

import { ref, computed } from 'vue';
import DetailDialog, { type DetailEntry } from '../shared/DetailDialog.vue';

interface Props {
  toolName: string;
  args?: unknown;
  result?: unknown;
  completed?: boolean;
}

const props = defineProps<Props>();

const showDetails = ref(false);

const detailEntries = computed<DetailEntry[]>(() => {
  const entries: DetailEntry[] = [];
  if (props.args !== undefined && props.args !== null) {
    entries.push({ label: 'Input', value: props.args });
  }
  if (props.result !== undefined) {
    entries.push({ label: 'Output', value: props.result, dividerBefore: true });
  }
  return entries;
});
</script>

<style scoped>
@import '@/styles/chat.css';

.tool-status {
  cursor: pointer;
}

.tool-status:hover {
  opacity: 0.85;
}
</style>
