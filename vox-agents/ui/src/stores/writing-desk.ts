import { computed, onScopeDispose, ref, watch } from 'vue';
import { api } from '@/api/client';
import { errorMessage } from '@/utils/errors';
import type {
  DeskCandidate, DeskCatalogueResponse, DeskJob, DeskRef, DeskStyle, DeskTemplateSummary, DeskText,
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
  row: string;
  revision: string;
  text: DeskText;
}

/** Copy only the fields that can be edited and saved. */
function copyText(text: DeskText): DeskText {
  const { headline, subheadline, byline, body } = text;
  return { headline, subheadline, byline, body: [...body] };
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
  const draft = ref<EditDraft>();
  const job = ref<DeskJob | null>(null);
  const models = ref<string[]>([]);
  const requestCount = computed(() => chunkDeskVariants([...checked.value.values()]).length * models.value.length);
  const choices = ref<number | null>(3);
  const error = ref('');
  const detailLoading = ref(false);
  const saving = ref(false);
  const starting = ref(false);
  const stopping = ref(false);
  const busy = computed(() => starting.value || stopping.value || job.value?.status === 'running');

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

  /** Load one detail while protecting the active row and revision during a draft. */
  async function loadDetail(target: DeskRef, refresh = false) {
    const request = ++detailRequest;
    const result = await api.getDeskVariant(target);
    if (disposed || request !== detailRequest) return;
    const editing = draft.value;
    const current = detail.value;
    if (refresh && editing && current) {
      const candidate = current.candidates.find(row => row.id === editing.row);
      const candidates = candidate && !result.candidates.some(row => row.id === candidate.id)
        ? [...result.candidates, candidate]
        : result.candidates;
      detail.value = { ...current, candidates };
    } else {
      detail.value = result;
    }
  }

  /** Select a variant and reset the previous variant's editor. */
  async function select(target: DeskRef) {
    if (detail.value && deskRefKey(detail.value) === deskRefKey(target)) return;
    selected.value = target;
    draft.value = undefined;
    detail.value = undefined;
    detailLoading.value = true;
    error.value = '';
    const request = detailRequest + 1;
    try {
      await loadDetail(target);
    } catch (cause) {
      if (request === detailRequest) error.value = errorMessage(cause);
    } finally {
      if (request === detailRequest) detailLoading.value = false;
    }
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

  /** Open a row with a fresh copy or close it if it is already open. */
  function edit(row: string, text: DeskText) {
    if (!detail.value || detail.value.settled || saving.value) return;
    draft.value = draft.value?.row === row
      ? undefined
      : { row, revision: detail.value.revision, text: copyText(text) };
  }

  /** Reconcile a successful save, ignoring reads started before it. */
  function applySave(result: DeskVariantDetail) {
    ++catalogueRequest;
    const key = deskRefKey(result);
    const summary = catalogue.value?.templates.find(template => template.id === result.templateId)
      ?.variants.find(variant => variant.id === result.variantId);
    if (summary) {
      summary.headline = result.text.headline;
      summary.settled = result.settled;
      summary.candidateCount = result.candidates.length;
    }
    if (selected.value && deskRefKey(selected.value) === key) {
      ++detailRequest;
      detailLoading.value = false;
      detail.value = result;
      draft.value = undefined;
    }
  }

  /** Save either the edited copy or the full original text of a collapsed row. */
  async function save(row: string, source: DeskText | DeskCandidate) {
    const current = detail.value;
    if (!current || saving.value) return;
    const editing = draft.value?.row === row ? draft.value : undefined;
    const revision = editing?.revision ?? current.revision;
    saving.value = true;
    error.value = '';
    try {
      const result = current.settled
        ? await api.unsettleDeskVariant(current, revision)
        : await api.settleDeskVariant(current, { ...copyText(editing?.text ?? source), revision });
      if (!disposed) applySave(result);
    } catch (cause) {
      error.value = errorMessage(cause);
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
    if (busy.value || !requestCount.value ||
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
    catalogue, tags, show, search, groups, eligible, checked, selected, detail, draft, job, models, choices, requestCount,
    error, detailLoading, saving, starting, stopping, busy, load, select, check, toggleAll, edit, save, generate, stop,
  };
}
