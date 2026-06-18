<!--
Component: DealScreen
Purpose: Web replica of the in-game diplomatic trade screen (interactive-diplomacy stage 4).

Driven entirely by the read-only `inspect-deal` tool (the screen holds no deal state of its
own beyond the in-progress proposal): it renders both sides' item tables from the tradable
range, lets the human build/modify a deal with live per-term legality + value feedback, shows
the other-side value balance summed live, and presents Accept / Counter / Reject against the
current proposal. Preview mode — proposal/counter round-trip through the durable store;
acceptance is wired but deferred to enactment (stage 6).
-->
<template>
  <div class="deal-screen">
    <div class="deal-header">
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

    <Message v-if="error" severity="error" :closable="true" @close="error = ''">{{ error }}</Message>
    <Message v-if="!inspection && !error" severity="secondary">Loading the tradable range…</Message>

    <div v-if="inspection" class="deal-body">
      <!-- Both sides' item tables, laid out like the in-game trade screen. -->
      <div class="deal-sides">
        <section
          v-for="side in sides"
          :key="side.id"
          class="deal-side"
        >
          <header class="deal-side-header">
            <span class="deal-side-name">{{ side.label }} gives</span>
            <span class="deal-balance" :class="balanceClass(side.id)">
              value to {{ side.label }}: {{ formatBalance(side.id) }}
            </span>
          </header>

          <!-- Current terms this side gives -->
          <ul class="deal-terms">
            <li v-for="entry in sideGives(workingDeal.items, side.id)" :key="entry.index" class="deal-term">
              <span class="deal-term-label">{{ itemLabel(entry.item, side.id) }}</span>
              <Tag
                v-if="inspectedFor(entry.index) && !inspectedFor(entry.index)!.legality"
                value="illegal"
                severity="danger"
                v-tooltip.bottom="reasonText(entry.index)"
              />
              <span class="deal-term-value" v-if="inspectedFor(entry.index)">
                give {{ fmt(inspectedFor(entry.index)!.valueIfIGive) }} ·
                worth {{ fmt(inspectedFor(entry.index)!.valueIfIReceive) }}
              </span>
              <Button icon="pi pi-times" text rounded size="small" severity="danger" :disabled="locked || busy" @click="removeItem(entry.index)" />
            </li>
            <li v-if="sideGives(workingDeal.items, side.id).length === 0" class="deal-empty">— nothing —</li>
          </ul>

          <!-- Add-term controls drawn from this side's tradable range -->
          <div class="deal-add" v-if="!locked">
            <div class="deal-add-row" v-if="rangeFor(side.id)?.gold.available">
              <InputNumber v-model="draftFor(side.id).gold" :min="0" :max="rangeFor(side.id)!.gold.max" size="small" placeholder="Gold" />
              <Button label="Add gold" size="small" outlined :disabled="!draftFor(side.id).gold" @click="addGold(side.id)" />
            </div>
            <div class="deal-add-row" v-if="rangeFor(side.id)?.goldPerTurn.available">
              <InputNumber v-model="draftFor(side.id).gpt" :min="0" size="small" placeholder="Gold/turn" />
              <Button label="Add GPT" size="small" outlined :disabled="!draftFor(side.id).gpt" @click="addGpt(side.id)" />
            </div>
            <div class="deal-add-row" v-if="rangeFor(side.id) && rangeFor(side.id)!.resources.length">
              <Select v-model="draftFor(side.id).resourceID" :options="resourceOptions(side.id)" optionLabel="label" optionValue="value" placeholder="Resource" size="small" />
              <InputNumber v-model="draftFor(side.id).resourceQty" :min="1" size="small" placeholder="Qty" />
              <Button label="Add" size="small" outlined :disabled="draftFor(side.id).resourceID == null" @click="addResource(side.id)" />
            </div>
            <div class="deal-add-row" v-if="rangeFor(side.id) && rangeFor(side.id)!.cities.length">
              <Select v-model="draftFor(side.id).cityID" :options="cityOptions(side.id)" optionLabel="label" optionValue="value" placeholder="City" size="small" />
              <Button label="Add city" size="small" outlined :disabled="draftFor(side.id).cityID == null" @click="addCity(side.id)" />
            </div>
            <div class="deal-add-row" v-if="rangeFor(side.id) && rangeFor(side.id)!.techs.length">
              <Select v-model="draftFor(side.id).techID" :options="techOptions(side.id)" optionLabel="label" optionValue="value" placeholder="Tech" size="small" />
              <Button label="Add tech" size="small" outlined :disabled="draftFor(side.id).techID == null" @click="addTech(side.id)" />
            </div>
            <div class="deal-add-row" v-if="rangeFor(side.id) && rangeFor(side.id)!.thirdPartyPeace.length">
              <Select v-model="draftFor(side.id).thirdPartyPeaceTeamID" :options="thirdPartyPeaceOptions(side.id)" optionLabel="label" optionValue="value" placeholder="Peace with team" size="small" />
              <Button label="Add third-party peace" size="small" outlined :disabled="draftFor(side.id).thirdPartyPeaceTeamID == null" @click="addThirdPartyPeace(side.id)" />
            </div>
            <div class="deal-add-row" v-if="rangeFor(side.id) && rangeFor(side.id)!.thirdPartyWar.length">
              <Select v-model="draftFor(side.id).thirdPartyWarTeamID" :options="thirdPartyWarOptions(side.id)" optionLabel="label" optionValue="value" placeholder="War with team" size="small" />
              <Button label="Add third-party war" size="small" outlined :disabled="draftFor(side.id).thirdPartyWarTeamID == null" @click="addThirdPartyWar(side.id)" />
            </div>
            <!-- The inspection range cannot enumerate live Congress resolutions, so vote
                 commitments use explicit IDs while still receiving live legality/value. -->
            <div class="deal-add-row">
              <InputNumber v-model="draftFor(side.id).resolutionID" :min="0" size="small" placeholder="Resolution ID" />
              <InputNumber v-model="draftFor(side.id).voteChoice" size="small" placeholder="Vote choice" />
              <InputNumber v-model="draftFor(side.id).numVotes" :min="1" size="small" placeholder="Votes" />
              <Select v-model="draftFor(side.id).voteRepeal" :options="voteModeOptions" optionLabel="label" optionValue="value" size="small" />
              <Button
                label="Add vote commitment"
                size="small"
                outlined
                :disabled="draftFor(side.id).resolutionID == null || draftFor(side.id).voteChoice == null || draftFor(side.id).numVotes < 1"
                @click="addVoteCommitment(side.id)"
              />
            </div>
            <div class="deal-add-row deal-toggles">
              <Button
                v-for="t in availableToggles(side.id)"
                :key="t.itemType"
                :label="t.label"
                size="small"
                text
                @click="addToggle(side.id, t.itemType)"
              />
            </div>
          </div>
        </section>
      </div>

      <!-- Promise terms (the eight standing promises + Coop War), a separate section (specs §3) -->
      <section class="deal-promises">
        <header class="deal-side-header"><span class="deal-side-name">Promises</span></header>
        <ul class="deal-terms">
          <li v-for="(p, i) in workingDeal.promises" :key="i" class="deal-term">
            <span class="deal-term-label">player {{ p.promiserID }} → player {{ p.recipientID }}: {{ promiseLabel(p) }}</span>
            <span class="deal-term-value" v-if="agreeabilityNote(i)" v-tooltip.bottom="agreeabilityNote(i)"><i class="pi pi-info-circle" /> factors</span>
            <Button icon="pi pi-times" text rounded size="small" severity="danger" :disabled="locked || busy" @click="removePromise(i)" />
          </li>
          <li v-if="workingDeal.promises.length === 0" class="deal-empty">— none —</li>
        </ul>
        <div class="deal-add deal-add-row" v-if="!locked">
          <Select v-model="promiseDraft.promiserID" :options="sideOptions" optionLabel="label" optionValue="value" placeholder="Promiser" size="small" />
          <Select v-model="promiseDraft.promiseType" :options="promiseTypeOptions" optionLabel="label" optionValue="value" placeholder="Promise" size="small" />
          <InputNumber v-if="promiseNeedsTarget" v-model="promiseDraft.targetPlayerID" :min="0" size="small" placeholder="Target player" />
          <Button label="Add promise" size="small" outlined :disabled="!canAddPromise" @click="addPromise" />
        </div>
      </section>

      <!-- Accept / Counter / Reject against the current proposal -->
      <div class="deal-actions">
        <span v-if="locked" class="deal-muted">Conversation closed this turn — deal actions are locked.</span>
        <template v-else>
          <Button label="Propose" icon="pi pi-send" :loading="busy" :disabled="!hasTerms" @click="doPropose" />
          <Button v-if="reduction.active" label="Counter" icon="pi pi-replay" severity="secondary" :loading="busy" :disabled="!hasTerms" @click="doCounter" />
          <Button v-if="reduction.active && reduction.status === 'open'" label="Accept" icon="pi pi-check" severity="success" :loading="busy" @click="doAccept" />
          <Button v-if="reduction.active && reduction.status === 'open'" label="Reject" icon="pi pi-times-circle" severity="danger" :loading="busy" @click="doReject" />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Select from 'primevue/select';
