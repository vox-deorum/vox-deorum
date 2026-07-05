<!--
Component: DealScreen
Purpose: Web replica of the in-game diplomatic trade screen (interactive-diplomacy stage 4) — a
three-panel board: your inventory | deal on the table | counterpart inventory (the board leads with
the conversation's initiator/audience seat on the left).

Driven entirely by the read-only `inspect-deal` tool (the screen holds no deal state of its own
beyond the in-progress proposal): it builds both sides' categorized inventories from the tradable
range, lets the human build/modify a deal with live per-term legality + value feedback, shows the
other-side value balance summed live, and presents the proposal-state actions (Propose; or
Refuse/Counter/Accept; or Retract/Counter). Proposal/counter are handed UP to the host to stream
through the chat-message path (the dialog closes once the server accepts); reject is a blocking
write; acceptance is handed up the same way and now enacts the deal for real in-game (stage 6).

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
        <!-- Left = your (the initiator/audience) inventory. -->
        <InventoryPanel
          side="left"
          :label="youLabel"
          :categories="youCategories"
          :locked="locked"
          :busy="blocked"
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
          :busy="blocked"
          @update-item="onUpdateItem"
          @remove-item="onRemoveItem"
          @remove-promise="onRemovePromise"
        />

        <!-- Right = the counterpart's inventory. -->
        <InventoryPanel
          side="right"
          :label="counterpartLabel"
          :categories="counterpartCategories"
          :locked="locked"
          :busy="blocked"
          @add-term="onAddTerm"
        />
      </div>
    </div>

    <!-- Footer: proposal-state actions on the left; board status (proposal state, live-inspection
         progress) and the reload button grouped to the right. -->
    <div class="deal-actions">
      <span v-if="locked" class="deal-muted">Conversation closed this turn — deal actions are locked.</span>
      <template v-else>
        <Button v-if="!hasOpenProposal" label="Propose" icon="pi pi-send" :loading="busy" :disabled="!canPropose" @click="doPropose" />
        <Button v-if="hasOpenProposal" label="Counter" icon="pi pi-replay" severity="secondary" :loading="busy" :disabled="!canCounter" @click="doCounter" />
        <!-- Accept records the STORED proposal; once the draft (terms OR message) is edited it would no longer match, so hide it. -->
        <Button v-if="hasOpenProposal && !activeAuthoredByViewer && !isEdited" label="Accept" icon="pi pi-check" severity="success" :loading="busy" :disabled="!canAccept" @click="doAccept" />
        <Button v-if="hasOpenProposal && isEdited" label="Reset" icon="pi pi-undo" severity="secondary" text :disabled="blocked" @click="resetToActiveProposal" v-tooltip.bottom="'Discard edits and restore the original proposal'" />
        <Button
          v-if="hasOpenProposal"
          :label="activeAuthoredByViewer ? 'Retract' : 'Refuse'"
          icon="pi pi-times-circle"
          severity="danger"
          :loading="busy"
          :disabled="!canReject"
          @click="doReject"
        />
        <!-- Illegal-term hint first: a red term blocks proposing, countering AND accepting, so it takes
             precedence over the edited hint below (which suggests Counter — disabled while a term is red). -->
        <span v-if="hasIllegalTerm && hasTerms" class="deal-muted">
          Remove or fix the impossible term (red)
        </span>
        <span v-else-if="hasOpenProposal && !activeAuthoredByViewer && isEdited" class="deal-muted">
          You’ve changed this proposal — send it as a Counter, or Reset to accept the original.
        </span>
      </template>

      <!-- Right-aligned status group (shown in both locked and unlocked states). -->
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
          :disabled="blocked"
          @click="reloadDeals"
          v-tooltip.bottom="'Reload proposals & re-evaluate'"
        />
      </div>
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
import { addItemWithMirror, removeItemWithMirror } from './deal-helpers';
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
  /**
   * The voiced agent is mid-reply (the chat send button is disabled). An inbound, read-only
   * signal — kept separate from the `busy` write-model — that blocks sending a deal while the
   * agent works, mirroring the chat input.
   */
  agentBusy?: boolean;
}>();

