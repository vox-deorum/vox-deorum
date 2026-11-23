import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/utils/errors';
import type {
  DeskCandidate, DeskCatalogueResponse, DeskJob, DeskRef, DeskSettleManyRequest, DeskStyle, DeskStyleRequest, DeskTemplateSummary, DeskText,
  DeskVariantDetail, DeskVariantSummary,
} from '@/utils/types';
import { createPoller } from '@/utils/polling';
import { chunkDeskVariants, deskChoicesLimit, deskRefKey } from '@vox/newspaper/desk/batch.js';

export const deskPollIntervalMs = 1000;
export const deskCurrentRow = 'current';
export type DeskShow = 'all' | 'unsettled' | 'settled';

export interface DeskVariantGroup {
  template: DeskTemplateSummary;
  variants: DeskVariantSummary[];
  eligible: (DeskRef & { style: DeskStyle })[];
}

interface EditDraft {
  source: DeskText | DeskCandidate;
  text: DeskText;
}

interface VariantEdits {
  revision: string;
  copies: Map<string, EditDraft>;
}

export interface DeskApprovalSnapshot {
  target: DeskRef;
  revision: string;
  copies: { id: string; label: string; text: DeskText }[];
}

/** Copy only the fields that can be edited and saved. */
function copyText(text: DeskText): DeskText {
  const { headline, subheadline, byline, body } = text;
  return { headline, subheadline, byline, body: [...body] };
}

/** Find the original copy for an editor row. */
function rowSource(detail: DeskVariantDetail, row: string): DeskText | DeskCandidate | undefined {
  return row === deskCurrentRow ? detail.text : detail.candidates.find(candidate => candidate.id === row);
}

