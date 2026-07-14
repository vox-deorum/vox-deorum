<script setup lang="ts">
/**
 * PlayersSummaryDialog component - modal dialog for viewing all major players' in-game state
 * Polls the MCP server every 60 seconds while open
 */

import { ref, computed, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import { api } from '@/api/client';
import { activeSessions, startActiveSessionPolling } from '@/stores/telemetry';
import type { TelemetrySession } from '@/utils/types';

// Props interface
interface Props {
  visible: boolean;
}

// Emits interface
interface Emits {
  (e: 'update:visible', value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const router = useRouter();

// State
const loading = ref(false);
const error = ref<string | null>(null);
const playersData = ref<Record<string, any>>({});
const assignments = ref<Record<number, { strategist: string; model?: string; configSlot: number }>>({});
const lastUpdated = ref<Date | null>(null);
let pollInterval: number | null = null;
let releaseSessionPolling: (() => void) | null = null;

// Computed properties
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value)
});

// Sorted players by Player ID
const sortedPlayers = computed(() => {
  return Object.entries(playersData.value)
    .map(([playerId, data]) => ({
      playerId,
      ...data
    }))
    .sort((a, b) => parseInt(a.playerId) - parseInt(b.playerId));
});

// Methods
async function loadPlayers() {
  loading.value = true;
  error.value = null;

  try {
    const response = await api.getPlayersSummary();
    playersData.value = response.players;
    assignments.value = response.assignments ?? {};
    lastUpdated.value = new Date();
  } catch (err) {
    console.error('Error loading players:', err);
    error.value = err instanceof Error ? err.message : 'Failed to load players';
  } finally {
    loading.value = false;
  }
}

function closeDialog() {
  dialogVisible.value = false;
  error.value = null;
}

function formatGold(gold: number | undefined, goldPerTurn: number | undefined): string {
  if (gold === undefined) return 'N/A';
  if (goldPerTurn === undefined) return gold.toString();
  const sign = goldPerTurn >= 0 ? '+' : '';
  return `${gold} (${sign}${goldPerTurn})`;
}

function formatMilitary(strength: number | undefined, units: number | undefined, supply: number | undefined): string {
  if (strength === undefined) return 'N/A';
  if (units === undefined || supply === undefined) return strength.toString();
  return `${strength} (${units}/${supply})`;
}

function formatPolicies(policyBranches: Record<string, string[]> | undefined): string {
  if (!policyBranches || Object.keys(policyBranches).length === 0) return 'None';

  return Object.entries(policyBranches)
    .map(([branch, policies]) => `${branch}: ${policies.length}`)
    .join(', ');
}

function formatEra(era: string | undefined): string {
  if (!era) return 'N/A';
  // Remove ERA_ prefix if present
  return era.replace(/^ERA_/, '');
}

// Precomputed tooltip map keyed by player ID string
const assignmentTooltips = computed(() => {
  const map: Record<string, string> = {};
  for (const [pid, assignment] of Object.entries(assignments.value)) {
    const model = assignment.model?.split('/').pop() ?? '';
    const label = model ? `${model} / ${assignment.strategist}` : assignment.strategist;
    map[pid] = `Slot ${assignment.configSlot}: ${label}`;
  }
  return map;
});

const sessionsByPlayer = computed(() => {
  const sessions: Record<string, TelemetrySession[]> = {};
  for (const session of activeSessions.value) {
    if (session.playerID) {
      (sessions[session.playerID] ??= []).push(session);
    }
  }
  return sessions;
});

function getPrimarySession(playerId: string): TelemetrySession | undefined {
  return sessionsByPlayer.value[playerId]?.[0];
}

function navigateToSession(sessionId: string) {
  dialogVisible.value = false;
  router.push({ name: 'telemetry-session', params: { sessionId } });
}

