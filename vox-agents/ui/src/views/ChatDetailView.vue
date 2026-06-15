<!--
View: ChatDetailView
Purpose: Main chat interface for interacting with agents
-->
<template>
  <div class="chat-detail-container">
    <!-- Header -->
    <div class="page-header">
      <div class="page-header-left">
        <Button
          icon="pi pi-arrow-left"
          text
          rounded
          @click="goBack"
        />
        <h1>{{ thread?.title || `${thread?.agent || 'Loading'} Chat` }}</h1>
        <div v-if="thread" class="flex align-items-center gap-2" style="margin-left: 1rem">
          <Tag :value="thread.contextType" :severity="thread.contextType === 'live' ? 'success' : 'info'" />
          <Tag v-if="thread.diplomacy" value="Diplomacy" severity="contrast" />
          <Tag
            v-if="isClosed"
            :value="closedThisTurn ? 'Closed this turn' : 'Closed (reopenable)'"
            :severity="closedThisTurn ? 'danger' : 'warn'"
          />
          <span class="text-sm text-muted">Game: {{ thread.gameID }} | {{ agentLabel }} ↔ {{ userLabel }}</span>
        </div>
      </div>
      <div class="page-header-controls">
        <Button
          v-if="thread?.diplomacy && !closedThisTurn"
          label="Close conversation"
          icon="pi pi-times-circle"
          text
          :loading="isClosing"
          @click="closeConversation"
        />
        <Button
          label="Delete"
          icon="pi pi-trash"
          text
          severity="danger"
          @click="confirmDelete"
          v-if="thread"
        />
      </div>
    </div>

    <!-- Messages Container -->
    <div class="messages-wrapper">
      <ChatMessages
        v-if="thread"
        :messages="visibleMessages"
        :scroll-trigger="newChunkEvent"
        :user-label="userLabel"
        :agent-label="agentLabel"
      />
      <div v-else class="loading-container">
        <ProgressSpinner />
        <p>Loading chat session...</p>
      </div>
    </div>

    <!-- Closed-this-turn notice -->
    <div v-if="closedThisTurn" class="closed-notice">
      This conversation was closed this turn. It can be reopened on a later turn.
    </div>

    <!-- Input Area -->
    <div class="input-area">
      <Textarea
        v-model="inputMessage"
        :disabled="!canSend"
        @keydown.enter.prevent="handleEnterKey"
        :placeholder="closedThisTurn ? 'Conversation closed this turn' : 'Type your message...'"
        :rows="3"
        auto-resize
        class="input-textarea"
      />
      <Button
        @click="sendMessage"
        :disabled="!inputMessage.trim() || !canSend"
        :loading="isStreaming"
        icon="pi pi-send"
        label="Send"
      />
    </div>

    <!-- Delete confirmation dialog -->
    <DeleteSessionDialog
      v-model="showDeleteDialog"
      :session="thread"
      :redirect-after-delete="true"
      redirect-path="/chat"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Textarea from 'primevue/textarea';
import ProgressSpinner from 'primevue/progressspinner';
import { useToast } from 'primevue/usetoast';
import { api } from '../api/client';
import type { EnvoyThread } from '../utils/types';
import ChatMessages from '../components/chat/ChatMessages.vue';
import DeleteSessionDialog from '../components/DeleteSessionDialog.vue';
import { useThreadMessages } from '../composables/useThreadMessages';

const route = useRoute();
const router = useRouter();
const toast = useToast();

// State
const thread = ref<EnvoyThread | null>(null);
const currentTurn = ref<number | undefined>(undefined);
const voicedCiv = ref<string | undefined>(undefined);
const audienceCiv = ref<string | undefined>(undefined);
const inputMessage = ref('');
const isStreaming = ref(false);
const isClosing = ref(false);
const showDeleteDialog = ref(false);
let sseCleanup: (() => void) | null = null;

// Event emitter for new chunks
const newChunkEvent = ref(0);

