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
      <!-- Two aligned columns ("You give" | "They give"), mirroring the deal screen's central
           offer: each side lists the items it gives then the promises it pledges. -->
      <div class="deal-card-columns">
        <div v-for="col in columns" :key="col.sideID" class="deal-card-col">
          <div class="deal-card-col-title">{{ col.label }} give</div>
          <ul class="deal-card-list">
            <li v-for="(label, i) in col.itemLabels" :key="`item-${i}`">{{ label }}</li>
            <li v-for="(label, i) in col.promiseLabels" :key="`promise-${i}`" class="deal-card-promise">{{ label }}</li>
            <li v-if="col.itemLabels.length === 0 && col.promiseLabels.length === 0" class="deal-card-empty">— nothing —</li>
          </ul>
        </div>
      </div>
      <div v-if="valueText" class="deal-card-value">value to {{ youLabel }}: {{ valueText }}</div>
    </template>

    <div v-else-if="deal.Content" class="deal-card-terms">{{ deal.Content }}</div>

    <template v-if="isProposal && isActive">
      <div v-if="status === 'open' && !locked" class="deal-card-actions">
        <template v-if="mine">
          <Button label="Counter" size="small" outlined icon="pi pi-replay" :disabled="busy" @click="$emit('counter', deal.ID)" />
          <Button label="Retract" size="small" text severity="danger" icon="pi pi-times-circle" :disabled="busy" @click="$emit('reject', deal.ID)" />
        </template>
        <template v-else>
          <Button label="Accept" size="small" severity="success" icon="pi pi-check" :disabled="busy" @click="$emit('accept', deal.ID)" />
          <Button label="Counter" size="small" outlined icon="pi pi-replay" :disabled="busy" @click="$emit('counter', deal.ID)" />
          <Button label="Reject" size="small" text severity="danger" icon="pi pi-times-circle" :disabled="busy" @click="$emit('reject', deal.ID)" />
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
import type { DealTranscriptMessage, TradeItem, PromiseTerm } from '@/utils/types';
import type { DealStatus } from './deal-reduce';
import { formatItemLabel, formatPromiseLabel, formatValue, storedBalanceToSide } from './deal-helpers';
import { offerColumnsFor } from './deal-catalog';

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
  /** Another deal action is already in flight from this conversation surface. */
  busy?: boolean;
}>(), { status: 'open', busy: false });

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
const promises = computed<PromiseTerm[]>(() => props.deal.Payload?.Deal?.promises ?? []);

/** The two giver columns ("You give" | "They give"), each carrying the side's item labels then
 *  its pledged-promise labels — the compact, read-only mirror of the deal screen's central offer
 *  (no editors/targets, so labels use the graceful no-range/no-target fallbacks). */
const columns = computed(() =>
  offerColumnsFor(items.value, promises.value, [
    { sideID: props.youID, label: props.youLabel },
    { sideID: props.themID, label: props.themLabel },
  ]).map(({ sideID, label, items: columnItems, promises: columnPromises }) => ({
    sideID,
    label,
    itemLabels: columnItems.map(({ item }) => formatItemLabel(item)),
    promiseLabels: columnPromises.map(({ promise }) => formatPromiseLabel(promise)),
  }))
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
  return `${balance.net > 0 ? '+' : ''}${formatValue(balance.net)}${balance.hasSentinel ? ' (some have no usable estimate)' : ''}`;
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
.deal-card-terms { flex: 1; }
/* You give | They give — the compact two-column mirror of the deal screen's central offer. */
.deal-card-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin: 0.2rem 0; }
.deal-card-col { min-width: 0; }
.deal-card-col-title { color: var(--p-text-muted-color); font-size: 0.78rem; font-weight: 600; margin-bottom: 0.2rem; }
.deal-card-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.1rem; }
.deal-card-list li { font-size: 0.85rem; word-break: break-word; }
.deal-card-promise { color: var(--p-text-muted-color); }
.deal-card-empty { color: var(--p-text-muted-color); font-size: 0.8rem; }
.deal-card-message { font-style: italic; margin-bottom: 0.3rem; }
.deal-card-rationale { font-size: 0.75rem; color: var(--p-text-muted-color); margin-bottom: 0.3rem; cursor: help; }
.deal-card-value { font-size: 0.8rem; color: var(--p-text-muted-color); margin-top: 0.25rem; }
.deal-card-actions { display: flex; gap: 0.4rem; margin-top: 0.5rem; }
.deal-card-superseded { font-size: 0.75rem; color: var(--p-text-muted-color); margin-top: 0.35rem; font-style: italic; }
.deal-card-status { font-size: 0.8rem; font-weight: 600; margin-top: 0.35rem; }
.status-rejected { color: var(--p-red-500); }
.status-done { color: var(--p-green-500); }
</style>