/** Keep the desk state for one visit while the server owns jobs and candidates. */
export function useWritingDesk() {
  const catalogue = ref<DeskCatalogueResponse>();
  const tags = ref<string[]>([]);
  const show = ref<DeskShow>('all');
  const search = ref('');
  const unchecked = ref(new Set<string>());
  const groups = computed<DeskVariantGroup[]>(() => {
    const term = search.value.trim().toLowerCase();
    return (catalogue.value?.templates ?? []).flatMap(template => {
      if (tags.value.length && !template.tags.some(tag => tags.value.includes(tag))) return [];
      const matchesTemplate = template.id.toLowerCase().includes(term);
      const variants = template.variants.filter(variant =>
        (show.value === 'all' || variant.settled === (show.value === 'settled')) &&
        (matchesTemplate || [variant.id, variant.headline, variant.style.voice].some(value => value.toLowerCase().includes(term))),
      );
      if (!variants.length) return [];
      const eligible = variants.filter(variant => !variant.settled)
        .map(variant => ({ templateId: template.id, variantId: variant.id, style: variant.style }));
      return [{ template, variants, eligible }];
    });
  });
  const eligible = computed(() => groups.value.flatMap(group => group.eligible));
  const checked = computed(() => {
    const refs = new Map<string, DeskVariantGroup['eligible'][number]>();
    for (const target of eligible.value) {
      const key = deskRefKey(target);
      if (!unchecked.value.has(key)) refs.set(key, target);
    }
    return refs;
  });
  const selected = ref<DeskRef>();
  const detail = ref<DeskVariantDetail>();
  const openRow = ref<string>();
  const editsByVariant = reactive(new Map<string, VariantEdits>());
  const edits = computed(() => detail.value && editsByVariant.get(deskRefKey(detail.value)));
  const draft = computed<DeskText | undefined>({
    /** Load the retained edit or start with the row's original text. */
    get() {
      const row = openRow.value;
      if (!detail.value || !row) return;
      const edited = edits.value?.copies.get(row);
      if (edited) return edited.text;
      const source = rowSource(detail.value, row);
      return source && copyText(source);
    },
    /** Keep each changed row independently of which editor is open. */
    set(text) {
      const current = detail.value;
      const row = openRow.value;
      if (!current || !row || !text) return;
      const source = rowSource(current, row);
      if (!source) return;
      const saved = edits.value ?? { revision: current.revision, copies: new Map<string, EditDraft>() };
      saved.copies.set(row, { source, text });
      editsByVariant.set(deskRefKey(current), saved);
    },
  });
  const job = ref<DeskJob | null>(null);
  const models = ref<string[]>([]);
  const discoveredModels = ref<string[]>([]);
  const availableModels = computed(() => [...new Set([...(catalogue.value?.models ?? []), ...discoveredModels.value])]);
  const candidateCount = computed(() => (catalogue.value?.templates ?? []).reduce((total, template) =>
    total + template.variants.reduce((count, variant) => count + variant.candidateCount, 0), 0));
  const requestCount = computed(() => chunkDeskVariants([...checked.value.values()]).length * models.value.length);
  const choices = ref<number | null>(3);
  const error = ref('');
  const detailLoading = ref(false);
  const saving = ref(false);
  const starting = ref(false);
  const stopping = ref(false);
  const clearing = ref(false);
  const busy = computed(() => starting.value || stopping.value || clearing.value || job.value?.status === 'running');

  let catalogueRequest = 0;
  let detailRequest = 0;
  let jobVersion = 0;
  let jobRequest: Promise<void> | undefined;
  let disposed = false;

  /** Load list metadata, keeping model choices after the first load. */
  async function loadCatalogue() {
    const request = ++catalogueRequest;
    const result = await api.getDeskCatalogue();
    if (disposed || request !== catalogueRequest) return;
    if (!catalogue.value) {
      const model = result.models.includes('default') ? 'default' : result.models[0];
      models.value = model ? [model] : [];
    }
    catalogue.value = result;
  }

  /** Load detail without letting batch results displace copies being edited. */
  async function loadDetail(target: DeskRef, refresh = false) {
    const request = ++detailRequest;
    const result = await api.getDeskVariant(target);
    if (disposed || request !== detailRequest) return;
    const key = deskRefKey(target);
    const saved = editsByVariant.get(key);
    const current = refresh && (openRow.value || saved) ? detail.value : undefined;
    const base = current ?? result;
    const candidates = new Map(result.candidates.map(candidate => [candidate.id, candidate]));
    const openCandidate = current?.candidates.find(candidate => candidate.id === openRow.value);
    if (openCandidate && !candidates.has(openCandidate.id)) candidates.set(openCandidate.id, openCandidate);
    if (saved?.revision === base.revision) {
      for (const { source } of saved.copies.values()) {
        if ('id' in source && !candidates.has(source.id)) candidates.set(source.id, source);
      }
    } else if (saved) {
      editsByVariant.delete(key);
    }
    detail.value = { ...base, candidates: [...candidates.values()] };
  }

  /** Read the selection and finish its loading state if it is still current. */
  async function loadSelection(target: DeskRef, refresh = false) {
    const request = detailRequest + 1;
    try {
      await loadDetail(target, refresh);
    } catch (cause) {
      if (request === detailRequest) error.value = errorMessage(cause);
    } finally {
      if (request === detailRequest) detailLoading.value = false;
    }
  }

  /** Select a variant and close the editor while retaining its edits. */
  async function select(target: DeskRef) {
    if (detail.value && deskRefKey(detail.value) === deskRefKey(target)) return;
    selected.value = target;
    openRow.value = undefined;
    detail.value = undefined;
    detailLoading.value = true;
    error.value = '';
    await loadSelection(target);
  }

  /** Keep models added from the provider catalog available for this visit. */
  function addModel(id: string) {
    if (!availableModels.value.includes(id)) discoveredModels.value.push(id);
    if (!models.value.includes(id)) models.value.push(id);
  }

  /** Track exceptions to the default of generating for all unsettled variants. */
  function check(refs: DeskRef[], enabled: boolean) {
    for (const target of refs) {
      if (enabled) unchecked.value.delete(deskRefKey(target));
      else unchecked.value.add(deskRefKey(target));
    }
  }

  /** Clear or restore the checks for variants that match the filters. */
  function toggleAll() {
    if (checked.value.size) check([...checked.value.values()], false);
    else check(eligible.value, true);
  }

  /** Open or collapse a row's editor. */
  function edit(row: string) {
    if (!detail.value || detail.value.settled || saving.value || clearing.value) return;
    openRow.value = openRow.value === row ? undefined : row;
  }

  /** Drop candidate edits while keeping changes to the current copy. */
  function keepCurrentEdit(key: string, saved: VariantEdits, revision = saved.revision) {
    const currentEdit = saved.copies.get(deskCurrentRow);
    if (currentEdit) editsByVariant.set(key, { revision, copies: new Map([[deskCurrentRow, currentEdit]]) });
    else editsByVariant.delete(key);
  }

  /** Reconcile a successful save, ignoring reads started before it. */
  function applySave(result: DeskVariantDetail, styleRevision?: string) {
    ++catalogueRequest;
    const key = deskRefKey(result);
    const summary = catalogue.value?.templates.find(template => template.id === result.templateId)
      ?.variants.find(variant => variant.id === result.variantId);
    if (summary) {
      summary.headline = result.text.headline;
      summary.settled = result.settled;
      summary.style = result.style;
      summary.candidateCount = result.candidates.length;
    }
    const saved = editsByVariant.get(key);
    const currentEdit = saved?.copies.get(deskCurrentRow);
    if (saved && currentEdit && saved.revision === styleRevision &&
      JSON.stringify(copyText(currentEdit.source)) === JSON.stringify(copyText(result.text))) {
      keepCurrentEdit(key, saved, result.revision);
    } else {
      editsByVariant.delete(key);
    }
    if (selected.value && deskRefKey(selected.value) === key) {
      ++detailRequest;
      detailLoading.value = false;
      if (styleRevision === undefined || openRow.value !== deskCurrentRow) openRow.value = undefined;
      detail.value = result;
    }
  }

  /** Save style separately from the copy and refresh grouping and candidates. */
  async function saveStyle(target: DeskRef, request: DeskStyleRequest) {
    saving.value = true;
    error.value = '';
    try {
      const result = await api.updateDeskVariantStyle(target, request);
      if (!disposed) applySave(result, request.revision);
    } finally {
      saving.value = false;
    }
  }

  /** Save the edited text when present, or use the row's original copy. */
  async function save(row: string) {
    const current = detail.value;
    if (!current || saving.value || clearing.value) return;
    const text = edits.value?.copies.get(row)?.text ?? rowSource(current, row);
    if (!text) return;
    const revision = current.revision;
    saving.value = true;
    error.value = '';
    try {
      const result = current.settled
        ? await api.unsettleDeskVariant(current, revision)
        : await api.settleDeskVariant(current, { ...copyText(text), revision });
      if (!disposed) applySave(result);
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      saving.value = false;
    }
  }

  /** Capture the visible copies and their revision before polling can change them. */
  function approvalSnapshot(): DeskApprovalSnapshot | undefined {
    const current = detail.value;
    if (!current || current.settled || !current.candidates.length || saving.value || clearing.value) return;
    const rows = [
      { id: deskCurrentRow, label: 'Current copy', text: current.text },
      ...current.candidates.map((candidate, index) => ({
        id: candidate.id, label: `Draft ${index + 1} · ${candidate.model}`, text: candidate,
      })),
    ];
    return {
      target: { templateId: current.templateId, variantId: current.variantId },
      revision: current.revision,
      copies: rows.map(row => {
        const edited = edits.value?.copies.get(row.id);
        return { id: row.id, label: edited ? `${row.label} (edited)` : row.label, text: copyText(edited?.text ?? row.text) };
      }),
    };
  }

  /** Save a snapshot and refresh the list to pick up the newly added siblings. */
  async function saveMany(target: DeskRef, request: DeskSettleManyRequest) {
    saving.value = true;
    error.value = '';
    try {
      const result = await api.settleDeskVariants(target, request);
      if (disposed) return;
      applySave(result);
      try {
        await loadCatalogue();
      } catch (cause) {
        error.value = errorMessage(cause);
      }
    } finally {
      saving.value = false;
    }
  }

  /** Refresh counts and the visible proposals when a request finishes. */
  async function refreshCandidates() {
    const target = selected.value;
    await Promise.all([
      loadCatalogue(),
      target && !detailLoading.value && !saving.value ? loadDetail(target, true) : undefined,
    ]);
  }

  /** Discard generated drafts while keeping the current copy and any edit to it. */
  async function clearDrafts() {
    if (busy.value || saving.value) return;
    clearing.value = true;
    error.value = '';
    try {
      const { cleared } = await api.clearDeskCandidates();
      if (disposed) return;
      if (openRow.value !== deskCurrentRow) openRow.value = undefined;
      for (const [key, saved] of editsByVariant) keepCurrentEdit(key, saved);
      for (const template of catalogue.value?.templates ?? []) {
        for (const variant of template.variants) variant.candidateCount = 0;
      }
      if (detail.value) detail.value.candidates = [];
      await Promise.all([
        loadCatalogue(),
        selected.value ? loadSelection(selected.value, true) : undefined,
      ]);
      return cleared;
    } catch (cause) {
      error.value = errorMessage(cause);
      // Another browser may have started a batch since the last refresh.
      await jobRequest;
      if (!disposed) await refreshJob();
    } finally {
      clearing.value = false;
    }
  }

  /** Fetch one poll at a time and reject replies superseded by start or stop. */
  function refreshJob(): Promise<void> {
    if (jobRequest) return jobRequest;
    const version = jobVersion;
    jobRequest = (async () => {
      try {
        const previous = job.value;
        const next = await api.getDeskJob();
        if (disposed || version !== jobVersion) return;
        if (previous?.status === 'running' &&
          (previous.id !== next?.id || previous.done !== next?.done ||
            previous.failed !== next?.failed || previous.status !== next?.status)) {
          await refreshCandidates();
        }
        if (!disposed && version === jobVersion) job.value = next;
      } catch (cause) {
        if (!disposed && version === jobVersion) error.value = errorMessage(cause);
      }
    })().finally(() => { jobRequest = undefined; });
    return jobRequest;
  }

  const poller = createPoller(() => { void refreshJob(); }, deskPollIntervalMs);
  watch(() => job.value?.status === 'running', (running, _previous, onCleanup) => {
    if (running) onCleanup(poller.acquire());
  });
  onScopeDispose(() => { disposed = true; });

  /** Fetch the catalogue and discover any job started on an earlier visit. */
  async function load() {
    try {
      await loadCatalogue();
      if (catalogue.value?.available && !disposed) await refreshJob();
    } catch (cause) {
      error.value = errorMessage(cause);
    }
  }

  /** Start drafting with the selected models and checked variants that match the filters. */
  async function generate() {
    const count = choices.value;
    if (busy.value || saving.value || !requestCount.value ||
      count === null || !Number.isInteger(count) || count < 1 || count > deskChoicesLimit) return;
    starting.value = true;
    ++jobVersion;
    error.value = '';
    try {
      const refs = [...checked.value.values()].map(({ templateId, variantId }) => ({ templateId, variantId }));
      job.value = await api.startDeskJob({ refs, models: models.value, choices: count });
      if (job.value.status !== 'running') await refreshCandidates();
    } catch (cause) {
      error.value = errorMessage(cause);
      // A second browser may have started a batch since this page entered.
      await jobRequest;
      if (!disposed) await refreshJob();
    } finally {
      starting.value = false;
    }
  }

  /** Stop the active batch and display the candidates already received. */
  async function stop() {
    if (stopping.value || job.value?.status !== 'running') return;
    stopping.value = true;
    ++jobVersion;
    error.value = '';
    try {
      job.value = await api.stopDeskJob();
      await refreshCandidates();
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      stopping.value = false;
    }
  }

  return {
    catalogue, tags, show, search, groups, eligible, checked, selected, detail, openRow, draft, edits, job, models, availableModels,
    choices, requestCount, candidateCount, error, detailLoading, saving, starting, stopping, clearing, busy,
    load, select, check, toggleAll, edit, save, saveStyle, approvalSnapshot, saveMany, generate, stop, clearDrafts, addModel,
  };
}