import InputNumber from 'primevue/inputnumber';
import Message from 'primevue/message';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api/client';
import type { DealPayload, TradeItem, PromiseTerm, InspectDealResponse, InspectedTradeItem } from '@/utils/types';
import { deriveActiveProposal, type DealReduction } from './deal-reduce';
import {
  type SideRange,
  PROMISE_TYPES,
  PROMISE_LABELS,
  PROMISE_NEEDS_TARGET,
  TOGGLE_ITEMS,
  sideGives,
  formatValue,
  formatItemLabel,
  formatPromiseLabel,
  computeSideBalance,
} from './deal-helpers';

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
const toast = useToast();

const emptyDeal = (): DealPayload => ({ version: 1, items: [], promises: [] });
const workingDeal = ref<DealPayload>(emptyDeal());
const inspection = ref<InspectDealResponse | null>(null);
const reduction = ref<DealReduction>({ active: null, status: 'none', proposals: [] });
const inspecting = ref(false);
const busy = ref(false);
const error = ref('');

/** The two sides, in display order: you (left) then them (right). */
const sides = computed(() => [
  { id: props.leftID, label: props.leftLabel },
  { id: props.rightID, label: props.rightLabel },
]);
const sideOptions = computed(() => sides.value.map((s) => ({ label: s.label, value: s.id })));

