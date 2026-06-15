<script setup lang="ts">
/**
 * AgentSelectDialog component - two-step modal dialog for selecting an agent and user identity.
 * Step 1: Select an agent from the filtered list.
 * Step 2: Configure user identity (role + player/civ affiliation).
 * Used in ChatView, TelemetrySessionView, TelemetryDatabaseView, and TelemetryTraceView.
 */

import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import ProgressSpinner from 'primevue/progressspinner';
import AutoComplete from 'primevue/autocomplete';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import type { AgentInfo, Span, CreateChatRequest, PlayerAssignment } from '@/utils/types';
import { userRoleSuggestions } from '@/utils/types';
import { apiClient } from '@/api/client';

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
const router = useRouter();

/** Option for the player/civ dropdown */
interface PlayerOption {
  label: string;
  value: number | 'observer';
}

// State
const loading = ref(false);
const error = ref<string | null>(null);
const agents = ref<AgentInfo[]>([]);
const selectedAgent = ref<AgentInfo | null>(null);
const isCreatingSession = ref(false);

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

// Diplomacy form state
const assignments = ref<Record<number, PlayerAssignment>>({});
const diplomacyTarget = ref<PlayerOption | null>(null);
const diplomacyInitiator = ref<PlayerOption | null>(null);
const voiceOverride = ref<AgentInfo | null>(null);
const initiatorRole = ref('the leader');

/** Major-civ player options (no observer) for the diplomacy selectors. */
const civPlayerOptions = computed(() => playerOptions.value.filter(o => o.value !== 'observer'));

/** Whether the diplomacy form is complete enough to open a conversation. */
const canStartDiplomacy = computed(() =>
  diplomacyTarget.value !== null &&
  diplomacyInitiator.value !== null &&
  diplomacyTarget.value.value !== diplomacyInitiator.value.value
);

// Computed properties
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
});

const dialogTitle = computed(() => {
  return currentStep.value === 'agent' ? 'Select Agent' : 'Your Identity';
});

const contextType = computed(() => {
  if (props.contextId) return 'Active Game';
  if (props.databasePath) return 'Database';
  return 'No Context';
});

