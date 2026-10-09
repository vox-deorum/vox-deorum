<template>
  <div :class="`msg msg-${role}`">
    <div class="flex justify-content-between align-items-center text-sm">
      <span class="font-semibold text-secondary">{{ displayRole }}</span>
      <span v-if="turn" class="text-muted text-xs ml-2">Turn {{ turn }}</span>
    </div>
    <MarkdownText :content="cleanedContent" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import MarkdownText from '../shared/MarkdownText.vue';

interface Props {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  turn?: number;
  userLabel?: string;
  agentLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  userLabel: 'You',
  agentLabel: 'Agent'
});

const displayRole = computed(() => ({
  user: props.userLabel,
  assistant: props.agentLabel,
  system: 'System',
  tool: 'Tool'
}[props.role]));

// Strip LLM-echoed [Turn N] prefix and trailing horizontal rule
const cleanedContent = computed(() => props.content
  .replace(/^\[Turn \d+\]\s*/, '')
  .replace(/\n\s*(?:---|<hr\s*\/?>)\s*$/, ''));
</script>