// Per-side add-term draft inputs, keyed by player ID.
interface Draft {
  gold: number | null;
  gpt: number | null;
  resourceID: number | null;
  resourceQty: number;
  cityID: number | null;
  techID: number | null;
  thirdPartyPeaceTeamID: number | null;
  thirdPartyWarTeamID: number | null;
  resolutionID: number | null;
  voteChoice: number | null;
  numVotes: number;
  voteRepeal: boolean;
}
const drafts = reactive<Record<number, Draft>>({});
/** Create the add-term draft fields for one side when it first appears. */
const ensureDraft = (id: number) => {
  if (!drafts[id]) {
    drafts[id] = {
      gold: null,
      gpt: null,
      resourceID: null,
      resourceQty: 1,
      cityID: null,
      techID: null,
      thirdPartyPeaceTeamID: null,
      thirdPartyWarTeamID: null,
      resolutionID: null,
      voteChoice: null,
      numVotes: 1,
      voteRepeal: false,
    };
  }
};
/** Ensure and return the (reactive) draft for a side — used by the template's v-models. */
const draftFor = (id: number): Draft => { ensureDraft(id); return drafts[id]!; };
watch(sides, (s) => s.forEach((side) => ensureDraft(side.id)), { immediate: true });

const promiseDraft = reactive<{ promiserID: number | null; promiseType: string; targetPlayerID: number | null }>(
  { promiserID: null, promiseType: '', targetPlayerID: null }
);
const promiseNeedsTarget = computed(() => PROMISE_NEEDS_TARGET.has(promiseDraft.promiseType));
const promiseTypeOptions = PROMISE_TYPES.map((t) => ({ label: PROMISE_LABELS[t] ?? t, value: t }));
const canAddPromise = computed(() => {
  if (promiseDraft.promiserID == null || !promiseDraft.promiseType) return false;
  if (!promiseNeedsTarget.value) return true;
  return (
    promiseDraft.targetPlayerID != null &&
    promiseDraft.targetPlayerID !== props.leftID &&
    promiseDraft.targetPlayerID !== props.rightID
  );
});
const voteModeOptions = [
  { label: 'Enact', value: false },
  { label: 'Repeal', value: true },
];

