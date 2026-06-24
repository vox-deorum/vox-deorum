<!--
Component: CentralOffer
Purpose: The "deal on the table" — the center of the three-panel trade board (interactive-diplomacy
stage 4). Two aligned columns ("They give" = counterpart / "You give" = you) list the selected terms
under the side that gives them, with editable amounts, quantities, votes, and promise targets plus
read-only fixed durations, and removable in place. Structurally impossible terms stay visible in red
with their reason as a tooltip. Below the columns sits the live, sentinel-aware value balance; above
them, the optional one-sentence deal message.

Holds no deal state of its own: it renders the working deal + the index-aligned `inspect-deal` result
the parent passes, and emits edit/remove events the parent applies to the working deal (which
re-inspects live, keeping the per-row legality/value index-aligned).
-->
<template>
  <section class="deal-panel deal-panel-center">
    <header class="deal-panel-title">
      <span>Deal on the table</span>
    </header>

    <div class="deal-offer-columns">
      <div v-for="col in columns" :key="col.sideID" class="deal-offer-col">
        <div class="deal-offer-col-title">{{ col.label }} give</div>
        <ul class="deal-offer-list">
          <!-- Trade items the side gives. Compact: a name+remove line, with an optional inline
               `[number] × [turns] turns` editor line only for the duration/amount-bearing types. The
               per-term give/worth value lives in the row tooltip (the live balance below sums it). -->
          <li
            v-for="entry in col.items"
            :key="`item-${entry.index}`"
            class="deal-offer-row"
            :class="{ 'deal-offer-row-illegal': isIllegal(entry.index) }"
            v-tooltip.bottom="itemTooltip(entry.index)"
          >
            <div class="deal-offer-main">
              <span class="deal-offer-label" :class="{ 'deal-offer-label-illegal': isIllegal(entry.index) }">{{ itemLabel(entry.item) }}</span>
              <Button class="deal-offer-x" icon="pi pi-times" text rounded size="small" severity="danger" :disabled="locked || busy" @click="$emit('remove-item', entry.index)" />
            </div>

            <!-- Type-specific editors. Only the amount/quantity is editable; the duration is a fixed
                 game value shown read-only as "× N turns". Items without an editable amount (peace,
                 agreements, votes, cities, techs, war) have no editor — their fixed duration, when
                 any, sits in the label as "(Nt)". -->
            <div v-if="entry.item.itemType === 'GOLD'" class="deal-offer-edit">
              <InputNumber class="deal-num" :modelValue="entry.item.amount" :min="0" :max="goldMax(entry.item)" :useGrouping="false" size="small" :disabled="locked || busy"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { amount: v })" />
            </div>
            <div v-else-if="entry.item.itemType === 'GOLD_PER_TURN'" class="deal-offer-edit">
              <InputNumber class="deal-num" :modelValue="entry.item.amount" :min="1" :useGrouping="false" size="small" :disabled="locked || busy"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { amount: v })" />
              <template v-if="durationText(entry.item)">
                <span class="deal-times">×</span>
                <span class="deal-unit">{{ durationText(entry.item) }}</span>
              </template>
            </div>
            <div v-else-if="entry.item.itemType === 'RESOURCES'" class="deal-offer-edit">
              <InputNumber class="deal-num" :modelValue="entry.item.quantity" :min="1" :max="resourceMax(entry.item)" :useGrouping="false" size="small" :disabled="locked || busy"
                @update:modelValue="(v: number) => $emit('update-item', entry.index, { quantity: v })" />
              <template v-if="durationText(entry.item)">
                <span class="deal-times">×</span>
                <span class="deal-unit">{{ durationText(entry.item) }}</span>
              </template>
            </div>
          </li>

          <!-- Promises the side pledges (the side is the promiser). The target, when needed, was
               chosen on the inventory row, so the central row only shows + removes it. Agreeability
               factors, when present, surface in the row tooltip. -->
          <li
            v-for="entry in col.promises"
            :key="`promise-${entry.index}`"
            class="deal-offer-row"
            v-tooltip.bottom="promiseNote(entry.index)"
          >
            <div class="deal-offer-main">
              <span class="deal-offer-label">{{ promiseLabel(entry.promise) }}</span>
              <i v-if="promiseNote(entry.index)" class="pi pi-info-circle deal-offer-note" />
              <Button class="deal-offer-x" icon="pi pi-times" text rounded size="small" severity="danger" :disabled="locked || busy" @click="$emit('remove-promise', entry.index)" />
            </div>
          </li>

          <li v-if="col.items.length === 0 && col.promises.length === 0" class="deal-offer-empty">— nothing —</li>
        </ul>
      </div>
    </div>

    <!-- Optional one-sentence line voiced alongside the deal, placed right above the value balance
         (the last thing read before proposing). -->
    <div class="deal-message">
      <InputText v-model="message" class="deal-message-input" :disabled="locked || busy" placeholder="A line to send with the deal (optional)…" />
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
/**
 * The item types whose editor line shows the fixed duration inline ("× N turns"). Their label omits
 * the duration to avoid showing it twice; every other row carries its fixed duration in the label.
 */
const DURATION_INLINE_TYPES = new Set<TradeItem['itemType']>(['GOLD_PER_TURN', 'RESOURCES']);
const itemLabel = (item: TradeItem) =>
  formatItemLabel(item, rangeFor(item.fromPlayerID), { omitDuration: DURATION_INLINE_TYPES.has(item.itemType) });
const promiseLabel = (p: PromiseTerm) => formatPromiseLabel(p, props.promiseTargets);
/** Fixed-duration text for inline amount rows; hidden when older/mock data has no duration. */
const durationText = (item: TradeItem): string => item.duration === undefined ? '' : `${item.duration} turns`;

const isIllegal = (index: number): boolean => {
  const insp = props.inspectedItems[index];
  return insp ? !insp.legality : false;
};
const reasonText = (index: number): string => props.inspectedItems[index]?.reasons.join('\n') ?? '';
const promiseNote = (index: number): string => props.inspectedPromises[index]?.agreeabilityFactors?.note ?? '';

/**
 * The item row's hover tooltip: the untradeable reason when illegal, else the per-term give/worth
 * (the in-game screen shows no per-row value inline; the live balance below carries the running net).
 */
const itemTooltip = (index: number): string => {
  if (isIllegal(index)) return reasonText(index);
  const insp = props.inspectedItems[index];
  return insp ? `Give ${fmt(insp.valueIfIGive)} · worth ${fmt(insp.valueIfIReceive)}` : '';
};

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
</script>

<style scoped>
@import '@/styles/deal.css';
.deal-offer-col { min-width: 0; }

/* Narrow inline number cells: pin the inline-flex wrapper AND the inner input PrimeVue renders
   (the row is a flex container, so an un-pinned wrapper would stretch). Mirrors the proven
   `.compact-number-field :deep(.p-inputnumber-input)` idiom in ConfigDialog.vue. */
.deal-num.p-inputnumber { width: 3.4rem; }
.deal-num :deep(.p-inputnumber-input) {
  width: 3.4rem;
  padding: 0.15rem 0.3rem;
  font-size: 0.78rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