/** The chat thread a deal write returns (accept/reject mirror their new row into it server-side). */
type ThreadResponse = Awaited<ReturnType<typeof api.acceptDeal>>;
// Two ways this screen reports out:
//  - `changed`: a blocking write (accept/reject) completed and carries the updated thread, so the
//    parent adopts it directly (preserving live reasoning/tool-call traces).
//  - `send`: the human submitted a proposal/counter — the screen hands the normalized draft UP so the
//    parent streams the diplomat's reply (the async chat-message path) and closes the dialog once the
//    server accepts it, rather than blocking here on the round-trip. A counter also carries the open
//    proposal's ID so the server can bind it to the offer the human reviewed (a stale counter 409s).
const emit = defineEmits<{
  // Only accept/reject reach the parent this way now (propose/counter stream via `send`), and both
  // always carry the updated thread — so the payload is required, and the parent adopts it directly.
  (e: 'changed', thread: ThreadResponse): void;
  // Proposing and countering are one action — submitting a deal. `expectedProposalID` is the open offer
  // being answered (omitted to open a fresh one); the server reconciles it against the live state under
  // the turn lock and derives the archival type, so the wire carries no propose/counter flag.
  (e: 'send', payload: { deal: DealPayload; expectedProposalID?: number }): void;
}>();
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
const clone = (deal: DealPayload): DealPayload => JSON.parse(JSON.stringify(deal));
/**
 * The working draft normalized for the wire: a fresh clone of the terms with the trimmed note as
 * `message` (absent when blank). Both the edit-tracking fingerprint and the submitted proposal/
 * counter go through this, so the message trim/drop rule lives in exactly one place.
 */
const normalizedDraft = (deal: DealPayload, message: string): DealPayload => {
  const draft = clone(deal);
  const note = message.trim();
  if (note) draft.message = note;
  else delete draft.message; // a blank note drops the message; it never resends a stale line
  return draft;
};
/**
 * A stable fingerprint of the editable draft (terms + the one-sentence message). `isEdited` compares
 * the live draft against the loaded `baseline`, so any change — a term add/edit/remove OR a message
 * edit — is detected with no per-edit bookkeeping.
 */
const draftFingerprint = (deal: DealPayload, message: string): string =>
  JSON.stringify(normalizedDraft(deal, message));
/** Fingerprint of the loaded proposal's draft; the draft is "edited" when it diverges from this. */
const baseline = ref(draftFingerprint(emptyDeal(), ''));
const inspection = ref<InspectDealResponse | null>(null);
const reduction = ref<DealReduction>({ active: null, status: 'none', proposals: [] });
const inspecting = ref(false);
const error = ref('');

/**
 * Display orientation: the host passes the audience as `leftID` and the LLM seat as `rightID`.
 * The board leads with the conversation's INITIATOR — the audience/"you" seat — on the left and the
 * COUNTERPART on the right (so "A initiated on B" reads A | B). These computeds keep the seat
 * IDENTITY/labels fixed (you = audience, counterpart = LLM) regardless of physical side, so the
 * panels, columns, and giver semantics never disagree; only the visual placement is reversed.
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
    // The counterpart's range — a mutual pact is only addable when both sides can trade it (the add
    // mirrors it onto the other side), so the catalog disables this side's toggle when the other can't.
    otherRange: rangeFor(otherID),
    currentItems: workingDeal.value.items,
    currentPromises: workingDeal.value.promises,
    defaultDuration: inspection.value?.defaultDuration,
    peaceDuration: inspection.value?.peaceDuration,
    relationshipDuration: inspection.value?.relationshipDuration,
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
/** A term in the current draft is structurally impossible right now — blocks any submission
 *  (propose/counter/accept); the game would reject it, so it must never leave the board. */
