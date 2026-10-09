<template>
  <span class="decision-values">
    <template v-if="moved">
      <span class="decision-from">{{ show(item.current) }} →</span>
      {{ ' ' }}<span class="decision-to">{{ show(item.next) }}</span>
    </template>
    <template v-else>{{ show(item.next ?? item.current) }}</template>
  </span>
</template>

<script setup lang="ts">
/**
 * DecisionValue - A decided value as "current → new", or just the value when it did not move.
 */
import { computed } from 'vue';
import type { DecisionItem } from '@/api/strategist-turn';

const props = defineProps<{ item: DecisionItem }>();

const moved = computed(() => props.item.next !== undefined && props.item.next !== props.item.current);

/** Format a value for display: numbers with separators, missing values as "none". */
function show(value?: number | string): string {
  if (value === undefined || value === null || value === '') return 'none';
  return typeof value === 'number' ? value.toLocaleString('en-US') : value;
}
</script>
