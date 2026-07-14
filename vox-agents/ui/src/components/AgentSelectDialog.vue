<script setup lang="ts">
/**
 * AgentSelectDialog component - two-step modal dialog for selecting an agent and user identity.
 * Step 1: Select an agent from the filtered list.
 * Step 2: Configure user identity (role + player/civ affiliation).
 * Used in ChatView, TelemetrySessionView, TelemetryDatabaseView, and TelemetryTraceView.
 */

import { ref, computed, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import ProgressSpinner from 'primevue/progressspinner';
import SelectButton from 'primevue/selectbutton';
import type { AgentInfo, Span, CreateChatRequest, PlayerAssignment, ParticipantIdentity } from '@/utils/types';
import { userRoleSuggestions } from '@/utils/types';
import { api } from '@/api/client';
import DiplomacyLaunchForm from './chat-launch/DiplomacyLaunchForm.vue';
import ObserverIdentityForm from './chat-launch/ObserverIdentityForm.vue';
import type { PlayerOption } from './chat-launch/types';
import { useChatLauncher } from '@/composables/useChatLauncher';

// Props interface
interface Props {
  visible: boolean;
  contextId?: string;
  databasePath?: string;
  turn?: number;
  span?: Span;  // Optional span for more precise context
}

// Emits interface
interface Emits {
  (e: 'update:visible', value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** Hardcoded identity for the observer seat — the dialog is the single source of identities. */
const OBSERVER_IDENTITY: ParticipantIdentity = { name: 'an observer', leader: '' };

// State
const loading = ref(false);
const loadError = ref<string | null>(null);
const agents = ref<AgentInfo[]>([]);
const selectedAgent = ref<AgentInfo | null>(null);

// Step management
const currentStep = ref<'agent' | 'identity'>('agent');

/** Conversation type for active-game contexts: observer chat or civ↔civ diplomacy. */
const conversationMode = ref<'observer' | 'diplomacy'>('observer');
const conversationModeOptions = [
  { label: 'Observer chat', value: 'observer' },
  { label: 'Diplomacy (civ↔civ)', value: 'diplomacy' },
];

// Identity form state
const userRole = ref('');
const filteredRoles = ref<string[]>([]);
const selectedPlayerOption = ref<PlayerOption | null>(null);
const playersLoading = ref(false);
const playerOptions = ref<PlayerOption[]>([]);
/** Civilization name per player id, used to title the dialog after the chosen seat. */
const playerCivs = ref<Record<number, string>>({});
/** Full civ+leader identity per player id, sent to the backend so it never re-resolves (FOW). */
const playerIdentities = ref<Record<number, ParticipantIdentity>>({});

// Diplomacy form state
const assignments = ref<Record<number, PlayerAssignment>>({});
const diplomacyInitiator = ref<PlayerOption | null>(null);
const voiceOverride = ref<AgentInfo | null>(null);
const initiatorRole = ref('the diplomat');
let agentsLoadPromise: Promise<void> | null = null;
let playersLoadPromise: { contextId: string; promise: Promise<void> } | null = null;
let loadedPlayersContextId: string | undefined;
let playersLoadGeneration = 0;

const { isCreatingSession, launchError, launchChat, clearLaunchError } = useChatLauncher(closeDialog);
const error = computed(() => loadError.value ?? launchError.value);

/** Major-civ player options (no observer) for the diplomacy selectors. */
const civPlayerOptions = computed(() => playerOptions.value.filter(o => o.value !== 'observer'));

/**
 * The LLM-voiced target seat is the civ whose session the operator chose — encoded as the
 * trailing player id of the contextId (`{gameID}-player-{playerID}`). It is not a free choice.
 */
const derivedTargetPlayerID = computed<number | null>(() => {
  if (!props.contextId) return null;
  const id = parseInt(props.contextId.split('-').pop() ?? '', 10);
  return Number.isNaN(id) ? null : id;
});

/** Bare civilization name of the chosen seat (e.g. "Rome"), empty until players load. */
const targetCivName = computed(() => {
  const id = derivedTargetPlayerID.value;
  return id === null ? '' : (playerCivs.value[id] ?? '');
});

/** Whether the diplomacy form is complete enough to open a conversation. */
const canStartDiplomacy = computed(() =>
  derivedTargetPlayerID.value !== null &&
  diplomacyInitiator.value !== null &&
  derivedTargetPlayerID.value !== diplomacyInitiator.value.value
);

// Computed properties
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
});

const dialogTitle = computed(() => {
  if (currentStep.value === 'identity') return 'Your Identity';
  if (props.contextId && targetCivName.value) return `Chat with ${targetCivName.value}`;
  return 'Select Agent';
});

const contextType = computed(() => {
  if (props.contextId) return 'Active Game';
  if (props.databasePath) return 'Database';
  return 'No Context';
});

const contextName = computed(() => {
  if (props.databasePath) {
    return props.databasePath.split(/[/\\]/).pop() || props.databasePath;
  }
  return '';
});

const contextTurn = computed(() => {
  return props.span?.attributes?.turn || props.turn;
});

const contextSpanName = computed(() => {
  return props.span?.name || '';
});

/** Whether the Start Chat button should be enabled */
const canStartChat = computed(() => {
  return userRole.value.trim().length > 0 && selectedPlayerOption.value !== null;
});

// Filtered agents based on context
const filteredAgents = computed(() => {
  return agents.value.filter(agent => {
    // If session has contextId (active game), filter agents with "active-game" tag
    if (props.contextId && agent.tags.includes('active-game')) {
      return true;
    }

    // If session has databasePath (telepathist mode), filter agents with "telepathist" tag
    if (props.databasePath && agent.tags.includes('telepathist')) {
      return true;
    }

    return false;
  });
});

/**
 * Agents offered for direct chat or as a diplomacy voice. Excludes behind-the-scenes
 * specialists like the negotiator, which work for the diplomat and never address you.
 */
const chattableAgents = computed(() => filteredAgents.value.filter(a => a.name !== 'negotiator'));

// Methods
async function loadAgents(): Promise<void> {
  loadError.value = null;
  clearLaunchError();
  if (agents.value.length > 0) return;
  if (agentsLoadPromise) return agentsLoadPromise;
  loading.value = true;

  agentsLoadPromise = (async () => {
    try {
      const response = await api.getAgents();
      agents.value = response.agents || [];
    } catch (err) {
      console.error('Error loading agents:', err);
      loadError.value = err instanceof Error ? err.message : 'Failed to load agents';
    } finally {
      loading.value = false;
      agentsLoadPromise = null;
    }
  })();
  return agentsLoadPromise;
}

/** Load player options for the identity step */
async function loadPlayerOptions(): Promise<void> {
  const observerOption: PlayerOption = { label: 'Observer', value: 'observer' };
  const requestedContextId = props.contextId;

  // Only load real players for active game contexts
  if (!requestedContextId) {
    playerOptions.value = [observerOption];
    return;
  }

  if (loadedPlayersContextId === requestedContextId && playerOptions.value.length > 1) return;
  if (playersLoadPromise?.contextId === requestedContextId) return playersLoadPromise.promise;

  const generation = ++playersLoadGeneration;
  const promise = (async () => {
    playersLoading.value = true;
    try {
      const response = await api.getPlayersSummary();
      const options: PlayerOption[] = [];
      const civs: Record<number, string> = {};
      const identities: Record<number, ParticipantIdentity> = {};

      for (const [playerId, data] of Object.entries(response.players)) {
        if (typeof data === 'object' && data !== null) {
          const id = parseInt(playerId);
          options.push({ label: `${data.Leader} of ${data.Civilization}`, value: id });
          civs[id] = data.Civilization;
          identities[id] = { name: data.Civilization, leader: data.Leader };
        }
      }
      if (generation !== playersLoadGeneration || !props.visible || props.contextId !== requestedContextId) return;
      playerCivs.value = civs;
      playerIdentities.value = identities;
      options.push(observerOption);
      playerOptions.value = options;
      assignments.value = response.assignments ?? {};
      loadedPlayersContextId = requestedContextId;
      const humanSeat = Object.entries(assignments.value).find(([, assignment]) => assignment.strategist === 'human-strategist');
      if (humanSeat) diplomacyInitiator.value = options.find(option => option.value === parseInt(humanSeat[0])) ?? null;
      applyTargetVoiceDefault();
    } catch (err) {
      console.error('Failed to load players:', err);
      if (generation === playersLoadGeneration && props.visible && props.contextId === requestedContextId) {
        playerOptions.value = [observerOption];
      }
    } finally {
      if (generation === playersLoadGeneration) {
        playersLoading.value = false;
        playersLoadPromise = null;
      }
    }
  })();
  playersLoadPromise = { contextId: requestedContextId, promise };
  return promise;
}

/** Invalidate player data and pending work when the dialog context changes. */
function resetPlayerContext(): void {
  playersLoadGeneration++;
  playersLoadPromise = null;
  loadedPlayersContextId = undefined;
  playersLoading.value = false;
  playerOptions.value = [];
  playerCivs.value = {};
  playerIdentities.value = {};
  assignments.value = {};
  diplomacyInitiator.value = null;
  voiceOverride.value = null;
}

/** Default the voice to the derived target seat's configured diplomat. */
function applyTargetVoiceDefault() {
  const target = derivedTargetPlayerID.value;
  if (target === null) return;
  const diplomatName = assignments.value[target]?.diplomat;
  voiceOverride.value = diplomatName
    ? (agents.value.find(a => a.name === diplomatName) ?? null)
    : null;
}

/** Open (or reopen) a civ↔civ diplomacy conversation. */
async function confirmDiplomacy() {
  if (!canStartDiplomacy.value || !props.contextId) return;
  const initiatorID = diplomacyInitiator.value!.value as number;
  const targetID = derivedTargetPlayerID.value!;
  const request: CreateChatRequest = {
    mode: 'diplomacy',
    contextId: props.contextId,
    targetPlayerID: targetID,
    targetIdentity: playerIdentities.value[targetID],
    callerPlayerID: initiatorID,
    callerIdentity: playerIdentities.value[initiatorID],
    callerRole: initiatorRole.value.trim() || undefined,
  };
  if (voiceOverride.value) request.agentName = voiceOverride.value.name;
  const turn = props.span?.attributes?.turn || props.span?.turn || props.turn;
  if (turn !== undefined) request.turn = turn;
  await launchChat(request, 'Failed to open conversation');
}

/** Filter role suggestions for autocomplete */
function searchRoles(event: { query: string }) {
  const query = event.query.toLowerCase();
  filteredRoles.value = userRoleSuggestions.filter(
    role => role.toLowerCase().includes(query)
  );
}

/** React to a conversation-mode switch by loading players for the diplomacy selectors. */
function onConversationModeChange() {
  loadError.value = null;
  clearLaunchError();
  if (conversationMode.value === 'diplomacy' && civPlayerOptions.value.length === 0) {
    loadPlayerOptions();
  }
}

/**
 * Pick an agent from the list. A diplomacy-only agent (e.g. the diplomat) can never run as an
 * ordinary observer chat, so selecting it forces the Diplomacy form: the regular Observer/identity
 * panel is never shown and the clicked agent becomes the conversation voice.
 */
async function selectAgent(agent: AgentInfo) {
  if (agent.diplomacyOnly) {
    selectedAgent.value = null;
    loadError.value = null;
    clearLaunchError();
    conversationMode.value = 'diplomacy';
    if (civPlayerOptions.value.length === 0) await loadPlayerOptions();
    voiceOverride.value = agent;
    return;
  }
  selectedAgent.value = agent;
}

/** Proceed from Step 1 to Step 2, or skip for database contexts */
function proceedToIdentity() {
  if (!selectedAgent.value) return;

  if (!props.contextId) {
    // Database context — skip identity step, use defaults
    userRole.value = 'Observer';
    selectedPlayerOption.value = { label: 'Observer', value: 'observer' };
    confirmSelection();
    return;
  }

  currentStep.value = 'identity';
  loadPlayerOptions();
}

/** Close the dialog and clear all selections, context data, and errors. */
function closeDialog(): void {
  dialogVisible.value = false;
  selectedAgent.value = null;
  currentStep.value = 'agent';
  conversationMode.value = 'observer';
  userRole.value = '';
  selectedPlayerOption.value = null;
  initiatorRole.value = 'the diplomat';
  resetPlayerContext();
  loadError.value = null;
  clearLaunchError();
}

/** Create an observer-style chat using the selected agent and caller identity. */
async function confirmSelection(): Promise<void> {
  if (!selectedAgent.value || !canStartChat.value) return;
  const request: CreateChatRequest = { agentName: selectedAgent.value.name };

  if (props.contextId) {
    request.contextId = props.contextId;
  } else if (props.databasePath) {
    request.databasePath = props.databasePath.includes('/') ? props.databasePath : `telemetry/${props.databasePath}`;
  }

  const turn = props.span?.attributes?.turn || props.span?.turn || props.turn;
  if (turn !== undefined) request.turn = turn;

  request.callerRole = userRole.value.trim();
  if (selectedPlayerOption.value && selectedPlayerOption.value.value !== 'observer') {
    const callerID = selectedPlayerOption.value.value as number;
    request.callerPlayerID = callerID;
    request.callerIdentity = playerIdentities.value[callerID];
  } else {
    request.callerPlayerID = -1;
    request.callerIdentity = OBSERVER_IDENTITY;
  }
  await launchChat(request, 'Failed to create session');
}

// Resolve the chosen seat's civilization as soon as the dialog opens so the header can
// title itself "Chat with {civ}" regardless of conversation mode.
watch(
  () => [props.visible, props.contextId] as const,
  ([visible, contextId], previous) => {
    const contextChanged = previous !== undefined && contextId !== previous[1];
    if (!visible) {
      resetPlayerContext();
      return;
    }
    if (contextChanged) resetPlayerContext();
    void loadAgents();
    if (contextId && Object.keys(playerCivs.value).length === 0) void loadPlayerOptions();
  },
  { immediate: true }
);
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :closable="true"
    :dismissableMask="true"
    :style="{ width: '60vw', minWidth: '640px' }"
    @hide="closeDialog"
  >
    <template #header>
      <h2>{{ dialogTitle }}</h2>
      <div class="context-tags">
        <Tag :value="contextType" severity="info" />
        <Tag v-if="!props.contextId && contextName" :value="contextName" />
        <Tag v-if="contextTurn !== undefined" :value="`Turn ${contextTurn}`" severity="secondary" />
        <Tag v-if="contextSpanName" :value="contextSpanName" severity="contrast" />
      </div>
    </template>

    <!-- Step 1: Agent Selection -->
    <template v-if="currentStep === 'agent'">
      <!-- Conversation type toggle (active game only) -->
      <div v-if="props.contextId" class="mode-toggle">
        <SelectButton
          v-model="conversationMode"
          :options="conversationModeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          @change="onConversationModeChange"
        />
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="loading-container">
        <ProgressSpinner />
        <p>Loading available agents...</p>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="error-container">
        <i class="pi pi-exclamation-triangle"></i>
        <p>{{ error }}</p>
        <Button label="Retry" @click="loadAgents" />
      </div>

      <!-- Diplomacy form -->
      <DiplomacyLaunchForm
        v-else-if="conversationMode === 'diplomacy'"
        v-model:initiator="diplomacyInitiator"
        v-model:role="initiatorRole"
        v-model:voice="voiceOverride"
        :initiatorOptions="civPlayerOptions"
        :suggestions="filteredRoles"
        :voiceOptions="chattableAgents"
        :playersLoading="playersLoading"
        @search-roles="searchRoles"
      />

      <!-- Agent Table (observer chat) -->
      <div v-else class="data-table">
        <!-- Header row -->
        <div class="table-header">
          <div class="col-fixed-150">Name</div>
          <div class="col-expand">Description</div>
          <div class="col-fixed-250">Tags</div>
        </div>

        <!-- Table body -->
        <div class="table-body">
          <div v-if="chattableAgents.length === 0" class="table-empty">
            <i class="pi pi-inbox"></i>
            <p>No agents available</p>
          </div>
          <div
            v-for="agent in chattableAgents"
            :key="agent.name"
            class="table-row clickable"
            :class="{ 'selected': selectedAgent?.name === agent.name }"
            @click="selectAgent(agent)"
          >
            <div class="col-fixed-150">{{ agent.name }}</div>
            <div class="col-expand text-wrap">{{ agent.description }}</div>
            <div class="col-fixed-250">
              <Tag
                v-for="tag in agent.tags"
                :key="tag"
                :value="tag"
                class="mr-2"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Step 2: User Identity -->
    <template v-else-if="currentStep === 'identity'">
      <!-- Error State -->
      <div v-if="error" class="error-container">
        <i class="pi pi-exclamation-triangle"></i>
        <p>{{ error }}</p>
      </div>

      <ObserverIdentityForm
        v-model:role="userRole"
        v-model:player="selectedPlayerOption"
        :suggestions="filteredRoles"
        :playerOptions="playerOptions"
        :playersLoading="playersLoading"
        @search-roles="searchRoles"
      />
    </template>

    <template #footer>
      <!-- Step 1 footer -->
      <template v-if="currentStep === 'agent'">
        <Button
          label="Cancel"
          severity="secondary"
          @click="closeDialog"
        />
        <Button
          v-if="conversationMode === 'diplomacy'"
          :label="isCreatingSession ? 'Opening...' : 'Start Conversation'"
          :disabled="!canStartDiplomacy || isCreatingSession"
          :loading="isCreatingSession"
          @click="confirmDiplomacy"
        />
        <Button
          v-else
          :label="props.contextId ? 'Next' : 'Start Chat'"
          :disabled="!selectedAgent"
          @click="proceedToIdentity"
        />
      </template>

      <!-- Step 2 footer -->
      <template v-else>
        <Button
          label="Back"
          severity="secondary"
          :disabled="isCreatingSession"
          @click="currentStep = 'agent'"
        />
        <Button
          :label="isCreatingSession ? 'Creating Session...' : 'Start Chat'"
          :disabled="!canStartChat || isCreatingSession"
          :loading="isCreatingSession"
          @click="confirmSelection"
        />
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.context-tags {
  display: flex;
  gap: 0.5rem;
}

.mode-toggle {
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
}

.selected {
  font-weight: bold;
  background-color: var(--p-content-hover-background);
}

</style>
