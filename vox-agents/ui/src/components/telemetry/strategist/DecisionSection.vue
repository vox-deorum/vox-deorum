<template>
  <div class="data-table">
    <div class="table-header">
      {{ title }}
      <Tag v-for="tag in items ? countTags(items) : []" :key="tag.label" :value="tag.label" :severity="tag.severity" />
    </div>
    <MarkdownText v-if="rationale" class="decision-why" :content="rationale" />
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * DecisionSection - One section of strategist decisions: a header with count tags, an optional
 * section-wide rationale, and the rows in the default slot.
 */
import Tag from 'primevue/tag';
import MarkdownText from '../../shared/MarkdownText.vue';
import { countTags, type DecisionItem } from '@/api/strategist-turn';

defineProps<{ title: string; items?: DecisionItem[]; rationale?: string }>();
</script>
