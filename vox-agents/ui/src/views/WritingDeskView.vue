<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import RadioButton from 'primevue/radiobutton';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import { useToast } from 'primevue/usetoast';
import DeskVariantList from '@/components/newspaper/DeskVariantList.vue';
import DeskWritingRows from '@/components/newspaper/DeskWritingRows.vue';
import DeskBatchBar from '@/components/newspaper/DeskBatchBar.vue';
import { useWritingDesk, type DeskApprovalSnapshot, type DeskShow } from '@/stores/writing-desk';
import { errorMessage } from '@/utils/errors';
import type { DeskRef, DeskStyle, DeskStyleRequest, DeskText } from '@/utils/types';

const {
  catalogue, tags, show, search, groups, eligible, checked, selected, detail, draft, job, models, availableModels,
  choices, requestCount, candidateCount, error, detailLoading, saving, starting, stopping, clearing, busy,
  load, select, check, toggleAll, edit, save, saveStyle, approvalSnapshot, saveMany, generate, stop, clearDrafts, addModel,
} = useWritingDesk();
const styleFields = [
  { key: 'voice', label: 'Voice' },
  { key: 'stance', label: 'Stance' },
  { key: 'genre', label: 'Genre' },
] as const;
const editingStyle = ref(false);
const styleEdit = ref<{ target: DeskRef; original: DeskStyle; request: DeskStyleRequest }>();
const styleError = ref('');
const styleChanged = computed(() => {
  const edit = styleEdit.value;
  return edit && styleFields.some(({ key }) => edit.request.style[key] !== edit.original[key]);
});
const confirmClear = ref(false);
const approving = ref(false);
const approval = ref<DeskApprovalSnapshot>();
const approved = ref<string[]>([]);
const primary = ref<string>();
const approvalError = ref('');
const toast = useToast();
let clearConfirmed = false;

/** Open the style editor with the variant and revision currently shown. */
function openStyle() {
  if (!detail.value) return;
  const { templateId, variantId, style, revision } = detail.value;
  styleEdit.value = { target: { templateId, variantId }, original: style, request: { style: { ...style }, revision } };
  styleError.value = '';
  editingStyle.value = true;
}

/** Keep the chosen tags available for correction if the save fails. */
async function confirmStyle() {
  const edit = styleEdit.value;
  if (!edit || !styleChanged.value || saving.value || clearing.value) return;
  styleError.value = '';
  try {
    await saveStyle(edit.target, edit.request);
    editingStyle.value = false;
  } catch (cause) {
    styleError.value = errorMessage(cause);
  }
}

/** Freeze the copies shown in the approval dialog, including the open edit. */
function openApproval() {
  approval.value = approvalSnapshot();
  if (!approval.value) return;
  approved.value = [];
  primary.value = undefined;
  approvalError.value = '';
  approving.value = true;
}

/** Save the chosen primary and siblings, keeping selections on rejection. */
async function confirmApproval() {
  const snapshot = approval.value;
  if (!snapshot || saving.value) return;
  const selectedCopies = snapshot.copies.filter(copy => approved.value.includes(copy.id));
  const original = selectedCopies.find(copy => copy.id === primary.value);
  if (!original || selectedCopies.length < 2) return;
  approvalError.value = '';
  try {
    await saveMany(snapshot.target, {
      revision: snapshot.revision,
      primary: original.text,
      siblings: selectedCopies.filter(copy => copy !== original).map(copy => copy.text),
    });
    approving.value = false;
    toast.add({ severity: 'success', summary: `${selectedCopies.length} copies settled`, life: 4000 });
  } catch (cause) {
    approvalError.value = errorMessage(cause);
  }
}

/** Close the confirmation and clear unapproved drafts. */
async function confirmClearDrafts() {
  clearConfirmed = true;
  confirmClear.value = false;
  const cleared = await clearDrafts();
  if (cleared !== undefined) {
    toast.add({ severity: 'success', summary: `${cleared} generated ${cleared === 1 ? 'draft' : 'drafts'} cleared`, life: 4000 });
  }
}

/** Move focus back to the desk when the clear button may have disappeared. */
function finishClearDialog() {
  if (!clearConfirmed) return;
  clearConfirmed = false;
  document.getElementById('desk-variant-search')?.focus();
}