const hasIllegalTerm = computed(() => (inspection.value?.items ?? []).some((it) => !it.legality));
/** State-only guard for opening a fresh proposal; `busy` is layered on for button disabling. */
const mayPropose = computed(() => hasTerms.value && !hasOpenProposal.value && !hasIllegalTerm.value);
/** State-only guard for answering an open proposal with a counter. */
const mayCounter = computed(() => hasTerms.value && hasOpenProposal.value && !hasIllegalTerm.value);
/**
 * The draft diverges from the loaded proposal — by a term edit OR a message edit. `Accept` records
 * the STORED proposal (by `proposalMessageID`, carrying its original terms and message), so any
 * divergence must hide Accept and offer Counter/Reset instead — otherwise an edit is silently dropped.
 */
const isEdited = computed(() => draftFingerprint(workingDeal.value, dealMessage.value) !== baseline.value);
/**
 * State-only guard for accepting an incoming open proposal. Two things bar acceptance, folded in
 * here (not just on the button) so `doAccept` and the pre-submit re-inspection in
 * `ensureActionStillValid` enforce them too: (1) a stale-impossible proposal stays visible (red)
 * and cannot be accepted until fixed/removed; (2) an EDITED draft (terms or message) diverges from
 * the stored proposal Accept would record — the human must Counter (to send the edit) or Reset.
 */
const mayAccept = computed(
  () => hasOpenProposal.value && !activeAuthoredByViewer.value && !hasIllegalTerm.value && !isEdited.value
);
/** State-only guard for rejecting or retracting the current open proposal. */
const mayReject = computed(() => hasOpenProposal.value);
/** Disable every deal-send while a write is in flight OR the agent is mid-reply (chat blocked). */
const blocked = computed(() => busy.value || props.agentBusy);
const canPropose = computed(() => !blocked.value && mayPropose.value);
const canCounter = computed(() => !blocked.value && mayCounter.value);
const canAccept = computed(() => !blocked.value && mayAccept.value);
const canReject = computed(() => !blocked.value && mayReject.value);

// ---- editing (mutate workingDeal; the debounced watcher re-inspects) ---------------------
// Every edit mutates workingDeal/dealMessage; `isEdited` derives from the fingerprint, so the
// handlers carry no edit-tracking bookkeeping of their own.
// Every edit is blocked while a write is in flight OR the diplomat is mid-reply (`blocked`, not just the
// local `busy`): after the synchronous submit emit `busy` resets but `agentBusy` stays true for the whole
// streamed reply, and a mid-reply edit would silently diverge the draft from the snapshot just submitted.
const onAddTerm = (payload: AddTermPayload) => {
  if (props.locked || blocked.value) return;
  if (payload.kind === 'item') {
    workingDeal.value.items = addItemWithMirror(workingDeal.value.items, payload.item);
  } else {
    workingDeal.value.promises.push(payload.promise);
  }
};
const onUpdateItem = (index: number, patch: Partial<TradeItem>) => {
  if (props.locked || blocked.value) return;
  const item = workingDeal.value.items[index];
  if (item) Object.assign(item, patch);
};
const onRemoveItem = (index: number) => {
  if (props.locked || blocked.value) return;
  workingDeal.value.items = removeItemWithMirror(workingDeal.value.items, index);
};
const onRemovePromise = (index: number) => {
  if (props.locked || blocked.value) return;
  workingDeal.value.promises.splice(index, 1);
};

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
/** Load a proposal's terms + message into the editor and capture it as the unedited baseline. */
const loadDraft = (deal: DealPayload) => {
  workingDeal.value = clone(deal);
  dealMessage.value = deal.message ?? '';
  baseline.value = draftFingerprint(workingDeal.value, dealMessage.value);
};

