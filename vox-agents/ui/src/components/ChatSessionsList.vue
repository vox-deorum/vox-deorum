<script setup lang="ts">
import { computed } from 'vue';
import Toolbar from 'primevue/toolbar';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import type { EnvoyThread } from '@/utils/types';

/**
 * Props for the ChatSessionsList component
 */
interface Props {
  sessions: EnvoyThread[];
  title?: string;
  emptyMessage?: string;
  showActions?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Active Chat Sessions',
  emptyMessage: 'No active chat sessions',
  showActions: true
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
 * Handle session selection
 */
function handleSessionClick(session: EnvoyThread) {
  emit('session-selected', session);
}

/**
 * Handle resume button click
 */
function handleResumeClick(sessionId: string) {
  emit('session-resume', sessionId);
}

/**
 * Handle delete button click
 */
function handleDeleteClick(sessionId: string) {
  emit('session-delete', sessionId);
}

/**
 * Computed property for sessions count
 */
const sessionCount = computed(() => props.sessions.length);

/**
 * The agent name voicing this session = the agent seat's role descriptor.
 */
function agentNameOf(session: EnvoyThread): string {
  const role = session.agent === session.player1ID ? session.player1Role : session.player2Role;
  return role ?? 'agent';
}

/**
 * Format session title or fallback
 */
function getSessionTitle(session: EnvoyThread): string {
  if (session.title) return session.title;
  return `Chat with ${agentNameOf(session)} - Game ${session.gameID}`;
}
</script>

<template>
  <div class="panel-container">
    <Toolbar>
      <template #start>
        <h3 class="m-0">{{ title }}</h3>
        <Tag v-if="sessionCount > 0" :value="sessionCount" severity="info" class="ml-2" />
      </template>
    </Toolbar>

    <div v-if="sessionCount === 0" class="table-empty">
      <i class="pi pi-comments"></i>
      <p>{{ emptyMessage }}</p>
      <slot name="empty-action"></slot>
    </div>

    <div v-else class="data-table">
      <!-- Table Header -->
      <div class="table-header">
        <div class="col-expand">Session</div>
        <div class="col-fixed-120">Agent</div>
        <div class="col-fixed-250">Game</div>
        <div class="col-fixed-60">Player</div>
        <div v-if="showActions" class="col-fixed-150">Actions</div>
      </div>

      <!-- Table Body -->
      <div class="table-body">
        <div v-for="session in sessions" :key="session.id"
             class="table-row clickable"
             @click="handleSessionClick(session)">
          <div class="col-expand">
            {{ getSessionTitle(session) }}
          </div>
          <div class="col-fixed-120">
            {{ agentNameOf(session) }}
          </div>
          <div class="col-fixed-250">
            {{ session.gameID }}
          </div>
          <div class="col-fixed-60">
            {{ session.agent }}
          </div>
          <div v-if="showActions" class="col-fixed-150">
            <Button label="Resume" icon="pi pi-play" text size="small"
                    @click.stop="handleResumeClick(session.id)" />
            <Button icon="pi pi-trash" text size="small"
                    severity="danger"
                    @click.stop="handleDeleteClick(session.id)" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import '@/styles/data-table.css';
@import '@/styles/states.css';
@import '@/styles/panel.css';
</style>