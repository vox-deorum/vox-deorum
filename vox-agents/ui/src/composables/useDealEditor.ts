import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api/client';
import type {
  DealPayload,
  InspectDealResponse,
  NormalizedSideRange,
  PromiseTargetInfo,
  TradeItem,
} from '@/utils/types';
import { buildSideCatalog, type AddTermPayload } from '@/components/deal/deal-catalog';
import { addItemWithMirror, removeItemWithMirror } from '@/components/deal/deal-helpers';
import { deriveActiveProposal, type DealReduction } from '@/components/deal/deal-reduce';

/** The thread returned after a blocking accept or reject action. */
export type DealThreadResponse = Awaited<ReturnType<typeof api.acceptDeal>>;

/** A normalized deal submission emitted to the chat streaming workflow. */
export interface DealSubmission {
  deal: DealPayload;
  expectedProposalID?: number;
}

/** Reactive inputs and output callbacks for the deal editor state machine. */
interface UseDealEditorOptions {
  chatId: MaybeRefOrGetter<string>;
  leftID: MaybeRefOrGetter<number>;
  rightID: MaybeRefOrGetter<number>;
  leftLabel: MaybeRefOrGetter<string>;
  rightLabel: MaybeRefOrGetter<string>;
  locked: MaybeRefOrGetter<boolean | undefined>;
  agentBusy: MaybeRefOrGetter<boolean | undefined>;
  busy: Ref<boolean>;
  onChanged: (thread: DealThreadResponse) => void;
  onSend: (submission: DealSubmission) => void;
}

/** Create a new empty deal draft. */
function emptyDeal(): DealPayload {
  return { version: 1, items: [], promises: [] };
}

/** Clone a deal through JSON so Vue reactive proxies are safely reduced to plain wire data. */
function cloneDeal(deal: DealPayload): DealPayload {
  return JSON.parse(JSON.stringify(deal)) as DealPayload;
}

/** Normalize the optional note at the single boundary used by fingerprints and submissions. */
function normalizeDealDraft(deal: DealPayload, message: string): DealPayload {
  const draft = cloneDeal(deal);
  const note = message.trim();
  if (note) draft.message = note;
  else delete draft.message;
  return draft;
}

/** Produce a stable fingerprint for edit tracking. */
function dealDraftFingerprint(deal: DealPayload, message: string): string {
  return JSON.stringify(normalizeDealDraft(deal, message));
}

