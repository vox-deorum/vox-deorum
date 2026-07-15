<!--
Component: InventoryPanel
Purpose: One side's categorized, independently-scrolling inventory in the three-panel deal board
(interactive-diplomacy stage 4) — the left "your items" or right "counterpart" column of the
in-game trade screen.

Pure-presentational: it renders a precomputed `InventoryCategory[]` (built by the parent via
`buildSideCatalog`) and emits `add-term` when a row is clicked. Direct rows add immediately with
default parameters (edited later on the central offer). Rows that need a target (targeted promises,
third-party peace/war) are EXPANDABLE: clicking reveals the eligible targets, and clicking a target
adds the already-targeted term. Illegitimate third-party / coop-war targets are hidden outright (kept
only when already on the deal, so they still show as "on the table"; the pledge is removed on the
central offer, not here); other structurally impossible rows are red and not addable (their reason is
a tooltip); singletons already on the table are shown selected.
-->
<template>
  <section class="deal-panel" :class="`deal-panel-${side}`">
    <header class="deal-panel-title">
      <span>{{ label }}</span>
      <span class="deal-row-secondary">offers</span>
    </header>
    <div class="deal-panel-scroll">
      <div v-for="category in visibleCategories" :key="category.kind" class="deal-category">
        <div class="deal-category-title">{{ category.title }}</div>
        <template v-for="row in category.rows" :key="row.key">
          <!-- Expandable target row: choose the third party here, on the inventory row. -->
          <template v-if="row.targets">
            <button
              type="button"
              class="deal-row deal-row-expandable"
              :class="{ 'deal-row-open': expandedKey === row.key }"
              :aria-disabled="locked || busy"
              @click="toggle(row.key)"
            >
              <span class="deal-row-label">{{ row.label }}</span>
              <span class="deal-row-secondary">{{ row.secondary }}</span>
              <i class="pi" :class="expandedKey === row.key ? 'pi-chevron-down' : 'pi-chevron-right'" />
            </button>
            <div v-if="expandedKey === row.key" class="deal-row-targets">
              <button
                v-for="t in row.targets"
                :key="t.key"
                type="button"
                class="deal-row deal-row-target"
                :class="{ 'deal-row-illegal': !t.legal, 'deal-row-selected': t.selected }"
                :aria-disabled="!t.legal || t.selected || locked || busy"
                v-tooltip.right="targetTooltip(t)"
                @click="onTarget(t)"
              >
                <span class="deal-row-label">{{ t.label }}</span>
                <span v-if="t.selected" class="deal-row-secondary">on the table</span>
              </button>
              <div v-if="row.targets.length === 0" class="deal-category-empty">no eligible targets</div>
            </div>
          </template>

          <!-- Direct-add row. -->
          <button
            v-else
            type="button"
            class="deal-row"
            :class="{ 'deal-row-illegal': !row.legal, 'deal-row-selected': row.selected }"
            :aria-disabled="!row.legal || row.selected || locked || busy"
            v-tooltip.right="rowTooltip(row)"
            @click="onClick(row)"
          >
            <span class="deal-row-label">{{ row.label }}</span>
            <span v-if="row.selected" class="deal-row-secondary">on the table</span>
            <span v-else-if="row.secondary" class="deal-row-secondary">{{ row.secondary }}</span>
          </button>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { InventoryCategory, InventoryRow, InventoryTarget, AddTermPayload } from '@/utils/deal/deal-catalog';

const props = defineProps<{
  /** Which physical column this panel occupies. */
  side: 'left' | 'right';
  /** Panel heading (the giver's display label). */
  label: string;
  /** Precomputed categories for this side (from `buildSideCatalog`). */
  categories: InventoryCategory[];
  /** Conversation closed this turn → no adds. */
  locked?: boolean;
  /** A deal write is in flight → no adds. */
  busy?: boolean;
}>();

const emit = defineEmits<{ (e: 'add-term', payload: AddTermPayload): void }>();

/** Hide categories with no rows (gold / World Congress / promises always have rows). */
const visibleCategories = computed(() => props.categories.filter((c) => c.rows.length > 0));

/** The single expanded target row, if any (one open at a time). */
const expandedKey = ref<string | null>(null);
const toggle = (key: string) => {
  if (props.locked || props.busy) return; // aria-disabled (not native) — guard the click here
  expandedKey.value = expandedKey.value === key ? null : key;
};

/** An illegal row/target exposes its reason lines as a tooltip; a legal one has none. */
const rowTooltip = (row: InventoryRow): string => (row.legal ? '' : row.reasons.join('\n'));
const targetTooltip = (t: InventoryTarget): string => (t.legal ? '' : t.reasons.join('\n'));

const onClick = (row: InventoryRow) => {
  if (!row.addPayload || !row.legal || row.selected || props.locked || props.busy) return;
  emit('add-term', row.addPayload);
};

const onTarget = (t: InventoryTarget) => {
  if (!t.legal || t.selected || props.locked || props.busy) return;
  emit('add-term', t.addPayload);
  expandedKey.value = null;
};
</script>

<style scoped>
@import '@/styles/deal.css';
</style>
