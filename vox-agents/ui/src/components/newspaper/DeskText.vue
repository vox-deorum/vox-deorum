<script setup lang="ts">
import { computed } from 'vue';
import type { DeskVariable } from '@/utils/types';

const props = defineProps<{ text: string; variables: DeskVariable[] }>();
const table = computed(() => new Map(props.variables.map(variable => [variable.name, variable])));

const parts = computed(() => {
  const tokens: { text: string; name?: string; variable?: DeskVariable }[] = [];
  let cursor = 0;
  for (const match of props.text.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const start = match.index ?? 0;
    if (start > cursor) tokens.push({ text: props.text.slice(cursor, start) });
    const expression = match[1]!;
    const pluralIndex = expression.indexOf('|');
    const name = pluralIndex === -1 ? expression : expression.slice(0, pluralIndex);
    tokens.push({ text: match[0], name, variable: table.value.get(name) });
    cursor = start + match[0].length;
  }
  if (cursor < props.text.length) tokens.push({ text: props.text.slice(cursor) });
  return tokens;
});
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <span v-if="part.name !== undefined" class="desk-variable-chip" :data-group="part.variable?.group ?? 'unknown'"
      :data-empty="part.variable?.mayBeEmpty" :title="part.variable ? part.text + ' · ' + part.variable.source : 'Unknown placeholder: ' + part.text"
    >{{ part.name }}</span><template v-else>{{ part.text }}</template>
  </template>
</template>