/** Own the deal draft, inspection, reduction, guards, and write orchestration. */
export function useDealEditor(options: UseDealEditorOptions) {
  const toast = useToast();
  const workingDeal = ref<DealPayload>(emptyDeal());
  const dealMessage = ref('');
  const baseline = ref(dealDraftFingerprint(emptyDeal(), ''));
  const inspection = ref<InspectDealResponse | null>(null);
  const reduction = ref<DealReduction>({ active: null, status: 'none', proposals: [] });
  const inspecting = ref(false);
  const error = ref('');

  const counterpartID = computed(() => toValue(options.rightID));
  const youID = computed(() => toValue(options.leftID));
  const counterpartLabel = computed(() => toValue(options.rightLabel));
  const youLabel = computed(() => toValue(options.leftLabel));

  /** Find one side's tradable range in the latest inspection. */
  const rangeFor = (id: number): NormalizedSideRange | undefined =>
    inspection.value?.tradableRange[String(id)];

  const promiseTargets = computed<PromiseTargetInfo[]>(() => inspection.value?.promiseTargets ?? []);

  /** Build the inventory catalog for one participant. */
  const buildCatalogFor = (ownerID: number, otherID: number) =>
    buildSideCatalog({
      ownerID,
      otherID,
      range: rangeFor(ownerID),
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
  const hasTerms = computed(() => workingDeal.value.items.length > 0 || workingDeal.value.promises.length > 0);
  const hasOpenProposal = computed(() => reduction.value.active !== null && reduction.value.status === 'open');
  const activeAuthoredByViewer = computed(() => reduction.value.active?.SpeakerID === toValue(options.leftID));
  const hasIllegalTerm = computed(() => (inspection.value?.items ?? []).some((item) => !item.legality));
  const mayPropose = computed(() => hasTerms.value && !hasOpenProposal.value && !hasIllegalTerm.value);
  const mayCounter = computed(() => hasTerms.value && hasOpenProposal.value && !hasIllegalTerm.value);
  const isEdited = computed(
    () => dealDraftFingerprint(workingDeal.value, dealMessage.value) !== baseline.value,
  );
  const mayAccept = computed(
    () => hasOpenProposal.value && !activeAuthoredByViewer.value && !hasIllegalTerm.value && !isEdited.value,
  );
  const mayReject = computed(() => hasOpenProposal.value);
  const blocked = computed(() => options.busy.value || toValue(options.agentBusy));
  const canPropose = computed(() => !blocked.value && mayPropose.value);
  const canCounter = computed(() => !blocked.value && mayCounter.value);
  const canAccept = computed(() => !blocked.value && mayAccept.value);
  const canReject = computed(() => !blocked.value && mayReject.value);

  /** Add an inventory term to the draft. */
  const onAddTerm = (payload: AddTermPayload): void => {
    if (toValue(options.locked) || blocked.value) return;
    if (payload.kind === 'item') {
      workingDeal.value.items = addItemWithMirror(workingDeal.value.items, payload.item);
    } else {
      workingDeal.value.promises.push(payload.promise);
    }
  };

  /** Apply an item editor patch to the draft. */
  const onUpdateItem = (index: number, patch: Partial<TradeItem>): void => {
    if (toValue(options.locked) || blocked.value) return;
    const item = workingDeal.value.items[index];
    if (item) Object.assign(item, patch);
  };

  /** Remove an item and its mutual mirror when present. */
  const onRemoveItem = (index: number): void => {
    if (toValue(options.locked) || blocked.value) return;
    workingDeal.value.items = removeItemWithMirror(workingDeal.value.items, index);
  };

  /** Remove a promise from the draft. */
  const onRemovePromise = (index: number): void => {
    if (toValue(options.locked) || blocked.value) return;
    workingDeal.value.promises.splice(index, 1);
  };

  let inspectTimer: ReturnType<typeof setTimeout> | undefined;
  let inspectSequence = 0;

  /** Inspect an immutable draft and apply only the newest response. */
  const runInspect = async (): Promise<boolean> => {
    const leftID = toValue(options.leftID);
    const rightID = toValue(options.rightID);
    if (leftID < 0 || rightID < 0 || leftID === rightID) return false;
    if (inspectTimer) {
      clearTimeout(inspectTimer);
      inspectTimer = undefined;
    }
    const sequence = ++inspectSequence;
    inspecting.value = true;
    try {
      const result = await api.inspectDeal(toValue(options.chatId), { deal: cloneDeal(workingDeal.value) });
      const applied = sequence === inspectSequence;
      if (applied) {
        inspection.value = result;
        error.value = '';
      }
      return applied;
    } catch (caught) {
      if (sequence === inspectSequence) {
        error.value = caught instanceof Error ? caught.message : 'Failed to inspect the deal';
      }
      return false;
    } finally {
      if (sequence === inspectSequence) inspecting.value = false;
    }
  };

  /** Schedule a live inspection after an edit settles. */
  const scheduleInspect = (): void => {
    if (inspectTimer) clearTimeout(inspectTimer);
    inspectTimer = setTimeout(runInspect, 250);
  };

  watch(workingDeal, scheduleInspect, { deep: true });

  /** Load a proposal into the editor and capture its clean baseline. */
  const loadDraft = (deal: DealPayload): void => {
    workingDeal.value = cloneDeal(deal);
    dealMessage.value = deal.message ?? '';
    baseline.value = dealDraftFingerprint(workingDeal.value, dealMessage.value);
  };

  /** Refresh the reduced proposal state and current draft inspection. */
  const refreshDealState = async (loadActiveIntoEditor: boolean): Promise<boolean> => {
    try {
      const response = await api.getDealMessages(toValue(options.chatId));
      reduction.value = deriveActiveProposal(response.messages);
      if (loadActiveIntoEditor && reduction.value.active?.Payload?.Deal) {
        loadDraft(reduction.value.active.Payload.Deal);
      }
      return await runInspect();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : 'Failed to load deal messages';
      return false;
    }
  };

  /** Reload proposals and restore the active proposal in the editor. */
  const reloadDeals = async (): Promise<void> => {
    await refreshDealState(true);
  };

  /** Restore the current active proposal and discard local edits. */
  const resetToActiveProposal = (): void => {
    const deal = reduction.value.active?.Payload?.Deal;
    if (deal) loadDraft(deal);
  };

  /** Revalidate proposal freshness and action guards immediately before a write. */
  const ensureActionStillValid = async (
    allowed: () => boolean,
    summary: string,
    expectedActiveID?: number,
  ): Promise<boolean> => {
    if (!(await refreshDealState(false))) return false;
    const sameTarget = expectedActiveID === undefined || reduction.value.active?.ID === expectedActiveID;
    if (allowed() && sameTarget) return true;
    toast.add({
      severity: 'warn',
      summary,
      detail: 'The deal state changed; review the current proposal first.',
      life: 3500,
    });
    return false;
  };

  /** Serialize the current draft for a proposal or counter. */
  const draftToSend = (): DealPayload => normalizeDealDraft(workingDeal.value, dealMessage.value);

  /** Run a guarded action with one shared busy lifecycle. */
  const runDealWrite = async (
    allowed: () => boolean,
    staleSummary: string,
    write: () => Promise<void>,
    reportError: (caught: Error | string) => void,
    expectedActiveID?: number,
  ): Promise<void> => {
    if (blocked.value || !allowed()) return;
    options.busy.value = true;
    try {
      if (!(await ensureActionStillValid(allowed, staleSummary, expectedActiveID))) return;
      await write();
    } catch (caught) {
      reportError(caught instanceof Error ? caught : 'Unknown error');
    } finally {
      options.busy.value = false;
    }
  };

  /** Show a failure from a blocking accept or reject action. */
  const actionError = (caught: Error | string): void => {
    toast.add({
      severity: 'error',
      summary: 'Deal action failed',
      detail: caught instanceof Error ? caught.message : caught,
      life: 4000,
    });
  };

  /** Show a retryable failure while explaining that the draft remains available. */
  const retryableError = (caught: Error | string, summary: string): void => {
    const reason = caught instanceof Error ? caught.message : caught;
    toast.add({ severity: 'error', summary, detail: `${reason}: your draft is intact, try again.`, life: 5000 });
  };

  /** Submit a new proposal through the parent streaming workflow. */
  const doPropose = (): Promise<void> => runDealWrite(
    () => mayPropose.value,
    'Cannot propose yet',
    async () => options.onSend({ deal: draftToSend() }),
    (caught) => retryableError(caught, 'Could not send proposal'),
  );

  /** Submit a counter tied to the proposal currently shown. */
  const doCounter = (): Promise<void> => {
    const targetID = reduction.value.active?.ID;
    return runDealWrite(
      () => mayCounter.value,
      'Cannot counter yet',
      async () => {
        if (targetID !== undefined) options.onSend({ deal: draftToSend(), expectedProposalID: targetID });
      },
      (caught) => retryableError(caught, 'Could not send counter'),
      targetID,
    );
  };

  /** Reject or retract the proposal currently shown. */
  const doReject = (): Promise<void> => {
    const targetID = reduction.value.active?.ID;
    return runDealWrite(
      () => mayReject.value,
      activeAuthoredByViewer.value ? 'Cannot retract yet' : 'Cannot refuse yet',
      async () => {
        if (!reduction.value.active) return;
        const updated = await api.rejectDeal(toValue(options.chatId), {
          proposalMessageID: reduction.value.active.ID,
        });
        toast.add({
          severity: 'info',
          summary: activeAuthoredByViewer.value ? 'Proposal retracted' : 'Proposal refused',
          life: 2500,
        });
        options.onChanged(updated);
      },
      actionError,
      targetID,
    );
  };

  /** Accept the incoming proposal currently shown. */
  const doAccept = (): Promise<void> => {
    const targetID = reduction.value.active?.ID;
    return runDealWrite(
      () => mayAccept.value,
      'Cannot accept yet',
      async () => {
        if (!reduction.value.active) return;
        const updated = await api.acceptDeal(toValue(options.chatId), {
          proposalMessageID: reduction.value.active.ID,
        });
        options.onChanged(updated);
      },
      actionError,
      targetID,
    );
  };

  /** Invalidate pending inspection work when the editor unmounts. */
  const dispose = (): void => {
    if (inspectTimer) clearTimeout(inspectTimer);
    inspectSequence++;
  };

  onMounted(reloadDeals);
  onUnmounted(dispose);

  return {
    activeAuthoredByViewer,
    blocked,
    canAccept,
    canCounter,
    canPropose,
    canReject,
    counterpartCategories,
    counterpartID,
    counterpartLabel,
    dealMessage,
    doAccept,
    doCounter,
    doPropose,
    doReject,
    error,
    hasIllegalTerm,
    hasOpenProposal,
    hasTerms,
    inspecting,
    inspection,
    isEdited,
    onAddTerm,
    onRemoveItem,
    onRemovePromise,
    onUpdateItem,
    promiseTargets,
    reduction,
    reloadDeals,
    resetToActiveProposal,
    workingDeal,
    youCategories,
    youID,
    youLabel,
  };
}