const hasTerms = computed(() => workingDeal.value.items.length > 0 || workingDeal.value.promises.length > 0);

// ---- range / inspection accessors -------------------------------------------------------
const rangeFor = (id: number): SideRange | undefined => inspection.value?.tradableRange[String(id)] as SideRange | undefined;
const inspectedFor = (index: number): InspectedTradeItem | undefined => inspection.value?.items[index];
const reasonText = (index: number): string => inspectedFor(index)?.reasons.join('\n') ?? '';
const fmt = (v: number) => formatValue(v);
const itemLabel = (item: TradeItem, sideID: number) => formatItemLabel(item, rangeFor(sideID));
const promiseLabel = (p: PromiseTerm) => formatPromiseLabel(p);
const agreeabilityNote = (i: number): string => {
  const p = (inspection.value?.promises[i] ?? {}) as { agreeabilityFactors?: { note?: string } };
  return p.agreeabilityFactors?.note ?? '';
};

const resourceOptions = (id: number) =>
  (rangeFor(id)?.resources ?? []).map((r) => ({ label: `Resource #${r.resourceID} (≤${r.quantityAvailable})`, value: r.resourceID }));
const cityOptions = (id: number) =>
  (rangeFor(id)?.cities ?? []).map((c) => ({ label: c.name || `City #${c.cityID}`, value: c.cityID }));
const techOptions = (id: number) =>
  (rangeFor(id)?.techs ?? []).map((t) => ({ label: `Tech #${t.techID}`, value: t.techID }));
const thirdPartyPeaceOptions = (id: number) =>
  (rangeFor(id)?.thirdPartyPeace ?? []).map((t) => ({ label: `Team ${t.teamID}`, value: t.teamID }));
const thirdPartyWarOptions = (id: number) =>
  (rangeFor(id)?.thirdPartyWar ?? []).map((t) => ({ label: `Team ${t.teamID}`, value: t.teamID }));
const availableToggles = (id: number) => {
  const range = rangeFor(id);
  if (!range) return [];
  return TOGGLE_ITEMS.filter((t) => range[t.rangeKey] === true);
};

// ---- balance ----------------------------------------------------------------------------
const balanceFor = (id: number) => computeSideBalance(workingDeal.value.items, inspection.value?.items ?? [], id);
const formatBalance = (id: number) => {
  const b = balanceFor(id);
  return `${b.net > 0 ? '+' : ''}${formatValue(b.net)}${b.hasSentinel ? ' (some impossible)' : ''}`;
};
const balanceClass = (id: number) => {
  const net = balanceFor(id).net;
  return net > 0 ? 'balance-positive' : net < 0 ? 'balance-negative' : '';
};

// ---- editing ----------------------------------------------------------------------------
const otherSide = (sideID: number) => (sideID === props.leftID ? props.rightID : props.leftID);
const pushItem = (item: TradeItem) => { workingDeal.value.items.push(item); };

