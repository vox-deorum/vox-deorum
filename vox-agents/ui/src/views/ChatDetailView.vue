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
          v-if="thread?.diplomacy"
          label="Propose deal"
          icon="pi pi-briefcase"
          text
          @click="showDeal = true"
        />
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
        :messages="renderedItems"
        :scroll-trigger="newChunkEvent"
        :user-label="userLabel"
        :agent-label="agentLabel"
        :you-i-d="audiencePlayerID"
        :them-i-d="thread.agent"
        :active-deal-i-d="activeDealID"
        :deal-status="dealStatus"
        :deal-locked="closedThisTurn"
        :deal-action-busy="dealActionBusy"
        @deal-accept="onDealAccept"
        @deal-reject="onDealReject"
        @deal-counter="onDealCounter"
      />
      <div v-else class="loading-container">
        <ProgressSpinner />
        <p>Loading chat session...</p>
      </div>
    </div>

    <!-- Deal screen: in-game trade-screen replica, shown as a modal over the conversation -->
    <Dialog
      v-if="thread?.diplomacy"
      v-model:visible="showDeal"
      modal
      maximizable
      header="Propose deal"
      :style="{ width: '92vw', maxWidth: '1100px' }"
      :draggable="false"
    >
      <DealScreen
        v-if="audiencePlayerID !== undefined"
        :chatId="sessionId"
        :leftID="audiencePlayerID"
        :rightID="thread.agent"
        :leftLabel="userLabel"
        :rightLabel="agentLabel"
        :locked="closedThisTurn"
        @changed="refreshConversation"
      />
    </Dialog>

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
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import { useToast } from 'primevue/usetoast';
import { api } from '../api/client';
import type { EnvoyThread, DealTranscriptMessage } from '../utils/types';
import ChatMessages from '../components/chat/ChatMessages.vue';
import DeleteSessionDialog from '../components/DeleteSessionDialog.vue';
import DealScreen from '../components/deal/DealScreen.vue';
import { mergeThreadItems, reviveMessageDates } from '../components/deal/deal-thread';
import { deriveActiveProposal } from '../components/deal/deal-reduce';
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
const showDeal = ref(false);
const dealMessages = ref<DealTranscriptMessage[]>([]);
const dealActionBusy = ref(false);
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
/** The audience endpoint's playerID = the non-voiced seat (the human/caller in preview). */
const audiencePlayerID = computed(() => {
  const t = thread.value;
  if (!t) return undefined;
  return t.player1ID === t.agent ? t.player2ID : t.player1ID;
});
/** The audience = the other endpoint. */
const audienceRole = computed(() => {
  const t = thread.value;
  if (!t || audiencePlayerID.value === undefined) return undefined;
  return roleOf(t, audiencePlayerID.value);
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

/** The reduced deal state (latest active proposal + status) from the conversation's deal messages. */
const dealReduction = computed(() => deriveActiveProposal(dealMessages.value));
/** The latest proposal's message ID — its card carries the live status (actions only when open). */
const activeDealID = computed(() => dealReduction.value.active?.ID);
/** Status of the latest proposal, so its inline card can show open actions vs. rejected/enacted. */
const dealStatus = computed(() => dealReduction.value.status);
/** The rendered stream: visible chat messages with deal-message cards interleaved by time. */
const renderedItems = computed(() => {
  if (!thread.value) return [];
  return mergeThreadItems(visibleMessages.value, dealMessages.value, thread.value.agent);
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

/** Refresh the in-memory conversation and its separately stored deal messages. */
const refreshConversation = async () => {
  const response = await api.getAgentChat(sessionId.value);
  // Server-hydrated history carries ISO-string datetimes; revive them to Date so the thread's
  // timestamps match live-streamed messages (and merge/sort cleanly with deal cards).
  if (response?.messages) response.messages = reviveMessageDates(response.messages);
  thread.value = response;
  currentTurn.value = response.currentTurn;
  voicedCiv.value = response.voicedCiv;
  audienceCiv.value = response.audienceCiv;

  if (!thread.value) return;

  // Load the conversation's deal messages so proposals render inline in the thread.
  if (thread.value.diplomacy) await loadDealMessages();
};

const loadSession = async () => {
  await refreshConversation();
  if (!thread.value) return;
  // Auto-greet on empty thread or when last message is from a previous game turn
  if (shouldRequestGreeting(thread.value, currentTurn.value)) {
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

/** Fetch the conversation's deal messages for inline rendering (diplomacy threads only). */
const loadDealMessages = async () => {
  if (!thread.value?.diplomacy) return;
  try {
    const res = await api.getDealMessages(sessionId.value);
    dealMessages.value = res.messages;
  } catch (err) {
    console.error('Failed to load deal messages:', err);
  }
};

/** Accept the active proposal (wired; enactment deferred to stage 6 — surfaced as a notice). */
const onDealAccept = async (id: number) => {
  if (dealActionBusy.value) return;
  dealActionBusy.value = true;
  try {
    await api.acceptDeal(sessionId.value, { proposalMessageID: id });
    await refreshConversation();
  } catch (err) {
    toast.add({ severity: 'info', summary: 'Acceptance deferred', detail: err instanceof Error ? err.message : 'Enactment arrives in stage 6', life: 4000 });
  } finally {
    dealActionBusy.value = false;
  }
};

/** Reject (decline or retract) the active proposal from its inline card. */
const onDealReject = async (id: number) => {
  if (dealActionBusy.value) return;
  dealActionBusy.value = true;
  try {
    await api.rejectDeal(sessionId.value, { proposalMessageID: id });
    await refreshConversation();
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Failed to reject', detail: err instanceof Error ? err.message : 'Unknown error', life: 4000 });
  } finally {
    dealActionBusy.value = false;
  }
};

/** Counter opens the deal dialog, which loads the active proposal for editing. */
const onDealCounter = (_id: number) => {
  showDeal.value = true;
};

const closeConversation = async () => {
  if (!thread.value || isClosing.value) return;
  isClosing.value = true;
  try {
    const updated = await api.closeAgentChat(sessionId.value);
    if (updated?.messages) updated.messages = reviveMessageDates(updated.messages);
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