function formatLastUpdated(): string {
  if (!lastUpdated.value) return '';
  const now = new Date();
  const diff = Math.floor((now.getTime() - lastUpdated.value.getTime()) / 1000);
  if (diff < 5) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  const minutes = Math.floor(diff / 60);
  return `${minutes}m ago`;
}

// Start polling when dialog opens
watch(dialogVisible, (visible) => {
  if (visible) {
    loadPlayers();
    releaseSessionPolling = startActiveSessionPolling();

    // Poll every 60 seconds
    pollInterval = window.setInterval(() => {
      loadPlayers();
    }, 60000);
  } else {
    releaseSessionPolling?.();
    releaseSessionPolling = null;
    // Clear interval when dialog closes
    if (pollInterval !== null) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }
});

// Cleanup on unmount
onUnmounted(() => {
  releaseSessionPolling?.();
  releaseSessionPolling = null;
  if (pollInterval !== null) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
});
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :closable="true"
    :dismissableMask="true"
    :style="{ width: '80vw', minWidth: '900px' }"
    @hide="closeDialog"
  >
    <template #header>
      <div class="header-content">
        <h2>Players Summary</h2>
        <span v-if="lastUpdated" class="last-updated">{{ formatLastUpdated() }}</span>
      </div>
    </template>

    <!-- Loading State -->
    <div v-if="loading && Object.keys(playersData).length === 0" class="loading-container">
      <ProgressSpinner />
      <p>Loading players...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <i class="pi pi-exclamation-triangle"></i>
      <p>{{ error }}</p>
      <button @click="loadPlayers">Retry</button>
    </div>

    <!-- Players Table -->
    <div v-else class="data-table">
      <!-- Header row -->
      <div class="table-header">
        <div class="col-fixed-150">Civilization</div>
        <div class="col-fixed-80">Score</div>
        <div class="col-fixed-120">Era</div>
        <div class="col-fixed-100">Cities / Pop</div>
        <div class="col-fixed-120">Gold</div>
        <div class="col-fixed-150">Military</div>
        <div class="col-fixed-80">Techs</div>
        <div class="col-expand">Policies</div>
      </div>

      <!-- Table body -->
      <div class="table-body">
        <div v-if="sortedPlayers.length === 0" class="table-empty">
          <i class="pi pi-inbox"></i>
          <p>No players found</p>
        </div>
        <div
          v-for="player in sortedPlayers"
          :key="player.playerId"
          class="table-row"
        >
          <div class="col-fixed-150" v-tooltip.top="assignmentTooltips[player.playerId]">
            <div class="player-heading">
              <span>{{ player.playerId }}: {{ player.Civilization || 'Unknown' }}</span>
              <a
                v-if="getPrimarySession(player.playerId)"
                class="telemetry-link"
                @click.prevent="navigateToSession(getPrimarySession(player.playerId)!.sessionId)"
                href="#"
              ><i class="pi pi-chart-line"></i></a>
            </div>
          </div>
          <div class="col-fixed-80">{{ player.Score ?? 'N/A' }}</div>
          <div class="col-fixed-120">{{ formatEra(player.Era) }}</div>
          <div class="col-fixed-100">{{ player.Cities ?? 0 }} / {{ player.Population ?? 0 }}</div>
          <div class="col-fixed-120">{{ formatGold(player.Gold, player.GoldPerTurn) }}</div>
          <div class="col-fixed-150">{{ formatMilitary(player.MilitaryStrength, player.MilitaryUnits, player.MilitarySupply) }}</div>
          <div class="col-fixed-80">{{ player.Technologies ?? 0 }}</div>
          <div class="col-expand">{{ formatPolicies(player.PolicyBranches) }}</div>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.header-content {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

.header-content h2 {
  margin: 0;
  flex: 1;
}

.last-updated {
  font-size: 0.875rem;
  color: var(--p-text-secondary-color);
  font-weight: normal;
}

.player-heading {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.telemetry-link {
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}

.telemetry-link:hover {
  color: var(--p-primary-color);
}
</style>
