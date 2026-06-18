<!--
Component: DealMessageCard
Purpose: Inline rendering of a deal message inside the conversation stream (the second deal
surface, alongside the configuring dialog). Shows a proposal/counter's terms (you give / they
give) with the proposal-time value to you, or a reject notice. Accept / Reject act inline;
Counter opens the dialog (the parent loads the active proposal there). Preview mode — Accept is
wired but enactment is deferred to stage 6.
-->
<template>
  <div class="deal-card" :class="{ 'deal-card-mine': mine }">
    <div class="deal-card-head">
      <i class="pi" :class="headIcon" />
      <span class="deal-card-title">{{ headline }}</span>
      <span class="deal-card-turn">turn {{ deal.Turn }}</span>
    </div>

    <template v-if="isProposal">
      <div v-if="dealMessage" class="deal-card-message">“{{ dealMessage }}”</div>
      <div v-if="dealRationale" class="deal-card-rationale" v-tooltip.bottom="dealRationale">
        <i class="pi pi-comment" /> rationale
      </div>
      <div class="deal-card-side">
        <span class="deal-card-side-label">{{ youLabel }} give:</span>
        <span class="deal-card-terms">{{ youGiveText }}</span>
      </div>
      <div class="deal-card-side">
        <span class="deal-card-side-label">{{ themLabel }} give:</span>
        <span class="deal-card-terms">{{ themGiveText }}</span>
      </div>
      <div v-if="promisesText" class="deal-card-side">
        <span class="deal-card-side-label">Promises:</span>
        <span class="deal-card-terms">{{ promisesText }}</span>
      </div>
      <div v-if="valueText" class="deal-card-value">value to {{ youLabel }}: {{ valueText }}</div>
    </template>

    <div v-else-if="deal.Content" class="deal-card-terms">{{ deal.Content }}</div>

    <template v-if="isProposal && isActive">
      <div v-if="status === 'open' && !locked" class="deal-card-actions">
        <template v-if="mine">
          <Button label="Counter" size="small" outlined icon="pi pi-replay" @click="$emit('counter', deal.ID)" />
          <Button label="Retract" size="small" text severity="danger" icon="pi pi-times-circle" @click="$emit('reject', deal.ID)" />
        </template>
        <template v-else>
          <Button label="Accept" size="small" severity="success" icon="pi pi-check" @click="$emit('accept', deal.ID)" />
          <Button label="Counter" size="small" outlined icon="pi pi-replay" @click="$emit('counter', deal.ID)" />
          <Button label="Reject" size="small" text severity="danger" icon="pi pi-times-circle" @click="$emit('reject', deal.ID)" />
        </template>
      </div>
      <div v-else-if="statusNote" class="deal-card-status" :class="statusClass">{{ statusNote }}</div>
    </template>
    <div v-else-if="isProposal && !isActive" class="deal-card-superseded">superseded</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import type { DealTranscriptMessage, TradeItem } from '@/utils/types';
import type { DealStatus } from './deal-reduce';
import { sideGives, formatItemLabel, formatPromiseLabel, formatValue, storedBalanceToSide } from './deal-helpers';

const props = withDefaults(defineProps<{
  deal: DealTranscriptMessage;
  /** The viewer ("you") endpoint — the audience/human seat. */
  youID: number;
  /** The other endpoint — the LLM-voiced seat. */
  themID: number;
  youLabel: string;
  themLabel: string;
  /** This card is the latest proposal, so it carries the live status (actions when open). */
  isActive: boolean;
  /** The latest proposal's status — `open` offers actions, else the card shows the outcome. */
  status?: DealStatus;
  /** Closed-this-turn lock disables actions. */
  locked?: boolean;
}>(), { status: 'open' });

defineEmits<{ (e: 'accept', id: number): void; (e: 'reject', id: number): void; (e: 'counter', id: number): void }>();

