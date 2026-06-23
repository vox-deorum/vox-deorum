<!--
Component: DealScreen
Purpose: Web replica of the in-game diplomatic trade screen (interactive-diplomacy stage 4) — a
three-panel board: counterpart inventory | deal on the table | your inventory.

Driven entirely by the read-only `inspect-deal` tool (the screen holds no deal state of its own
beyond the in-progress proposal): it builds both sides' categorized inventories from the tradable
range, lets the human build/modify a deal with live per-term legality + value feedback, shows the
other-side value balance summed live, and presents the proposal-state actions (Propose; or
Refuse/Counter/Accept; or Retract/Counter). Preview mode — proposal/counter round-trip through the
durable store; acceptance is wired but deferred to enactment (stage 6).

Orchestration (loading, debounced live inspection with latest-request-wins, proposal freshness,
writes) lives here; the three visual regions are the InventoryPanel / CentralOffer components, and
the categorized inventory model + value math are pure helpers (deal-catalog.ts / deal-helpers.ts).
-->
<template>
  <div class="deal-screen">
    <Message v-if="error" severity="error" :closable="true" @close="error = ''">{{ error }}</Message>
    <Message v-if="!inspection && !error" severity="secondary">Loading the tradable range…</Message>

    <!-- The board never stacks; on a narrow viewport the wrapper scrolls horizontally. -->
    <div v-if="inspection" class="deal-board-scroll">
      <div class="deal-board">
        <!-- Left = the counterpart's inventory. -->
        <InventoryPanel
          side="left"
          :label="counterpartLabel"
          :categories="counterpartCategories"
          :locked="locked"
          :busy="busy"
          @add-term="onAddTerm"
        />

        <!-- Center = the deal on the table. -->
        <CentralOffer
          :items="workingDeal.items"
          :promises="workingDeal.promises"
          :inspected-items="inspection.items"
          :inspected-promises="inspection.promises"
          :counterpart-i-d="counterpartID"
          :you-i-d="youID"
          :counterpart-label="counterpartLabel"
          :you-label="youLabel"
          :ranges="inspection.tradableRange"
          :promise-targets="promiseTargets"
          v-model:message="dealMessage"
          :locked="locked"
          :busy="busy"
          @update-item="onUpdateItem"
          @remove-item="onRemoveItem"
          @remove-promise="onRemovePromise"
        />

        <!-- Right = your inventory. -->
        <InventoryPanel
          side="right"
          :label="youLabel"
          :categories="youCategories"
          :locked="locked"
          :busy="busy"
          @add-term="onAddTerm"
        />
      </div>
    </div>

    <!-- Proposal-state actions. -->
    <div class="deal-actions">
      <span v-if="locked" class="deal-muted">Conversation closed this turn — deal actions are locked.</span>
      <template v-else>
        <Button v-if="!hasOpenProposal" label="Propose" icon="pi pi-send" :loading="busy" :disabled="!canPropose" @click="doPropose" />
        <Button v-if="hasOpenProposal" label="Counter" icon="pi pi-replay" severity="secondary" :loading="busy" :disabled="!canCounter" @click="doCounter" />
        <!-- Accept records the STORED proposal; once the draft is edited it would no longer match, so hide it. -->
        <Button v-if="hasOpenProposal && !activeAuthoredByViewer && !dealEdited" label="Accept" icon="pi pi-check" severity="success" :loading="busy" :disabled="!canAccept" @click="doAccept" />
        <Button v-if="hasOpenProposal && dealEdited" label="Reset" icon="pi pi-undo" severity="secondary" text :disabled="busy" @click="resetToActiveProposal" v-tooltip.bottom="'Discard edits and restore the original proposal'" />
        <Button
          v-if="hasOpenProposal"
          :label="activeAuthoredByViewer ? 'Retract' : 'Refuse'"
          icon="pi pi-times-circle"
          severity="danger"
          :loading="busy"
          :disabled="!canReject"
          @click="doReject"
        />
        <span v-if="hasOpenProposal && !activeAuthoredByViewer && dealEdited" class="deal-muted">
          You’ve changed this proposal — send it as a Counter, or Reset to accept the original.
        </span>
        <span v-else-if="hasOpenProposal && !activeAuthoredByViewer && hasIllegalTerm" class="deal-muted">
          Remove or fix the impossible term (red) to accept.
        </span>
      </template>
    </div>

    <!-- Subdued board-level status: proposal state, live-inspection progress, reload. -->
    <div class="deal-status">
      <Tag v-if="reduction.status === 'open'" value="Active proposal" severity="info" />
      <Tag v-else-if="reduction.status === 'rejected'" value="Last proposal rejected" severity="warn" />
      <Tag v-else-if="reduction.status === 'enacted'" value="Enacted" severity="success" />
      <span v-if="inspecting" class="deal-muted"><i class="pi pi-spin pi-spinner" /> evaluating…</span>
      <Button
        class="deal-refresh"
        icon="pi pi-refresh"
        text
        rounded
        size="small"
        :disabled="busy"
        @click="reloadDeals"
        v-tooltip.bottom="'Reload proposals & re-evaluate'"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api/client';
