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
          :disabled="isStreaming"
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
        :you-i-d="audiencePlayerID"
        :them-i-d="thread.agent"
        :active-deal-i-d="activeDealID"
        :deal-status="dealStatus"
        :deal-locked="closedThisTurn"
        :deal-action-busy="dealBlocked"
        @deal-accept="onDealAccept"
        @deal-reject="onDealReject"
        @deal-counter="onDealCounter"
      />
      <div v-else class="loading-container">
        <ProgressSpinner />
        <p>Loading chat session...</p>
      </div>
    </div>

    <!-- Deal screen: the wide three-panel in-game trade-board replica, shown as a modal over the
         conversation. Non-stacking; the board enforces its own min-width and scrolls horizontally
         on narrow viewports. Mounted only while open (v-if="showDeal") so each open — including from
         an inline card's Counter — reloads the current active proposal into the board. -->
    <Dialog
      v-if="thread?.diplomacy"
      v-model:visible="showDeal"
      modal
      header="Propose deal"
      :style="{ width: 'min(1400px, 95vw)' }"
      :draggable="false"
    >
      <DealScreen
        v-if="showDeal && audiencePlayerID !== undefined"
        :chatId="sessionId"
        :leftID="audiencePlayerID"
        :rightID="thread.agent"
        :leftLabel="userLabel"
        :rightLabel="agentLabel"
        :locked="closedThisTurn"
        :agent-busy="isStreaming"
        v-model:busy="dealActionBusy"
        @changed="onDealScreenChanged"
        @send="onDealSend"
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
import type { EnvoyThread, DealPayload } from '../utils/types';
import ChatMessages from '../components/chat/ChatMessages.vue';
import DeleteSessionDialog from '../components/DeleteSessionDialog.vue';
import DealScreen from '../components/deal/DealScreen.vue';
import { deriveActiveProposal } from '../components/deal/deal-reduce';
// Pure transcript helpers shared with the backend (via @vox) so labels and the close-lock
// comparison can never drift from the server's `isClosedThisTurn` / role derivation.
import { roleOf, agentName as agentNameOf, audienceID, isClosedThisTurn } from '@vox/utils/diplomacy/transcript-utils';
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
const dealActionBusy = ref(false);
let sseCleanup: (() => void) | null = null;

// Event emitter for new chunks
const newChunkEvent = ref(0);

// Computed
const sessionId = computed(() => route.params.sessionId as string);
const capitalize = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
/** The agent-voiced seat's role IS the executable agent name. */
const agentName = computed(() => (thread.value ? agentNameOf(thread.value) : undefined));
/** The audience endpoint's playerID = the non-voiced seat (the human/caller in preview). */
const audiencePlayerID = computed(() => (thread.value ? audienceID(thread.value) : undefined));
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
  currentTurn.value !== undefined && isClosedThisTurn(thread.value?.closeTurn, currentTurn.value));
const canSend = computed(() => !!thread.value && !isStreaming.value && !closedThisTurn.value);
/** Inline deal actions are blocked by either their own write or an active agent reply. */
const dealBlocked = computed(() => dealActionBusy.value || isStreaming.value);

/** Messages filtered for display: hide the special {{{token}}} rows; every deal row renders a card. */
const visibleMessages = computed(() => {
  if (!thread.value) return [];
  return thread.value.messages.filter(msg => {
    // Every deal row (proposal/counter/accept/reject/enacted) renders as its own inline card.
    if (msg.deal) return true;
    if (msg.message.role === 'user' && typeof msg.message.content === 'string') {
      return !/^\{\{\{.+\}\}\}$/.test(msg.message.content);
    }
    return true;
  });
});

/** Deal records carried inline in the thread (append order) — the source for reduction. */
const dealMessages = computed(() =>
  (thread.value?.messages ?? []).flatMap((m) => (m.deal ? [m.deal] : []))
);
/** The reduced deal state (latest active proposal + status) from the conversation's deal messages. */
const dealReduction = computed(() => deriveActiveProposal(dealMessages.value));
/** The latest proposal's message ID — its card carries the live status (actions only when open). */
const activeDealID = computed(() => dealReduction.value.active?.ID);
/** Status of the latest proposal, so its inline card can show open actions vs. rejected/enacted. */
const dealStatus = computed(() => dealReduction.value.status);