/** Refresh the active proposal reducer, optionally loading the active terms into the editor. */
const refreshDealState = async (loadActiveIntoEditor: boolean): Promise<boolean> => {
  try {
    const res = await api.getDealMessages(props.chatId);
    reduction.value = deriveActiveProposal(res.messages);
    // Load the active proposal's terms into the editor as the starting point (a clean, unedited
    // baseline — Accept is offered until the human changes a term or the message).
    if (loadActiveIntoEditor && reduction.value.active?.Payload?.Deal) {
      loadDraft(reduction.value.active.Payload.Deal);
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
// Notify the parent of a completed accept/reject, handing it the thread that write returned (its new
// deal row already mirrored in) so it adopts it directly — the chat's live traces survive. The screen
// unmounts on close, so there's no point reloading this reducer first (the old wasted pre-close fetch).
const afterWrite = (updated: ThreadResponse) => { emit('changed', updated); };

/**
 * Discard the human's edits and restore the active proposal's stored terms + message, re-enabling
 * Accept. Pairs with `isEdited`: editing an incoming proposal hides Accept (you can only Counter the
 * change); Reset brings back the exact draft the server would record on acceptance.
 */
const resetToActiveProposal = () => {
  const deal = reduction.value.active?.Payload?.Deal;
  if (deal) loadDraft(deal);
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

/** The working draft serialized for a proposal/counter: terms plus the trimmed note (see `normalizedDraft`). */
const draftToSend = (): DealPayload => normalizedDraft(workingDeal.value, dealMessage.value);

/** Run a guarded deal write: block duplicates, revalidate current state, then reset the shared busy flag. */
const runDealWrite = async (
  allowed: () => boolean,
  staleSummary: string,
  write: () => Promise<void>,
  onError: (e: unknown) => void,
  expectedActiveID?: number
): Promise<void> => {
  if (blocked.value || !allowed()) return;
  busy.value = true;
  try {
    if (!(await ensureActionStillValid(allowed, staleSummary, expectedActiveID))) return;
    await write();
  } catch (e) { onError(e); } finally { busy.value = false; }
};

// Propose/counter no longer block here on the agent round-trip: after the pre-submit re-inspection +
// freshness guard, hand the normalized draft to the parent, which closes the dialog immediately and
// streams the diplomat's reply (the async chat-message path). The parent owns the optimistic card and
// the post-stream reconcile, so there's no local `afterWrite` reload.
// Proposing and countering are one action (submitting a deal) emitting the same shape; only the bound
// offer ID differs — absent when opening a fresh proposal, the active offer's ID when answering one. The
// server reconciles that ID against the live state under the turn lock and 409s a mismatch.
const doPropose = () => runDealWrite(
  () => mayPropose.value,
  'Cannot propose yet',
  // No offer is on the table (mayPropose requires it), so submit with no expectedProposalID — the server
  // confirms none is open under the lock and archives a fresh deal-proposal (a 409 if one slipped in).
  async () => { emit('send', { deal: draftToSend() }); },
  (e) => retryableError(e, 'Could not send proposal')
);
const doCounter = () => {
  // The counter answers the proposal currently shown; abort if a newer one slips in. Its ID rides along
  // so the server reconciles the submission to it under the lock (the client freshness check races the
  // durable write; the server check is the authoritative backstop).
  const targetID = reduction.value.active?.ID;
  return runDealWrite(
    () => mayCounter.value,
    'Cannot counter yet',
    async () => {
      // `mayCounter` already requires an open proposal, so `targetID` is defined here; guard as a
      // belt-and-braces against a vanished proposal.
      if (targetID === undefined) return;
      emit('send', { deal: draftToSend(), expectedProposalID: targetID });
    },
    (e) => retryableError(e, 'Could not send counter'),
    targetID
  );
};
const doReject = () => {
  const targetID = reduction.value.active?.ID;
  return runDealWrite(
    () => mayReject.value,
    activeAuthoredByViewer.value ? 'Cannot retract yet' : 'Cannot refuse yet',
    async () => {
      if (!reduction.value.active) return;
      const updated = await api.rejectDeal(props.chatId, { proposalMessageID: reduction.value.active.ID });
      toast.add({ severity: 'info', summary: activeAuthoredByViewer.value ? 'Proposal retracted' : 'Proposal refused', life: 2500 });
      afterWrite(updated);
    },
    actionError,
    targetID
  );
};
const doAccept = () => {
  const targetID = reduction.value.active?.ID;
  return runDealWrite(
    () => mayAccept.value,
    'Cannot accept yet',
    async () => {
      if (!reduction.value.active) return;
      const updated = await api.acceptDeal(props.chatId, { proposalMessageID: reduction.value.active.ID });
      afterWrite(updated);
    },
    actionError,
    targetID
  );
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