import type { DealPayload, TradeItem, InspectDealResponse, NormalizedSideRange, PromiseTargetInfo } from '@/utils/types';
import { deriveActiveProposal, type DealReduction } from './deal-reduce';
import { buildSideCatalog, type AddTermPayload } from './deal-catalog';
import InventoryPanel from './InventoryPanel.vue';
import CentralOffer from './CentralOffer.vue';

const props = defineProps<{
  chatId: string;
  /** Left ("you") endpoint — the human/audience seat. */
  leftID: number;
  /** Right ("them") endpoint — the LLM-voiced seat. */
  rightID: number;
  leftLabel: string;
  rightLabel: string;
  /** Closed-this-turn lock: deal actions are disabled (specs §8). */
  locked?: boolean;
}>();

const emit = defineEmits<{ (e: 'changed'): void }>();
/**
 * Whether a deal write is in flight. A two-way model so the parent view shares ONE busy flag
 * across both deal surfaces (this screen and the inline message-card actions): any in-flight
 * action disables the controls on both. Defaults to a local-only flag when mounted standalone.
 */
const busy = defineModel<boolean>('busy', { default: false });
const toast = useToast();

const emptyDeal = (): DealPayload => ({ version: 1, items: [], promises: [] });
const workingDeal = ref<DealPayload>(emptyDeal());
/** Optional one-sentence note the human attaches to the deal (Payload.Deal.message). */
const dealMessage = ref('');
/**
 * Whether the human has changed the terms of the active proposal in the editor. `Accept` records
 * acceptance of the STORED proposal (by `proposalMessageID`), not the edited draft, so an edited
 * draft must never be acceptable — once edited, Accept is hidden (Counter only) until `Reset`
 * restores the original terms. Reset to false whenever the active proposal is (re)loaded.
 */
const dealEdited = ref(false);
const inspection = ref<InspectDealResponse | null>(null);
const reduction = ref<DealReduction>({ active: null, status: 'none', proposals: [] });
const inspecting = ref(false);
const error = ref('');

/**
 * Display orientation: the host passes the audience as `leftID` and the LLM seat as `rightID`,
 * but the in-game board puts the COUNTERPART on the left and YOU on the right. Keep that
 * inversion in one place so the panels, columns, and giver semantics never disagree.
 */
const counterpartID = computed(() => props.rightID);
const youID = computed(() => props.leftID);
const counterpartLabel = computed(() => props.rightLabel);
const youLabel = computed(() => props.leftLabel);

