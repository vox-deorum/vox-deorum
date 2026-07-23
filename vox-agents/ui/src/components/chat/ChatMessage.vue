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
        :result="toolOutcomesByCallId.get(part.toolCallId)?.value"
        :completed="toolOutcomesByCallId.get(part.toolCallId)?.completed ?? false"
        :failed="toolOutcomesByCallId.get(part.toolCallId)?.failed ?? false"
        :preliminary="toolOutcomesByCallId.get(part.toolCallId)?.preliminary ?? false"
        :provider-executed="part.providerExecuted"
        :dynamic="part.dynamic"
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

/** Tool-call shape retained from the provider stream for dashboard rendering. */
interface DisplayToolCall {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  providerExecuted?: boolean;
  dynamic?: boolean;
}

/** Latest progress or terminal tool-result shape retained by the accumulator. */
interface DisplayToolResult {
  type: 'tool-result';
  toolCallId: string;
  output: unknown;
  preliminary?: boolean;
}

/** Terminal tool error shape accepted from providers that surface one directly. */
interface DisplayToolError {
  type: 'tool-error';
  toolCallId: string;
  error: unknown;
}

/** Content variants this component renders or folds into a rendered tool call. */
type DisplayPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | DisplayToolCall
  | DisplayToolResult
  | DisplayToolError;

/** Return the model content variants understood by this component. */
const displayParts = (): DisplayPart[] => {
  if (!Array.isArray(props.message.content)) return [];
  return props.message.content
    .filter((part) => ['text', 'reasoning', 'tool-call', 'tool-result', 'tool-error'].includes(part.type))
    .map((part) => part as DisplayPart);
};

/** Test whether a structured provider result reports failure. */
const isFailedOutput = (output: unknown): boolean =>
  typeof output === 'object' && output !== null && 'status' in output && output.status === 'failed';

/** Keep the latest progress or terminal outcome for each tool call. */
const toolOutcomesByCallId = computed(() => {
  const map = new Map<string, {
    value: unknown;
    completed: boolean;
    failed: boolean;
    preliminary: boolean;
  }>();
  if (Array.isArray(props.message.content)) {
    for (const part of displayParts()) {
      if (part.type === 'tool-result') {
        map.set(part.toolCallId, {
          value: part.output,
          completed: part.preliminary !== true,
          failed: isFailedOutput(part.output),
          preliminary: part.preliminary === true,
        });
      } else if (part.type === 'tool-error') {
        map.set(part.toolCallId, {
          value: part.error,
          completed: true,
          failed: true,
          preliminary: false,
        });
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
    for (const part of displayParts()) {
      if (part.type === 'tool-result' || part.type === 'tool-error') {
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
