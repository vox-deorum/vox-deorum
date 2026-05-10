<template>
  <div class="chat-message">
    <template v-for="(part, index) in contentParts" :key="index">
      <ReasoningMessage
        v-if="part.type === 'reasoning'"
        :content="part.text"
      />
      <TextMessage
        v-if="part.type === 'text'"
        :role="message.role"
        :content="part.text"
        :turn="metadata?.turn"
        :user-label="userLabel"
        :agent-label="agentLabel"
      />
      <ToolCallMessage
        v-if="part.type === 'tool-call'"
        :tool-name="part.toolName"
        :args="part.input"
        :result="toolResultsByCallId.get(part.toolCallId)"
        :completed="completedToolCallIds.has(part.toolCallId)"
      />
      <!-- Tool results are shown inline on the tool-call block -->
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ModelMessage } from 'ai';
import TextMessage from './TextMessage.vue';
import ReasoningMessage from './ReasoningMessage.vue';
import ToolCallMessage from './ToolCallMessage.vue';
import { cleanToolArtifacts } from '@vox/utils/models/text-cleaning';

interface Props {
  message: ModelMessage;
  metadata?: {
    datetime: Date;
    turn: number;
  };
  userLabel?: string;
  agentLabel?: string;
}

const props = defineProps<Props>();

// Collect tool call IDs that have a matching tool-result
const completedToolCallIds = computed(() => {
  const ids = new Set<string>();
  if (Array.isArray(props.message.content)) {
    for (const part of props.message.content) {
      if (part.type === 'tool-result') {
        ids.add(part.toolCallId);
      }
    }
  }
  return ids;
});

// Map tool call IDs to their result data for the detail dialog
const toolResultsByCallId = computed(() => {
  const map = new Map<string, unknown>();
  if (Array.isArray(props.message.content)) {
    for (const part of props.message.content) {
      if (part.type === 'tool-result') {
        map.set(part.toolCallId, part.output);
      }
    }
  }
  return map;
});

// Normalize content to an array of parts in chronological order.
// Tool-result parts are filtered out (their status is shown on the tool-call block)
const contentParts = computed(() => {
  const parts: any[] = [];

  if (typeof props.message.content === 'string') {
    const cleaned = cleanToolArtifacts(props.message.content);
    if (cleaned) parts.push({ type: 'text', text: cleaned });
  } else if (Array.isArray(props.message.content)) {
    for (const part of props.message.content) {
      if (part.type === 'tool-result') {
        // Skip - shown inline on the tool-call block
      } else if (part.type === 'text') {
        const cleaned = cleanToolArtifacts(part.text);
        if (cleaned) parts.push({ ...part, text: cleaned });
      } else {
        parts.push(part);
      }
    }
  }

  return parts;
});
</script>

<style scoped>
@import '@/styles/chat.css';
</style>