// Computed
const sessionId = computed(() => route.params.sessionId as string);
const capitalize = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
/** The free-form role descriptor stored for a playerID in the ordered pair. */
const roleOf = (t: EnvoyThread, id: number) => (id === t.player1ID ? t.player1Role : t.player2Role);
/** The agent-voiced seat's role IS the executable agent name. */
const agentName = computed(() => (thread.value ? roleOf(thread.value, thread.value.agent) : undefined));
/** The audience = the other endpoint. */
const audienceRole = computed(() => {
  const t = thread.value;
  if (!t) return undefined;
  const audienceID = t.player1ID === t.agent ? t.player2ID : t.player1ID;
  return roleOf(t, audienceID);
});
/** Label for the caller / audience. */
const userLabel = computed(() => {
  if (!audienceCiv.value || audienceCiv.value === 'Observer') return 'You';
  return `${capitalize(audienceRole.value)}, ${audienceCiv.value}`;
});
/** Label for the voiced (agent) seat: "{agent} of {civ}". */
const agentLabel = computed(() => {
  const name = capitalize(agentName.value) || 'Agent';
  return voicedCiv.value ? `${name} of ${voicedCiv.value}` : name;
});

/** Open/closed status derived from the latest close message's turn vs the current turn. */
const isClosed = computed(() => thread.value?.closeTurn !== undefined);
/** Closed this turn → locked; the conversation can only resume on a later turn (specs §8). */
const closedThisTurn = computed(() =>
  thread.value?.closeTurn !== undefined &&
  currentTurn.value !== undefined &&
  currentTurn.value <= thread.value.closeTurn);
const canSend = computed(() => !!thread.value && !isStreaming.value && !closedThisTurn.value);

/** Messages filtered to hide special message tokens (e.g., {{{Greeting}}}) from display */
const visibleMessages = computed(() => {
  if (!thread.value) return [];
  return thread.value.messages.filter(msg => {
    if (msg.message.role === 'user' && typeof msg.message.content === 'string') {
      return !/^\{\{\{.+\}\}\}$/.test(msg.message.content);
    }
    return true;
  });
});

// Use the thread messages composable
const { sendMessage: sendThreadMessage, requestGreeting } = useThreadMessages({
  thread,
  sessionId,
  isStreaming,
  onNewChunk: () => {
    // Increment the event counter to trigger a reactive update
    newChunkEvent.value++;
  }
});

// Methods
const goBack = () => {
  router.push('/chat');
};

const loadSession = async () => {
  const response = await api.getAgentChat(sessionId.value);
  thread.value = response;
  currentTurn.value = response.currentTurn;
  voicedCiv.value = response.voicedCiv;
  audienceCiv.value = response.audienceCiv;

  if (!thread.value) return;

  // Auto-greet on empty thread or when last message is from a previous game turn
  if (shouldRequestGreeting(thread.value, response.currentTurn)) {
    const cleanup = await requestGreeting();
    if (cleanup) {
      sseCleanup = cleanup;
    }
  }
};

/** Greet on empty thread or when last message is from a previous turn */
const shouldRequestGreeting = (t: EnvoyThread, currentTurn?: number): boolean => {
  if (t.messages.length === 0) return true;
  if (currentTurn == null) return false;
  const lastMessage = t.messages[t.messages.length - 1];
  return lastMessage ? lastMessage.metadata.turn < currentTurn : false;
};

const handleEnterKey = (event: KeyboardEvent) => {
  if (!event.shiftKey) {
    sendMessage();
  }
};

const sendMessage = async () => {
  if (!inputMessage.value.trim()) {
    return;
  }

  const message = inputMessage.value.trim();
  inputMessage.value = '';

  const cleanup = await sendThreadMessage(message);
  if (cleanup) {
    sseCleanup = cleanup;
  }
};

const confirmDelete = () => {
  showDeleteDialog.value = true;
};

const closeConversation = async () => {
  if (!thread.value || isClosing.value) return;
  isClosing.value = true;
  try {
    const updated = await api.closeAgentChat(sessionId.value);
    thread.value = updated;
    currentTurn.value = updated.currentTurn;
    voicedCiv.value = updated.voicedCiv;
    audienceCiv.value = updated.audienceCiv;
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Failed to close conversation',
      detail: err instanceof Error ? err.message : 'Unknown error',
      life: 4000,
    });
  } finally {
    isClosing.value = false;
  }
};

// Lifecycle
onMounted(() => {
  loadSession();
});

onUnmounted(() => {
  if (sseCleanup) {
    sseCleanup();
  }
});
</script>

<style scoped>
@import '@/styles/chat.css';
@import '@/styles/states.css';

.closed-notice {
  padding: 0.5rem 1rem;
  margin: 0 1rem;
  border-radius: 6px;
  background-color: var(--p-content-hover-background);
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
  text-align: center;
}
</style>