// Use the thread messages composable
const { sendMessage: sendThreadMessage, requestGreeting, proposeDeal } = useThreadMessages({
  thread,
  sessionId,
  isStreaming,
  onNewChunk: () => {
    // Increment the event counter to trigger a reactive update
    newChunkEvent.value++;
  },
  onSendFailed: (text, error, commit) => {
    if (commit === 'uncommitted') {
      // The send never took effect and its optimistic rows were removed — return the text to the
      // input so the human can retry cleanly, and explain why it bounced.
      inputMessage.value = text;
      toast.add({ severity: 'warn', summary: 'Message not sent', detail: error, life: 4000 });
    } else {
      // The message may have landed before the reply failed; it stays on screen. Surface the error
      // but DON'T restore the input — resending could duplicate the committed message.
      toast.add({ severity: 'warn', summary: 'The reply may have failed', detail: error, life: 4000 });
    }
  },
  onGreetingFailed: (error) => {
    // A greeting has no input to restore; just surface why it didn't arrive (a reload re-greets).
    toast.add({ severity: 'warn', summary: 'Could not start the conversation', detail: error, life: 4000 });
  },
  onDealFailed: (error, commit) => {
    if (commit === 'uncommitted') {
      // The proposal never committed (illegal/uninspectable deal, busy, or close-locked) and its
      // optimistic preliminary card was rolled back — surface why; the human can reopen the dialog.
      toast.add({ severity: 'warn', summary: 'Proposal not sent', detail: error, life: 4000 });
    } else {
      // The proposal committed but the diplomat's reply failed; the card stays. Surface the error.
      toast.add({ severity: 'warn', summary: 'The reply may have failed', detail: error, life: 4000 });
    }
  },
});

// Methods
const goBack = () => {
  router.push('/chat');
};

/** Adopt a server chat response (thread + label/turn enrichment) as the live view. */
const applyThread = (updated: Awaited<ReturnType<typeof api.getAgentChat>>) => {
  thread.value = updated;
  currentTurn.value = updated.currentTurn;
  voicedCiv.value = updated.voicedCiv;
  audienceCiv.value = updated.audienceCiv;
};

/** Refresh the in-memory conversation from the store (full re-hydrate — entry/mount/propose). */
const refreshConversation = async () => {
  // The API client revives server-hydrated datetimes to Date objects (deal rows included),
  // so the thread renders in store append order with no client-side date massaging here.
  applyThread(await api.getAgentChat(sessionId.value));
};

/**
 * The deal screen reported a blocking write (accept/reject). It always hands back the updated thread
 * (its new deal row already mirrored in) — adopt it directly so the conversation's live reasoning/
 * tool-call traces survive — then close the dialog. (Propose/counter no longer come through here; they
 * stream via `onDealSend`.)
 */
const onDealScreenChanged = (updated: Awaited<ReturnType<typeof api.getAgentChat>>) => {
  applyThread(updated);
  showDeal.value = false;
};

/**
 * The human submitted a deal (propose or counter — one action) from the deal screen. Keep the dialog
 * OPEN (its controls disable via `agent-busy`/`isStreaming`) until the server *accepts* the deal:
 * `proposeDeal` streams it through the chat-message path and closes the dialog on the post-commit
 * `connected` event — which also inserts the authoritative committed card, with the reply streaming
 * below. A pre-stream rejection never fires `connected`, so the dialog stays open with the draft intact
 * and `onDealFailed` explains why.
 *
 * `expectedProposalID` is the open offer the submission answers (omitted to open a fresh one): the server
 * 409s it if the live offer state changed under the human — that 409 is a pre-stream `uncommitted`
 * failure, so the draft stays.
 */
const onDealSend = async (
  { deal, expectedProposalID }: { deal: DealPayload; expectedProposalID?: number },
) => {
  const cleanup = await proposeDeal(deal, () => { showDeal.value = false; }, expectedProposalID);
  if (cleanup) sseCleanup = cleanup;
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

/**
 * Accept the active proposal. The endpoint mirrors the deal-accept/enacted rows into the thread and
 * returns it, so we adopt that response directly — a status flip must not re-fetch and flatten the
 * conversation's live reasoning/tool-call traces.
 */
const onDealAccept = async (id: number) => {
  if (dealBlocked.value) return;
  dealActionBusy.value = true;
  try {
    applyThread(await api.acceptDeal(sessionId.value, { proposalMessageID: id }));
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Failed to accept', detail: err instanceof Error ? err.message : 'Unknown error', life: 4000 });
  } finally {
    dealActionBusy.value = false;
  }
};

/** Reject (decline or retract) the active proposal from its inline card; adopt the returned thread. */
const onDealReject = async (id: number) => {
  if (dealBlocked.value) return;
  dealActionBusy.value = true;
  try {
    applyThread(await api.rejectDeal(sessionId.value, { proposalMessageID: id }));
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
    applyThread(await api.closeAgentChat(sessionId.value));
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