// ---- inventory catalogs (recompute as the range or working deal changes) -----------------
const rangeFor = (id: number): NormalizedSideRange | undefined => inspection.value?.tradableRange[String(id)];
const promiseTargets = computed<PromiseTargetInfo[]>(() => inspection.value?.promiseTargets ?? []);
const buildCatalogFor = (ownerID: number, otherID: number) =>
  buildSideCatalog({
    ownerID,
    otherID,
    range: rangeFor(ownerID),
    currentItems: workingDeal.value.items,
    currentPromises: workingDeal.value.promises,
    defaultDuration: inspection.value?.defaultDuration,
    promiseTargets: promiseTargets.value,
  });
const counterpartCategories = computed(() => buildCatalogFor(counterpartID.value, youID.value));
const youCategories = computed(() => buildCatalogFor(youID.value, counterpartID.value));

// ---- proposal-state guards --------------------------------------------------------------
const hasTerms = computed(() => workingDeal.value.items.length > 0 || workingDeal.value.promises.length > 0);
/** The current reducer state says there is one open proposal awaiting a response. */
const hasOpenProposal = computed(() => reduction.value.active !== null && reduction.value.status === 'open');
/** The active open offer was authored by the local viewer, so it can be retracted but not accepted. */
const activeAuthoredByViewer = computed(() => reduction.value.active?.SpeakerID === props.leftID);
/** A term in the current proposal is structurally impossible right now — blocks acceptance. */
const hasIllegalTerm = computed(() => (inspection.value?.items ?? []).some((it) => !it.legality));
/** State-only guard for opening a fresh proposal; `busy` is layered on for button disabling. */
const mayPropose = computed(() => hasTerms.value && !hasOpenProposal.value);
/** State-only guard for answering an open proposal with a counter. */
const mayCounter = computed(() => hasTerms.value && hasOpenProposal.value);
/**
 * State-only guard for accepting an incoming open proposal. Two things bar acceptance, folded in
 * here (not just on the button) so `doAccept` and the pre-submit re-inspection in
 * `ensureActionStillValid` enforce them too: (1) a stale-impossible proposal stays visible (red)
 * and cannot be accepted until fixed/removed; (2) an EDITED draft diverges from the stored proposal
 * that Accept would actually record — the human must Counter (to send the edit) or Reset instead.
 */
const mayAccept = computed(
  () => hasOpenProposal.value && !activeAuthoredByViewer.value && !hasIllegalTerm.value && !dealEdited.value
);
/** State-only guard for rejecting or retracting the current open proposal. */
const mayReject = computed(() => hasOpenProposal.value);
const canPropose = computed(() => !busy.value && mayPropose.value);
const canCounter = computed(() => !busy.value && mayCounter.value);
const canAccept = computed(() => !busy.value && mayAccept.value);
const canReject = computed(() => !busy.value && mayReject.value);

// ---- editing (mutate workingDeal; the debounced watcher re-inspects) ---------------------
const onAddTerm = (payload: AddTermPayload) => {
  if (props.locked || busy.value) return;
  if (payload.kind === 'item') workingDeal.value.items.push(payload.item);
  else workingDeal.value.promises.push(payload.promise);
  dealEdited.value = true;
};
const onUpdateItem = (index: number, patch: Partial<TradeItem>) => {
  const item = workingDeal.value.items[index];
  if (item) { Object.assign(item, patch); dealEdited.value = true; }
};
const onRemoveItem = (index: number) => { workingDeal.value.items.splice(index, 1); dealEdited.value = true; };
const onRemovePromise = (index: number) => { workingDeal.value.promises.splice(index, 1); dealEdited.value = true; };

// ---- live re-evaluation -----------------------------------------------------------------
let inspectTimer: ReturnType<typeof setTimeout> | undefined;
let inspectSequence = 0;
/**
 * Inspect one immutable draft snapshot and apply only the newest request's result. Resolves `true`
 * when the inspection succeeded (so a preflight can trust the freshly-applied legality), `false` when
 * the seats are invalid or the call failed — letting `ensureActionStillValid` abort rather than act
 * on stale `inspection.value`. The live debounced watcher ignores the return.
 */
