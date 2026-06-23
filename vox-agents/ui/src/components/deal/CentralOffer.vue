<!--
Component: CentralOffer
Purpose: The "deal on the table" — the center of the three-panel trade board (interactive-diplomacy
stage 4). Two aligned columns ("They give" = counterpart / "You give" = you) list the selected terms
under the side that gives them, each editable (amounts, quantities, durations, votes, promise targets)
and removable in place. Structurally impossible terms stay visible in red with their reason as a
tooltip. Below the columns sits the live, sentinel-aware value balance; above them, the optional
one-sentence deal message.

Holds no deal state of its own: it renders the working deal + the index-aligned `inspect-deal` result
the parent passes, and emits edit/remove events the parent applies to the working deal (which
re-inspects live, keeping the per-row legality/value index-aligned).
-->
<template>
  <section class="deal-panel deal-panel-center">
    <header class="deal-panel-title">
      <span>Deal on the table</span>
    </header>

    <!-- Optional one-sentence line voiced alongside the deal (above the offer, per the in-game screen). -->
    <div class="deal-message">
      <InputText v-model="message" class="deal-message-input" :disabled="locked || busy" placeholder="A line to send with the deal (optional)…" />
    </div>

    <div class="deal-offer-columns">
      <div v-for="col in columns" :key="col.sideID" class="deal-offer-col">
        <div class="deal-offer-col-title">{{ col.label }} give</div>
        <ul class="deal-offer-list">
          <!-- Trade items the side gives -->
          <li
            v-for="entry in col.items"
            :key="`item-${entry.index}`"
            class="deal-offer-row"
            :class="{ 'deal-offer-row-illegal': isIllegal(entry.index) }"
            v-tooltip.bottom="isIllegal(entry.index) ? reasonText(entry.index) : ''"
          >
            <span class="deal-offer-label" :class="{ 'deal-offer-label-illegal': isIllegal(entry.index) }">{{ itemLabel(entry.item) }}</span>
            <span v-if="inspectedItems[entry.index]" class="deal-offer-value">
              give {{ fmt(inspectedItems[entry.index]!.valueIfIGive) }} · worth {{ fmt(inspectedItems[entry.index]!.valueIfIReceive) }}
            </span>
            <Button icon="pi pi-times" text rounded size="small" severity="danger" :disabled="locked || busy" @click="$emit('remove-item', entry.index)" />

            <!-- Type-specific central editors -->
            <div v-if="entry.item.itemType === 'GOLD'" class="deal-offer-edit">
              <InputNumber :modelValue="entry.item.amount" :min="0" :max="goldMax(entry.item)" size="small" :disabled="locked || busy" placeholder="Gold"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { amount: v })" />
            </div>
            <div v-else-if="entry.item.itemType === 'GOLD_PER_TURN'" class="deal-offer-edit">
              <InputNumber :modelValue="entry.item.amount" :min="0" size="small" :disabled="locked || busy" placeholder="Gold/turn"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { amount: v })" />
              <InputNumber :modelValue="entry.item.duration" :min="1" size="small" :disabled="locked || busy" placeholder="Turns"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { duration: v })" />
            </div>
            <div v-else-if="entry.item.itemType === 'RESOURCES'" class="deal-offer-edit">
              <InputNumber :modelValue="entry.item.quantity" :min="1" :max="resourceMax(entry.item)" size="small" :disabled="locked || busy" placeholder="Qty"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { quantity: v })" />
              <InputNumber :modelValue="entry.item.duration" :min="1" size="small" :disabled="locked || busy" placeholder="Turns"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { duration: v })" />
            </div>
            <div v-else-if="entry.item.itemType === 'THIRD_PARTY_PEACE'" class="deal-offer-edit">
              <InputNumber :modelValue="entry.item.duration" :min="1" size="small" :disabled="locked || busy" placeholder="Turns"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { duration: v })" />
            </div>
            <div v-else-if="entry.item.itemType === 'VOTE_COMMITMENT'" class="deal-offer-edit">
              <InputNumber :modelValue="entry.item.resolutionID" :min="0" size="small" :disabled="locked || busy" placeholder="Resolution"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { resolutionID: v })" />
              <InputNumber :modelValue="entry.item.voteChoice" size="small" :disabled="locked || busy" placeholder="Choice"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { voteChoice: v })" />
              <InputNumber :modelValue="entry.item.numVotes" :min="1" size="small" :disabled="locked || busy" placeholder="Votes"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { numVotes: v })" />
              <Select :modelValue="!!entry.item.repeal" :options="voteRepealOptions" optionLabel="label" optionValue="value" size="small" :disabled="locked || busy"
                @update:modelValue="(v: boolean) => $emit('update-item', entry.index, { repeal: v })" />
            </div>
          </li>

          <!-- Promises the side pledges (the side is the promiser). The target, when needed, was
               chosen on the inventory row, so the central row only shows + removes it. -->
          <li v-for="entry in col.promises" :key="`promise-${entry.index}`" class="deal-offer-row">
            <span class="deal-offer-label">{{ promiseLabel(entry.promise) }}</span>
            <span v-if="promiseNote(entry.index)" class="deal-offer-value" v-tooltip.bottom="promiseNote(entry.index)">
              <i class="pi pi-info-circle" /> agreeability factors
            </span>
            <Button icon="pi pi-times" text rounded size="small" severity="danger" :disabled="locked || busy" @click="$emit('remove-promise', entry.index)" />
          </li>

          <li v-if="col.items.length === 0 && col.promises.length === 0" class="deal-offer-empty">— nothing —</li>
        </ul>
      </div>
    </div>

    <!-- Live value balance; sentinel estimates are clearly flagged. -->
    <div class="deal-balance">
      <span class="deal-balance-item" :class="balanceClass(youID)">Value to {{ youLabel }}: {{ formatBalance(youID) }}</span>
      <span class="deal-balance-item" :class="balanceClass(counterpartID)">Value to {{ counterpartLabel }}: {{ formatBalance(counterpartID) }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import type { TradeItem, PromiseTerm, InspectedTradeItem, InspectedPromise, NormalizedSideRange, PromiseTargetInfo } from '@/utils/types';
import {
  formatItemLabel,
  formatPromiseLabel,
  formatValue,
  computeSideBalance,
} from './deal-helpers';
import { offerItemsForSide, offerPromisesForSide } from './deal-catalog';

const props = defineProps<{
  items: TradeItem[];
  promises: PromiseTerm[];
  /** Index-aligned with `items` (the server preserves order). */
  inspectedItems: InspectedTradeItem[];
  /** Index-aligned with `promises`. */
  inspectedPromises: InspectedPromise[];
  counterpartID: number;
  youID: number;
  counterpartLabel: string;
  youLabel: string;
  /** Both sides' ranges, keyed by player ID string, for resolving row display names + caps. */
  ranges: Record<string, NormalizedSideRange>;
  /** Eligible third-party promise targets (Coop War major / city-state minor). */
  promiseTargets: PromiseTargetInfo[];
  locked?: boolean;
  busy?: boolean;
}>();

defineEmits<{
  (e: 'update-item', index: number, patch: Partial<TradeItem>): void;
  (e: 'remove-item', index: number): void;
  (e: 'remove-promise', index: number): void;
}>();

/** The one-sentence outward line, two-way bound to the parent's working draft. */
const message = defineModel<string>('message', { default: '' });

/** The two giver columns: counterpart ("They give") then you ("You give"). */
const columns = computed(() => [
  {
    sideID: props.counterpartID,
    label: props.counterpartLabel,
    items: offerItemsForSide(props.items, props.counterpartID),
    promises: offerPromisesForSide(props.promises, props.counterpartID),
  },
  {
    sideID: props.youID,
    label: props.youLabel,
    items: offerItemsForSide(props.items, props.youID),
    promises: offerPromisesForSide(props.promises, props.youID),
  },
]);

const rangeFor = (sideID: number): NormalizedSideRange | undefined => props.ranges[String(sideID)];
const fmt = (v: number) => formatValue(v);
const itemLabel = (item: TradeItem) => formatItemLabel(item, rangeFor(item.fromPlayerID));
const promiseLabel = (p: PromiseTerm) => formatPromiseLabel(p, props.promiseTargets);

const isIllegal = (index: number): boolean => {
  const insp = props.inspectedItems[index];
  return insp ? !insp.legality : false;
};
const reasonText = (index: number): string => props.inspectedItems[index]?.reasons.join('\n') ?? '';
const promiseNote = (index: number): string => props.inspectedPromises[index]?.agreeabilityFactors?.note ?? '';

// ---- value balance ----------------------------------------------------------------------
const balanceFor = (sideID: number) => computeSideBalance(props.items, props.inspectedItems, sideID);
const formatBalance = (sideID: number) => {
  const b = balanceFor(sideID);
  return `${b.net > 0 ? '+' : ''}${formatValue(b.net)}${b.hasSentinel ? ' (some impossible)' : ''}`;
};
const balanceClass = (sideID: number) => {
  const net = balanceFor(sideID).net;
  return net > 0 ? 'balance-positive' : net < 0 ? 'balance-negative' : '';
};

// ---- per-row editor caps ----------------------------------------------------------------
const goldMax = (item: TradeItem): number | undefined => rangeFor(item.fromPlayerID)?.gold.max;
const resourceMax = (item: TradeItem): number | undefined =>
  rangeFor(item.fromPlayerID)?.resources.find((r) => r.resourceID === item.resourceID)?.quantityAvailable;

const voteRepealOptions = [
  { label: 'Enact', value: false },
  { label: 'Repeal', value: true },
];
</script>

<style scoped>
@import '@/styles/deal.css';
.deal-offer-col { min-width: 0; }
</style>