const addGold = (sideID: number) => {
  const amount = drafts[sideID]!.gold!;
  pushItem({ fromPlayerID: sideID, toPlayerID: otherSide(sideID), itemType: 'GOLD', amount });
  drafts[sideID]!.gold = null;
};
const addGpt = (sideID: number) => {
  const amount = drafts[sideID]!.gpt!;
  pushItem({ fromPlayerID: sideID, toPlayerID: otherSide(sideID), itemType: 'GOLD_PER_TURN', amount });
  drafts[sideID]!.gpt = null;
};
const addResource = (sideID: number) => {
  pushItem({ fromPlayerID: sideID, toPlayerID: otherSide(sideID), itemType: 'RESOURCES', resourceID: drafts[sideID]!.resourceID!, quantity: drafts[sideID]!.resourceQty });
  drafts[sideID]!.resourceID = null;
  drafts[sideID]!.resourceQty = 1;
};
const addCity = (sideID: number) => {
  pushItem({ fromPlayerID: sideID, toPlayerID: otherSide(sideID), itemType: 'CITIES', cityID: drafts[sideID]!.cityID! });
  drafts[sideID]!.cityID = null;
};
const addTech = (sideID: number) => {
  pushItem({ fromPlayerID: sideID, toPlayerID: otherSide(sideID), itemType: 'TECHS', techID: drafts[sideID]!.techID! });
  drafts[sideID]!.techID = null;
};
/** Add a peace-with-third-party term selected from the live tradable range. */
const addThirdPartyPeace = (sideID: number) => {
  pushItem({
    fromPlayerID: sideID,
    toPlayerID: otherSide(sideID),
    itemType: 'THIRD_PARTY_PEACE',
    thirdPartyTeamID: drafts[sideID]!.thirdPartyPeaceTeamID!,
  });
  drafts[sideID]!.thirdPartyPeaceTeamID = null;
};
/** Add a war-with-third-party term selected from the live tradable range. */
const addThirdPartyWar = (sideID: number) => {
  pushItem({
    fromPlayerID: sideID,
    toPlayerID: otherSide(sideID),
    itemType: 'THIRD_PARTY_WAR',
    thirdPartyTeamID: drafts[sideID]!.thirdPartyWarTeamID!,
  });
  drafts[sideID]!.thirdPartyWarTeamID = null;
};
/** Add an explicit World Congress vote commitment for live inspection. */
const addVoteCommitment = (sideID: number) => {
  const draft = drafts[sideID]!;
  pushItem({
    fromPlayerID: sideID,
    toPlayerID: otherSide(sideID),
    itemType: 'VOTE_COMMITMENT',
    resolutionID: draft.resolutionID!,
    voteChoice: draft.voteChoice!,
    numVotes: draft.numVotes,
    repeal: draft.voteRepeal,
  });
  draft.resolutionID = null;
  draft.voteChoice = null;
  draft.numVotes = 1;
  draft.voteRepeal = false;
};
const addToggle = (sideID: number, itemType: TradeItem['itemType']) => {
  // Toggle items carry no extra data, so a second identical one is meaningless — skip the dup.
  if (workingDeal.value.items.some((i) => i.fromPlayerID === sideID && i.itemType === itemType)) return;
  pushItem({ fromPlayerID: sideID, toPlayerID: otherSide(sideID), itemType });
};
const removeItem = (index: number) => { workingDeal.value.items.splice(index, 1); };

const addPromise = () => {
  if (!canAddPromise.value) return;
  const promiserID = promiseDraft.promiserID!;
  const promise: PromiseTerm = { promiserID, recipientID: otherSide(promiserID), promiseType: promiseDraft.promiseType as PromiseTerm['promiseType'] };
  if (promiseNeedsTarget.value && promiseDraft.targetPlayerID != null) promise.targetPlayerID = promiseDraft.targetPlayerID;
  workingDeal.value.promises.push(promise);
  promiseDraft.promiseType = '';
  promiseDraft.targetPlayerID = null;
};
const removePromise = (index: number) => { workingDeal.value.promises.splice(index, 1); };