const runInspect = async (): Promise<boolean> => {
  if (props.leftID < 0 || props.rightID < 0 || props.leftID === props.rightID) return false;
  // A direct inspect is authoritative: cancel any pending debounced inspect so it can't fire
  // mid-flight and supersede this one — otherwise a preflight could validate against a snapshot
  // this call's result was discarded in favor of.
  if (inspectTimer) { clearTimeout(inspectTimer); inspectTimer = undefined; }
  const sequence = ++inspectSequence;
  const deal = clone(workingDeal.value);
  inspecting.value = true;
  try {
    const result = await api.inspectDeal(props.chatId, { deal });
    // Success ONLY when this result is the one applied. If a newer request superseded us, our
    // result is discarded, so the caller (a preflight) must not treat it as the current legality.
    const applied = sequence === inspectSequence;
    if (applied) {
      inspection.value = result;
      error.value = '';
    }
    return applied;
  } catch (e) {
    if (sequence === inspectSequence) {
      error.value = e instanceof Error ? e.message : 'Failed to inspect the deal';
    }
    return false;
  } finally {
    if (sequence === inspectSequence) inspecting.value = false;
  }
};
// Re-query inspect-deal as the proposed deal changes (debounced). Every edit routes through a
// workingDeal mutation, so this single watcher (with latest-request-wins) is the only trigger.
watch(workingDeal, () => {
  if (inspectTimer) clearTimeout(inspectTimer);
  inspectTimer = setTimeout(runInspect, 250);
}, { deep: true });

// ---- deal-message round-trip ------------------------------------------------------------
const clone = (deal: DealPayload): DealPayload => JSON.parse(JSON.stringify(deal));

/** Refresh the active proposal reducer, optionally loading the active terms into the editor. */
const refreshDealState = async (loadActiveIntoEditor: boolean): Promise<boolean> => {
  try {
    const res = await api.getDealMessages(props.chatId);
    reduction.value = deriveActiveProposal(res.messages);
    // Load the active proposal's terms into the editor as the starting point (a clean, unedited
    // baseline — Accept is offered until the human changes a term).
    if (loadActiveIntoEditor && reduction.value.active?.Payload?.Deal) {
      workingDeal.value = clone(reduction.value.active.Payload.Deal);
      dealMessage.value = reduction.value.active.Payload.Deal.message ?? '';
      dealEdited.value = false;
    }
    // The preflight is only valid if the re-inspection actually succeeded — propagate its result so
    // a failed inspect aborts the pending action instead of letting it run on stale legality.
    return await runInspect();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load deal messages';
    return false;
  }
};

const reloadDeals = async () => { await refreshDealState(true); };
const afterWrite = async () => { await reloadDeals(); emit('changed'); };

/**
 * Discard the human's edits and restore the active proposal's stored terms, re-enabling Accept.
 * Pairs with `dealEdited`: editing an incoming proposal hides Accept (you can only Counter the
 * change); Reset brings back the exact terms the server would record on acceptance.
 */
const resetToActiveProposal = () => {
  const deal = reduction.value.active?.Payload?.Deal;
  if (!deal) return;
  workingDeal.value = clone(deal);
  dealMessage.value = deal.message ?? '';
  dealEdited.value = false;
};

/**
 * Refresh deal state immediately before a write and report whether the action is still valid.
 * When `expectedActiveID` is given, the action also aborts if the active proposal changed
 * identity under us — a counter/reject/accept must target the very proposal the human saw,
 * not a newer one that arrived between render and submit.
 */
const ensureActionStillValid = async (
  allowed: () => boolean,
  summary: string,
  expectedActiveID?: number
): Promise<boolean> => {
  if (!(await refreshDealState(false))) return false;
  const sameTarget = expectedActiveID === undefined || reduction.value.active?.ID === expectedActiveID;
  if (allowed() && sameTarget) return true;
  toast.add({ severity: 'warn', summary, detail: 'The deal state changed; review the current proposal first.', life: 3500 });
  return false;
};