/** When the active proposal is no longer open, the card shows its outcome instead of actions. */
const statusNote = computed(() => {
  switch (props.status) {
    case 'rejected': return 'Rejected';
    case 'accepted': return 'Accepted';
    case 'enacted': return 'Enacted';
    default: return '';
  }
});
const statusClass = computed(() => (props.status === 'rejected' ? 'status-rejected' : 'status-done'));

const isProposal = computed(() => props.deal.MessageType === 'deal-proposal' || props.deal.MessageType === 'deal-counter');
/** Authored by the viewer ("you") — an outgoing offer, so Counter/Retract rather than Accept. */
const mine = computed(() => props.deal.SpeakerID === props.youID);

const headIcon = computed(() => {
  if (props.deal.MessageType === 'deal-reject') return 'pi-times-circle';
  if (props.deal.MessageType === 'deal-counter') return 'pi-replay';
  return 'pi-briefcase';
});
const headline = computed(() => {
  const who = mine.value ? 'You' : props.themLabel;
  switch (props.deal.MessageType) {
    case 'deal-counter': return `${who} countered`;
    case 'deal-reject': return `${who} rejected the deal`;
    case 'deal-accept': return `${who} accepted`;
    case 'deal-enacted': return 'Deal enacted';
    default: return `${who} proposed a deal`;
  }
});

/** The one-sentence outward line and inward rationale carried on the draft deal. */
const dealMessage = computed(() => props.deal.Payload?.Deal?.message ?? '');
const dealRationale = computed(() => props.deal.Payload?.Deal?.rationale ?? '');

const items = computed<TradeItem[]>(() => props.deal.Payload?.Deal?.items ?? []);
const labelsFor = (sideID: number) => sideGives(items.value, sideID).map(({ item }) => formatItemLabel(item)).join(', ') || '—';
const youGiveText = computed(() => labelsFor(props.youID));
const themGiveText = computed(() => labelsFor(props.themID));
const promisesText = computed(() =>
  (props.deal.Payload?.Deal?.promises ?? [])
    .map((p) => `player ${p.promiserID}: ${formatPromiseLabel(p)}`)
    .join('; ')
);

const valueText = computed(() => {
  const balance = storedBalanceToSide(
    items.value,
    props.deal.Payload?.Value1,
    props.deal.Payload?.Value2,
    props.deal.Player1ID,
    props.deal.Player2ID,
    props.youID
  );
  if (!balance) return '';
  return `${balance.net > 0 ? '+' : ''}${formatValue(balance.net)}${balance.hasSentinel ? ' (some impossible)' : ''}`;
});
</script>

<style scoped>
.deal-card {
  border: 1px solid var(--p-content-border-color);
  border-left: 3px solid var(--p-primary-color);
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  margin: 0.35rem 0;
  background: var(--p-content-background);
  font-size: 0.9rem;
}
.deal-card-mine { border-left-color: var(--p-surface-400); }
.deal-card-head { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.3rem; }
.deal-card-title { font-weight: 600; }
.deal-card-turn { margin-left: auto; font-size: 0.75rem; color: var(--p-text-muted-color); }
.deal-card-side { display: flex; gap: 0.4rem; padding: 0.1rem 0; }
.deal-card-side-label { color: var(--p-text-muted-color); min-width: 7rem; }
.deal-card-terms { flex: 1; }
.deal-card-message { font-style: italic; margin-bottom: 0.3rem; }
.deal-card-rationale { font-size: 0.75rem; color: var(--p-text-muted-color); margin-bottom: 0.3rem; cursor: help; }
.deal-card-value { font-size: 0.8rem; color: var(--p-text-muted-color); margin-top: 0.25rem; }
.deal-card-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
.deal-card-superseded { font-size: 0.75rem; color: var(--p-text-muted-color); margin-top: 0.35rem; font-style: italic; }
.deal-card-status { font-size: 0.8rem; font-weight: 600; margin-top: 0.35rem; }
.status-rejected { color: var(--p-red-500); }
.status-done { color: var(--p-green-500); }
</style>
