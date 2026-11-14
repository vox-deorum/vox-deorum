<script setup lang="ts">
import Button from 'primevue/button';
import SessionListPanel from '../shared/SessionListPanel.vue';
import type { EnvoyThread } from '@/utils/types';
import { agentName } from '@vox/diplomacy/transcript/transcript-utils';

/**
 * Props for the ChatSessionsList component
 */
interface Props {
  sessions: EnvoyThread[];
  title?: string;
  emptyMessage?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Active Chat Sessions',
  emptyMessage: 'No active chat sessions'
});

/**
 * Emit events for session actions
 */
const emit = defineEmits<{
  'session-selected': [session: EnvoyThread];
  'session-resume': [sessionId: string];
  'session-delete': [sessionId: string];
}>();

/**
 * Format session title or fallback
 */
function getSessionTitle(session: EnvoyThread): string {
  if (session.title) return session.title;
  return `Chat with ${agentName(session) ?? 'agent'} - Game ${session.gameID}`;
}
</script>

<template>
  <SessionListPanel
    :title="title"
    :count="sessions.length"
    :empty-message="emptyMessage"
    empty-icon="pi pi-comments"
    count-severity="info"
  >
    <template #empty-action>
      <slot name="empty-action"></slot>
    </template>
    <template #header>
        <div class="col-expand">Session</div>
        <div class="col-fixed-120">Agent</div>
        <div class="col-fixed-250">Game</div>
        <div class="col-fixed-60">Player</div>
        <div class="col-fixed-150">Actions</div>
    </template>

    <div v-for="session in sessions" :key="session.id"
         class="table-row clickable"
         @click="emit('session-selected', session)">
      <div class="col-expand">
        {{ getSessionTitle(session) }}
      </div>
      <div class="col-fixed-120">
        {{ agentName(session) ?? 'agent' }}
      </div>
      <div class="col-fixed-250">
        {{ session.gameID }}
      </div>
      <div class="col-fixed-60">
        {{ session.agent }}
      </div>
      <div class="col-fixed-150">
        <Button label="Resume" icon="pi pi-play" text size="small"
                @click.stop="emit('session-resume', session.id)" />
        <Button icon="pi pi-trash" text size="small"
                severity="danger"
                @click.stop="emit('session-delete', session.id)" />
      </div>
    </div>
  </SessionListPanel>
</template>
