<template>
  <div v-if="entries.length === 0" class="log-table-empty table-empty">
    <i class="pi pi-inbox"></i>
    <p>{{ emptyText }}</p>
    <p v-if="emptyHint" class="text-small text-muted">{{ emptyHint }}</p>
  </div>

  <div v-else class="log-table data-table">
    <div class="table-header">
      <div class="col-fixed-100">Time</div>
      <div class="col-fixed-150">Level</div>
      <div class="col-expand">Message</div>
    </div>

    <VList :data="entries" ref="list" class="table-body" #default="{ item, index }">
      <div :key="`${item.timestamp}-${index}`" :class="getLogRowClass(item.level)">
        <div class="col-fixed-100">{{ formatTimestamp(item.timestamp) }}</div>
        <div class="col-fixed-150">
          <span class="level-emoji">{{ getLevelEmoji(item.level) }}</span>
          <span class="level-context text-muted text-small">{{ item.context }}</span>
        </div>
        <div class="col-expand text-wrap">
          {{ item.message }}
          <div v-if="item.params" class="params-list">
            <ParamsList :params="item.params" />
          </div>
        </div>
      </div>
    </VList>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { VList } from 'virtua/vue';
import { getLevelEmoji, formatTimestamp, getLogRowClass } from '@/presentation/log-utils';
import type { LogEntry } from '@/utils/types';
import ParamsList from './ParamsList.vue';

withDefaults(defineProps<{
  entries: LogEntry[];
  emptyText?: string;
  emptyHint?: string;
}>(), {
  emptyText: 'No log entries to display'
});

const list = ref<InstanceType<typeof VList>>();

/** Scroll to the given row, used by viewers that follow the newest entries. */
function scrollToIndex(index: number) {
  if (index >= 0) list.value?.scrollToIndex(index);
}

defineExpose({ scrollToIndex });
</script>

<style scoped>
.log-table {
  flex: 1;
  min-height: 0;
  border: none;
  border-top: 1px solid var(--p-content-border-color);
  border-radius: 0;
}

.log-table-empty {
  flex: 1;
  gap: 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
}

.log-table-empty .pi {
  font-size: 1.75rem;
}

.level-emoji {
  margin-right: 0.25rem;
}

.level-context {
  margin-left: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.params-list {
  color: var(--p-text-secondary-color);
  display: block;
  font-size: 0.75rem;
  margin-top: 0.25rem;
}
</style>
