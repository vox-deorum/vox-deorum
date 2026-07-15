<script setup lang="ts">
import Tag from 'primevue/tag';
import Toolbar from 'primevue/toolbar';
import type { TagProps } from 'primevue/tag';

withDefaults(defineProps<{
  title: string;
  count: number;
  emptyMessage: string;
  emptyIcon: string;
  countSeverity?: TagProps['severity'];
}>(), {
  countSeverity: 'info',
});
</script>

<template>
  <div class="panel-container">
    <Toolbar>
      <template #start>
        <h3 class="m-0">{{ title }}</h3>
        <Tag v-if="count > 0" :value="count" :severity="countSeverity" class="ml-2" />
      </template>
    </Toolbar>

    <div v-if="count === 0" class="table-empty">
      <i :class="emptyIcon"></i>
      <p>{{ emptyMessage }}</p>
      <slot name="empty-action"></slot>
    </div>

    <div v-else class="data-table">
      <div class="table-header">
        <slot name="header"></slot>
      </div>
      <div class="table-body">
        <slot></slot>
      </div>
    </div>
  </div>
</template>
