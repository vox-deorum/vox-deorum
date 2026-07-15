<template>
  <div class="ai-messages-viewer">
    <div
      v-for="(message, index) in normalizedMessages"
      :key="index"
      :class="['message', `message--${message.role}`]"
    >
      <div class="message__header">
        <span class="message__label">{{ message.role }}</span>
      </div>
      <div class="message__content">
        <div v-for="(part, partIndex) in message.content" :key="partIndex">
          <!-- Text content -->
          <pre v-if="part.type === 'text'" class="text-content">{{ part.text }}</pre>

          <!-- Reasoning content -->
          <pre v-else-if="part.type === 'reasoning'" class="reasoning-content"><em>Reasoning:</em> {{ part.text }}</pre>

          <!-- Image content -->
          <img v-else-if="part.type === 'image'" :src="part.image || part.url" class="image-content" />

          <!-- Tool call -->
          <div v-else-if="part.type === 'tool-call'" class="tool-content">
            <div class="tool-header">
              <span class="tool-label">Calling {{ part.toolName }}</span>
              <span class="tool-id">{{ part.toolCallId }}</span>
            </div>
            <pre class="json-content">{{ formatJson(part.input) }}</pre>
          </div>

          <!-- Tool result -->
          <div v-else-if="part.type === 'tool-result'" class="tool-content">
            <div class="tool-header">
              <span class="tool-label">Output from {{ part.toolName }}</span>
              <span class="tool-id">{{ part.toolCallId }}</span>
            </div>
            <pre class="json-content">{{ formatJson(part.output) }}</pre>
          </div>

          <!-- Unknown/other content -->
          <pre v-else class="json-content">{{ formatJson(part) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface ContentPart {
  type: string
  text?: string
  image?: string
  url?: string
  toolName?: string
  toolCallId?: string
  input?: any
  output?: any
}

interface Message {
  role: 'system' | 'user' | 'assistant' | string
  content: ContentPart[] | string
}

interface Props {
  messages: Message[]
}

const props = defineProps<Props>()

// Normalize messages to always have ContentPart[] content
const normalizedMessages = computed(() => {
  return props.messages.map(message => ({
    ...message,
    content: normalizeContent(message.content)
  }))
})

function normalizeContent(content: ContentPart[] | string): ContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  return content
}

function formatJson(data: any): string {
  if (data === undefined || data === null) return 'null'
  if (typeof data === 'string') {
    try {
      return JSON.stringify(JSON.parse(data), null, 2)
    } catch {
      return data
    }
  }
  return JSON.stringify(data, null, 2)
}
</script>

<style scoped>
.ai-messages-viewer {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.message--system {
  border-left: 3px solid var(--p-gray-500);
}

.message--user {
  border-left: 3px solid var(--p-blue-500);
}

.message--assistant {
  border-left: 3px solid var(--p-green-500);
}

.message--tool {
  border-left: 3px solid var(--p-yellow-500);
}

.message__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.message__label {
  color: var(--p-text-color);
}

.message__content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.text-content,
.json-content,
.reasoning-content {
  padding: 0.5rem;
  background: var(--p-content-background);
  border-radius: 0.25rem;
  font-size: 0.875rem;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}

.reasoning-content {
  background: var(--p-content-hover-background);
}

.image-content {
  max-width: 100%;
  height: auto;
  border-radius: 0.25rem;
  margin: 0.5rem 0;
}

.tool-content {
  border: 1px solid var(--p-content-border-color);
  border-radius: 0.25rem;
  overflow: hidden;
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-content-border-color);
  font-size: 0.75rem;
}

.tool-label {
  font-weight: 600;
  color: var(--p-purple-500);
}

.tool-id {
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.tool-content .json-content {
  border-radius: 0;
  margin: 0;
}
</style>