const variants = computed(() => catalogue.value?.templates.flatMap(template => template.variants) ?? []);
const settled = computed(() => variants.value.filter(variant => variant.settled).length);
const allTags = computed(() => [...new Set(catalogue.value?.templates.flatMap(template => template.tags))].sort());
const selectionLabel = computed(() => {
  if (checked.value.size) return 'Clear selection';
  return search.value.trim() || tags.value.length ? 'Select matching unsettled' : 'Select all unsettled';
});
const showOptions: { label: string; value: DeskShow }[] = [
  { label: 'All', value: 'all' },
  { label: 'Unsettled', value: 'unsettled' },
  { label: 'Settled', value: 'settled' },
];
const editText = computed({
  get: () => draft.value?.text,
  set: (text: DeskText | undefined) => { if (draft.value && text) draft.value.text = text; },
});

onMounted(load);
</script>

<template>
  <div class="desk-view">
    <header class="page-header">
      <div class="page-header-left">
        <h1>Writing Desk</h1>
      </div>
      <div v-if="catalogue?.available" class="page-header-controls">
        <span class="desk-overall text-muted">{{ settled }}/{{ variants.length }} settled</span>
      </div>
    </header>

    <div v-if="error" class="desk-error" role="alert">
      <i class="pi pi-exclamation-circle" aria-hidden="true" />
      {{ error }}
      <Button v-if="!catalogue" label="Retry" size="small" severity="secondary" text @click="load" />
    </div>

    <div v-if="!catalogue && !error" class="loading-container">Loading the stock catalogue…</div>
    <div v-else-if="catalogue && !catalogue.available" class="table-empty">
      {{ catalogue.reason || 'The Writing Desk needs a writable source checkout.' }}
    </div>
    <section v-else-if="catalogue" class="desk-workspace panel-container" aria-label="Writing workspace">
      <div class="panel-toolbar desk-toolbar" role="group" aria-label="Variant filters">
        <InputText id="desk-variant-search" v-model="search" class="desk-search" size="small" placeholder="Find a template or variant"
          aria-label="Search templates or variants" />
        <SelectButton v-model="show" :options="showOptions" option-label="label" option-value="value"
          :allow-empty="false" size="small" aria-label="Show variants" />
        <MultiSelect v-if="allTags.length" v-model="tags" :options="allTags" size="small" class="desk-topics"
          :max-selected-labels="2" placeholder="All topics" aria-label="Topics" />
        <span class="toolbar-spacer" aria-hidden="true" />
        <Button v-if="eligible.length" :label="selectionLabel"
          size="small" severity="secondary" outlined @click="toggleAll" />
      </div>
      <DeskBatchBar v-if="checked.size || busy || candidateCount" v-model:choices="choices" v-model:models="models"
        :checked="checked.size" :request-count="requestCount" :available-models="availableModels" :job="job" :busy="busy"
        :starting="starting" :stopping="stopping" :clearing="clearing" :candidate-count="candidateCount" :saving="saving"
        @generate="generate" @stop="stop" @clear="confirmClear = true" @add-model="addModel" />
      <div class="desk-panes">
        <DeskVariantList :groups="groups" :checked="checked" :selected="selected" @check="check" @select="select" />
        <section class="desk-sheet" aria-label="Writing">
          <header class="table-header desk-sheet-header">
            <div v-if="detail" class="desk-selection">
              <div class="desk-variant-title">
                <span class="text-muted">{{ detail.templateId }} /</span>
                <h2>{{ detail.variantId }}</h2>
              </div>
              <div class="flex flex-wrap align-items-center gap-2">
                <dl class="desk-variant-style" aria-label="Variant style">
                  <div v-for="{ key, label } in styleFields" :key="key">
                    <dt class="text-muted">{{ label }}</dt><dd>{{ detail.style[key] }}</dd>
                  </div>
                </dl>
                <Button label="Edit style" size="small" severity="secondary" text
                  :disabled="saving || clearing || detailLoading" @click="openStyle" />
              </div>
            </div>
            <h2 v-else>Article copy</h2>
            <span v-if="detail?.settled" class="desk-review-state"><i class="pi pi-check-circle" aria-hidden="true" /> Settled</span>
            <div v-else-if="detail" class="flex flex-wrap align-items-center justify-content-end gap-2">
              <span class="text-muted">{{ detail.candidates.length }} {{ detail.candidates.length === 1 ? 'candidate' : 'candidates' }}</span>
              <Button v-if="detail.candidates.length" label="Settle multiple…" size="small" severity="secondary" outlined
                :disabled="saving || clearing || detailLoading" @click="openApproval" />
            </div>
          </header>
          <div v-if="detailLoading" class="table-empty" role="status">Loading the variant…</div>
          <div v-else-if="detail" class="desk-rows">
            <DeskWritingRows v-model:draft="editText"
              :detail="detail" :open-row="draft?.row" :saving="saving || clearing" @edit="edit" @save="save" />
          </div>
          <div v-else class="table-empty">
            <i class="pi pi-file-edit" aria-hidden="true" />
            <p>No variant selected</p>
            <p class="text-muted">Choose a variant to read its current copy and review drafts.</p>
          </div>
        </section>
      </div>
    </section>
    <Dialog v-model:visible="editingStyle" header="Edit variant style" modal :style="{ width: '34rem', maxWidth: '95vw' }"
      :closable="!saving" :close-on-escape="!saving" @after-hide="styleEdit = undefined">
      <div v-if="styleEdit && catalogue" class="flex flex-column gap-3">
        <div v-if="styleError" class="desk-error" role="alert">{{ styleError }}</div>
        <div v-for="{ key, label } in styleFields" :key="key">
          <span :id="`desk-style-${key}`" class="block mb-1">{{ label }}</span>
          <Select v-model="styleEdit.request.style[key]" :options="catalogue.styles[key]" option-label="id" option-value="id"
            :aria-labelledby="`desk-style-${key}`" size="small" fluid :disabled="saving" />
          <p class="text-sm text-muted mt-1 mb-0">
            {{ catalogue.styles[key].find(tag => tag.id === styleEdit?.request.style[key])?.guidance }}
          </p>
        </div>
        <p v-if="detail && !detail.settled" class="text-sm text-muted m-0">Saving clears generated drafts for this variant.</p>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" text :disabled="saving" @click="editingStyle = false" />
        <Button label="Save style" :loading="saving" :disabled="!styleChanged || saving || clearing" @click="confirmStyle" />
      </template>
    </Dialog>
    <Dialog v-model:visible="approving" header="Settle multiple copies" modal :style="{ width: '34rem', maxWidth: '95vw' }"
      :closable="!saving" :close-on-escape="!saving" @after-hide="approval = undefined">
      <p v-if="approval">Approve at least two copies. Choose which keeps the ID <strong>{{ approval.target.variantId }}</strong>.
        The other copies get numbered IDs in a companion file.</p>
      <div v-if="approvalError" class="desk-error" role="alert">{{ approvalError }}</div>
      <ul class="list-none p-0 m-0">
        <li v-for="(copy, index) in approval?.copies" :key="copy.id" class="flex flex-wrap gap-2 align-items-start py-2">
          <Checkbox v-model="approved" :input-id="`desk-approve-${index}`" :value="copy.id" :disabled="saving" />
          <div class="flex-1 min-w-0">
            <label :for="`desk-approve-${index}`" class="block">
              <span class="text-muted block">{{ copy.label }}</span>
              <strong>{{ copy.text.headline }}</strong>
            </label>
            <details class="mt-1 text-sm">
              <summary>Read copy</summary>
              <p v-if="copy.text.subheadline">{{ copy.text.subheadline }}</p>
              <p v-if="copy.text.byline"><em>{{ copy.text.byline }}</em></p>
              <p v-for="(paragraph, paragraphIndex) in copy.text.body" :key="paragraphIndex">{{ paragraph }}</p>
            </details>
          </div>
          <div v-if="approved.includes(copy.id)" class="flex align-items-center gap-2">
            <RadioButton v-model="primary" :input-id="`desk-primary-${index}`" name="desk-primary"
              :value="copy.id" :disabled="saving" :aria-label="`Keep original ID for ${copy.label}`" />
            <label :for="`desk-primary-${index}`">Keep ID</label>
          </div>
        </li>
      </ul>
      <template #footer>
        <Button label="Cancel" severity="secondary" text :disabled="saving" @click="approving = false" />
        <Button :label="`Settle ${approved.length} copies`" :loading="saving"
          :disabled="approved.length < 2 || !primary || !approved.includes(primary) || saving" @click="confirmApproval" />
      </template>
    </Dialog>
    <Dialog v-model:visible="confirmClear" header="Clear generated drafts?" modal :style="{ maxWidth: '28rem' }"
      @after-hide="finishClearDialog">
      <p>This clears drafts across the Writing Desk, including variants hidden by filters. Current copy and settled examples will stay.</p>
      <template #footer>
        <Button label="Cancel" severity="secondary" text autofocus @click="confirmClear = false" />
        <Button label="Clear all drafts" severity="danger" :disabled="busy || saving" @click="confirmClearDrafts" />
      </template>
    </Dialog>
  </div>
</template>