// ---- live re-evaluation -----------------------------------------------------------------
let inspectTimer: ReturnType<typeof setTimeout> | undefined;
let inspectSequence = 0;
/** Inspect one immutable draft snapshot and apply only the newest request's result. */
const runInspect = async () => {
  if (props.leftID < 0 || props.rightID < 0 || props.leftID === props.rightID) return;
  const sequence = ++inspectSequence;
  const deal = clone(workingDeal.value);
  inspecting.value = true;
  try {
    const result = await api.inspectDeal(props.chatId, { deal });
    if (sequence === inspectSequence) {
      inspection.value = result;
      error.value = '';
    }
  } catch (e) {
    if (sequence === inspectSequence) {
      error.value = e instanceof Error ? e.message : 'Failed to inspect the deal';
    }
  } finally {
    if (sequence === inspectSequence) inspecting.value = false;
  }
};
// Re-query inspect-deal as the proposed deal changes (debounced).
watch(workingDeal, () => {
  if (inspectTimer) clearTimeout(inspectTimer);
  inspectTimer = setTimeout(runInspect, 250);
}, { deep: true });

// ---- deal-message round-trip ------------------------------------------------------------
const clone = (deal: DealPayload): DealPayload => JSON.parse(JSON.stringify(deal));

const reloadDeals = async () => {
  try {
    const res = await api.getDealMessages(props.chatId);
    reduction.value = deriveActiveProposal(res.messages);
    // Load the active proposal's terms into the editor as the starting point.
    if (reduction.value.active?.Payload?.Deal) {
      workingDeal.value = clone(reduction.value.active.Payload.Deal);
    }
    await runInspect();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load deal messages';
  }
};

const afterWrite = async () => { await reloadDeals(); emit('changed'); };

const doPropose = async () => {
  busy.value = true;
  try {
    await api.proposeDeal(props.chatId, { deal: clone(workingDeal.value) });
    toast.add({ severity: 'success', summary: 'Proposal sent', life: 2500 });
    await afterWrite();
  } catch (e) { actionError(e); } finally { busy.value = false; }
};
const doCounter = async () => {
  busy.value = true;
  try {
    await api.counterDeal(props.chatId, { deal: clone(workingDeal.value) });
    toast.add({ severity: 'success', summary: 'Counter sent', life: 2500 });
    await afterWrite();
  } catch (e) { actionError(e); } finally { busy.value = false; }
};
const doReject = async () => {
  if (!reduction.value.active) return;
  busy.value = true;
  try {
    await api.rejectDeal(props.chatId, { proposalMessageID: reduction.value.active.ID });
    toast.add({ severity: 'info', summary: 'Proposal rejected', life: 2500 });
    await afterWrite();
  } catch (e) { actionError(e); } finally { busy.value = false; }
};
const doAccept = async () => {
  if (!reduction.value.active) return;
  busy.value = true;
  try {
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

onMounted(reloadDeals);
onUnmounted(() => {
  if (inspectTimer) clearTimeout(inspectTimer);
  inspectSequence++;
});
</script>

<style scoped>
.deal-screen {
  min-width: 0;
}
.deal-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  min-height: 2rem;
}
.deal-muted { color: var(--p-text-muted-color); font-size: 0.85rem; }
.deal-refresh { margin-left: auto; }
.deal-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.deal-side, .deal-promises {
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  padding: 0.5rem;
}
.deal-promises { margin-top: 0.75rem; }
.deal-side-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.25rem; }
.deal-side-name { font-weight: 600; }
.deal-balance { font-size: 0.8rem; color: var(--p-text-muted-color); }
.balance-positive { color: var(--p-green-500); }
.balance-negative { color: var(--p-red-500); }
.deal-terms { list-style: none; padding: 0; margin: 0 0 0.5rem; }
.deal-term { display: flex; align-items: center; gap: 0.4rem; padding: 0.15rem 0; }
.deal-term-label { flex: 1; }
.deal-term-value { font-size: 0.75rem; color: var(--p-text-muted-color); }
.deal-empty { color: var(--p-text-muted-color); font-size: 0.85rem; }
.deal-add { display: flex; flex-direction: column; gap: 0.35rem; }
.deal-add-row { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
.deal-toggles { flex-wrap: wrap; }
.deal-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }
</style>