/** Clone the working deal and attach the human's one-sentence note (Payload.Deal.message). */
const draftToSend = (): DealPayload => {
  const deal = clone(workingDeal.value);
  const note = dealMessage.value.trim();
  if (note) deal.message = note;
  return deal;
};

const doPropose = async () => {
  if (busy.value || !mayPropose.value) return;
  busy.value = true;
  try {
    if (!(await ensureActionStillValid(() => mayPropose.value, 'Cannot propose yet'))) return;
    const result = await api.proposeDeal(props.chatId, { deal: draftToSend() });
    toast.add(result.agentResponded === false
      ? { severity: 'warn', summary: 'Proposal sent', detail: 'The diplomat did not produce a reply.', life: 4000 }
      : { severity: 'success', summary: 'Proposal sent', life: 2500 });
    await afterWrite();
  } catch (e) { retryableError(e, 'Could not send proposal'); } finally { busy.value = false; }
};
const doCounter = async () => {
  if (busy.value || !mayCounter.value) return;
  // The counter must answer the proposal currently shown; abort if a newer one slips in.
  const targetID = reduction.value.active?.ID;
  busy.value = true;
  try {
    if (!(await ensureActionStillValid(() => mayCounter.value, 'Cannot counter yet', targetID))) return;
    const result = await api.counterDeal(props.chatId, { deal: draftToSend() });
    toast.add(result.agentResponded === false
      ? { severity: 'warn', summary: 'Counter sent', detail: 'The diplomat did not produce a reply.', life: 4000 }
      : { severity: 'success', summary: 'Counter sent', life: 2500 });
    await afterWrite();
  } catch (e) { retryableError(e, 'Could not send counter'); } finally { busy.value = false; }
};
const doReject = async () => {
  if (busy.value || !mayReject.value) return;
  const targetID = reduction.value.active?.ID;
  busy.value = true;
  try {
    if (!(await ensureActionStillValid(() => mayReject.value, activeAuthoredByViewer.value ? 'Cannot retract yet' : 'Cannot refuse yet', targetID))) return;
    if (!reduction.value.active) return;
    await api.rejectDeal(props.chatId, { proposalMessageID: reduction.value.active.ID });
    toast.add({ severity: 'info', summary: activeAuthoredByViewer.value ? 'Proposal retracted' : 'Proposal refused', life: 2500 });
    await afterWrite();
  } catch (e) { actionError(e); } finally { busy.value = false; }
};
const doAccept = async () => {
  if (busy.value || !mayAccept.value) return;
  const targetID = reduction.value.active?.ID;
  busy.value = true;
  try {
    if (!(await ensureActionStillValid(() => mayAccept.value, 'Cannot accept yet', targetID))) return;
    if (!reduction.value.active) return;
    await api.acceptDeal(props.chatId, { proposalMessageID: reduction.value.active.ID });
    await afterWrite();
  } catch (e) {
    // Expected in preview: acceptance is wired but enactment is deferred to stage 6.
    toast.add({ severity: 'info', summary: 'Acceptance deferred', detail: e instanceof Error ? e.message : 'Enactment arrives in stage 6', life: 4000 });
  } finally { busy.value = false; }
};
const actionError = (e: unknown) => {
  toast.add({ severity: 'error', summary: 'Deal action failed', detail: e instanceof Error ? e.message : 'Unknown error', life: 4000 });
};
/**
 * A write that failed transiently (e.g. the game could not be inspected at proposal time) but
 * left the working draft intact, so the human can resubmit. The buttons re-enable on `busy`
 * reset — this just tells them the action is safe to retry.
 */
const retryableError = (e: unknown, summary: string) => {
  const reason = e instanceof Error ? e.message : 'Unknown error';
  toast.add({ severity: 'error', summary, detail: `${reason} — your draft is intact, try again.`, life: 5000 });
};

onMounted(reloadDeals);
onUnmounted(() => {
  if (inspectTimer) clearTimeout(inspectTimer);
  inspectSequence++;
});
</script>

<style scoped>
@import '@/styles/deal.css';
.deal-screen {
  min-width: 0;
}
</style>
