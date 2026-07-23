<template>
  <div class="tool-status" :class="{ 'tool-completed': completed, 'tool-failed': failed }" @click="showDetails = true">
    <i v-if="!completed" class="pi pi-spin pi-spinner tool-status-icon" />
    <i v-else-if="failed" class="pi pi-times-circle tool-status-icon tool-error-icon" />
    <i v-else class="pi pi-check-circle tool-status-icon tool-success-icon" />
    <span class="tool-status-name">{{ toolName }}</span>
    <span v-if="providerExecuted" class="text-muted text-small">Provider tool</span>
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
  failed?: boolean;
  preliminary?: boolean;
  providerExecuted?: boolean;
  dynamic?: boolean;
}

const props = defineProps<Props>();

const showDetails = ref(false);

const detailEntries = computed<DetailEntry[]>(() => {
  const entries: DetailEntry[] = [];
  if (props.args !== undefined && props.args !== null) {
    entries.push({ label: 'Input', value: props.args });
  }
  if (props.result !== undefined) {
    entries.push({ label: props.failed ? 'Error' : 'Output', value: props.result, dividerBefore: true });
  }
  if (props.providerExecuted) {
    entries.push({
      label: 'Execution',
      value: {
        providerExecuted: true,
        dynamic: props.dynamic === true,
        preliminary: props.preliminary === true,
      },
      dividerBefore: true,
    });
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