const contextName = computed(() => {
  if (props.contextId) {
    return props.contextId;
  } else if (props.databasePath) {
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

// Methods
async function loadAgents() {
  loading.value = true;
  error.value = null;

  try {
    const response = await apiClient.getAgents();
    agents.value = response.agents || [];
  } catch (err) {
    console.error('Error loading agents:', err);
    error.value = err instanceof Error ? err.message : 'Failed to load agents';
  } finally {
    loading.value = false;
  }
}

/** Load player options for the identity step */
async function loadPlayerOptions() {
  const observerOption: PlayerOption = { label: 'Observer', value: 'observer' };

  // Only load real players for active game contexts
  if (!props.contextId) {
    playerOptions.value = [observerOption];
    return;
  }

  playersLoading.value = true;
  try {
    const response = await apiClient.getPlayersSummary();
    const options: PlayerOption[] = [];

    for (const [playerId, data] of Object.entries(response.players)) {
      if (typeof data === 'object' && data !== null) {
        options.push({
          label: `${data.Leader} of ${data.Civilization}`,
          value: parseInt(playerId)
        });
      }
    }

    options.push(observerOption);
    playerOptions.value = options;
    assignments.value = response.assignments ?? {};

    // Default the diplomacy initiator to the human-control seat when one exists.
    const humanSeat = Object.entries(assignments.value)
      .find(([, a]) => a.strategist === 'human-strategist');
    if (humanSeat) {
      diplomacyInitiator.value = options.find(o => o.value === parseInt(humanSeat[0])) ?? null;
    }
  } catch (err) {
    console.error('Failed to load players:', err);
    // Gracefully degrade: show only observer
    playerOptions.value = [observerOption];
  } finally {
    playersLoading.value = false;
  }
}

/** When the target civ changes, default the voice to that seat's configured diplomat. */
function onDiplomacyTargetChange() {
  const target = diplomacyTarget.value;
  if (!target || target.value === 'observer') return;
  const diplomatName = assignments.value[target.value as number]?.diplomat;
  voiceOverride.value = diplomatName
    ? (agents.value.find(a => a.name === diplomatName) ?? null)
    : null;
}

/** Open (or reopen) a civ↔civ diplomacy conversation. */
async function confirmDiplomacy() {
  if (!canStartDiplomacy.value || !props.contextId) return;

  isCreatingSession.value = true;
  error.value = null;
  try {
    const request: CreateChatRequest = {
      mode: 'diplomacy',
      contextId: props.contextId,
      targetPlayerID: diplomacyTarget.value!.value as number,
      initiatorPlayerID: diplomacyInitiator.value!.value as number,
      callerRole: initiatorRole.value.trim() || undefined,
    };
    // Only send an explicit voice when the operator overrode the seat's default diplomat.
    if (voiceOverride.value) request.agentName = voiceOverride.value.name;

    const turn = props.span?.attributes?.turn || props.span?.turn || props.turn;
    if (turn !== undefined) request.turn = turn;

    const session = await apiClient.createAgentChat(request);
    router.push({ name: 'chat-detail', params: { sessionId: session.id } });
    closeDialog();
  } catch (err) {
    console.error('Failed to open diplomacy conversation:', err);
    error.value = err instanceof Error ? err.message : 'Failed to open conversation';
  } finally {
    isCreatingSession.value = false;
  }
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
  error.value = null;
  if (conversationMode.value === 'diplomacy' && civPlayerOptions.value.length === 0) {
    loadPlayerOptions();
  }
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

function closeDialog() {
  dialogVisible.value = false;
  selectedAgent.value = null;
  currentStep.value = 'agent';
  conversationMode.value = 'observer';
  userRole.value = '';
  selectedPlayerOption.value = null;
  diplomacyTarget.value = null;
  diplomacyInitiator.value = null;
  voiceOverride.value = null;
  initiatorRole.value = 'the leader';
  error.value = null;
}

async function confirmSelection() {
  if (!selectedAgent.value || !canStartChat.value) return;

  isCreatingSession.value = true;
  error.value = null;

  try {
    // Build the session creation request
    const request: CreateChatRequest = {
      agentName: selectedAgent.value.name
    };

    // Add context based on what's provided
    if (props.contextId) {
      request.contextId = props.contextId;
    } else if (props.databasePath) {
      // Ensure proper path format
      const fullPath = props.databasePath.includes('/')
        ? props.databasePath
        : `telemetry/${props.databasePath}`;
      request.databasePath = fullPath;
    }

    // Add turn if provided (from props or span)
    const turn = props.span?.attributes?.turn || props.span?.turn || props.turn;
    if (turn !== undefined) {
      request.turn = turn;
    }

    // Caller identity (endpoint A): a real seat or the observer sentinel.
    request.callerRole = userRole.value.trim();
    if (selectedPlayerOption.value && selectedPlayerOption.value.value !== 'observer') {
      request.callerPlayerID = selectedPlayerOption.value.value as number;
    } else {
      request.callerPlayerID = -1;
    }

    // Create the chat thread
    const session = await apiClient.createAgentChat(request);

    console.log('Created chat thread:', {
      session,
      agent: selectedAgent.value,
      span: props.span,
      request
    });

    // Navigate to chat session
    router.push({
      name: 'chat-detail',
      params: { sessionId: session.id }
    });

    // Close dialog after navigation
    closeDialog();
  } catch (err) {
    console.error('Failed to create chat session:', err);
    error.value = err instanceof Error ? err.message : 'Failed to create session';
  } finally {
    isCreatingSession.value = false;
  }
}

// Load agents when dialog opens
onMounted(() => {
  loadAgents();
});
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
        <Tag v-if="contextName" :value="contextName" />
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
      <div v-else-if="conversationMode === 'diplomacy'" class="identity-step">
        <div class="identity-form">
          <label for="dipl-target">Target civilization (LLM-voiced)</label>
          <Select
            id="dipl-target"
            v-model="diplomacyTarget"
            :options="civPlayerOptions"
            optionLabel="label"
            placeholder="Select the civilization to talk to..."
            :loading="playersLoading"
            @change="onDiplomacyTargetChange"
          />

          <label for="dipl-initiator">Speaking as (your seat)</label>
          <Select
            id="dipl-initiator"
            v-model="diplomacyInitiator"
            :options="civPlayerOptions"
            optionLabel="label"
            placeholder="Select your seat..."
            :loading="playersLoading"
          />

          <label for="dipl-role">Your role</label>
          <AutoComplete
            id="dipl-role"
            v-model="initiatorRole"
            :suggestions="filteredRoles"
            @complete="searchRoles"
            placeholder="e.g., the leader, a diplomat..."
            :dropdown="true"
          />

          <label for="dipl-voice">Voice (defaults to the target seat's diplomat)</label>
          <Select
            id="dipl-voice"
            v-model="voiceOverride"
            :options="filteredAgents"
            optionLabel="name"
            placeholder="Use the configured diplomat"
            showClear
          />
        </div>
      </div>

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
          <div v-if="filteredAgents.length === 0" class="table-empty">
            <i class="pi pi-inbox"></i>
            <p>No agents available</p>
          </div>
          <div
            v-for="agent in filteredAgents"
            :key="agent.name"
            class="table-row clickable"
            :class="{ 'selected': selectedAgent?.name === agent.name }"
            @click="selectedAgent = agent"
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

      <div class="identity-step">
        <div class="identity-form">
          <label for="user-role">Your Role</label>
          <AutoComplete
            id="user-role"
            v-model="userRole"
            :suggestions="filteredRoles"
            @complete="searchRoles"
            placeholder="e.g., a diplomat, the leader, a military general..."
            :dropdown="true"
          />

          <label for="user-player">Representing</label>
          <Select
            id="user-player"
            v-model="selectedPlayerOption"
            :options="playerOptions"
            optionLabel="label"
            placeholder="Select a player or observer..."
            :loading="playersLoading"
          />
        </div>
      </div>
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
@import '@/styles/states.css';
@import '@/styles/data-table.css';

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

/* Identity step styles */
.identity-step {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.identity-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.identity-form label {
  font-weight: 600;
  color: var(--p-text-color);
}
</style>
