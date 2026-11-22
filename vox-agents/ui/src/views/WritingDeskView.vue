<script setup lang="ts">
import { computed, onMounted } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import MultiSelect from 'primevue/multiselect';
import SelectButton from 'primevue/selectbutton';
import DeskVariantList from '@/components/newspaper/DeskVariantList.vue';
import DeskWritingRows from '@/components/newspaper/DeskWritingRows.vue';
import DeskBatchBar from '@/components/newspaper/DeskBatchBar.vue';
import { useWritingDesk, type DeskShow } from '@/stores/writing-desk';
import type { DeskText } from '@/utils/types';

const {
  catalogue, tags, show, search, groups, eligible, checked, selected, detail, draft, job, models, choices, requestCount,
  error, detailLoading, saving, starting, stopping, busy, load, select, check, toggleAll, edit, save, generate, stop,
} = useWritingDesk();

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
        <InputText v-model="search" class="desk-search" size="small" placeholder="Find a template or variant"
          aria-label="Search templates or variants" />
        <SelectButton v-model="show" :options="showOptions" option-label="label" option-value="value"
          :allow-empty="false" size="small" aria-label="Show variants" />
        <MultiSelect v-if="allTags.length" v-model="tags" :options="allTags" size="small" class="desk-topics"
          :max-selected-labels="2" placeholder="All topics" aria-label="Topics" />
        <span class="toolbar-spacer" aria-hidden="true" />
        <Button v-if="eligible.length" :label="selectionLabel"
          size="small" severity="secondary" outlined @click="toggleAll" />
      </div>
      <DeskBatchBar v-if="checked.size || busy" v-model:choices="choices" v-model:models="models"
        :checked="checked.size" :request-count="requestCount" :available-models="catalogue.models" :job="job" :busy="busy"
        :starting="starting" :stopping="stopping" @generate="generate" @stop="stop" />
      <div class="desk-panes">
        <DeskVariantList :groups="groups" :checked="checked" :selected="selected" @check="check" @select="select" />
        <section class="desk-sheet" aria-label="Writing">
          <header class="table-header desk-sheet-header">
            <div v-if="detail" class="desk-selection">
              <div class="desk-variant-title">
                <span class="text-muted">{{ detail.templateId }} /</span>
                <h2>{{ detail.variantId }}</h2>
              </div>
              <dl class="desk-variant-style" aria-label="Variant style">
                <div><dt class="text-muted">Voice</dt><dd>{{ detail.style.voice }}</dd></div>
                <div><dt class="text-muted">Stance</dt><dd>{{ detail.style.stance }}</dd></div>
                <div><dt class="text-muted">Genre</dt><dd>{{ detail.style.genre }}</dd></div>
              </dl>
            </div>
            <h2 v-else>Article copy</h2>
            <span v-if="detail?.settled" class="desk-review-state"><i class="pi pi-check-circle" aria-hidden="true" /> Settled</span>
            <span v-else-if="detail" class="text-muted">{{ detail.candidates.length }} {{ detail.candidates.length === 1 ? 'candidate' : 'candidates' }}</span>
          </header>
          <div v-if="detailLoading" class="table-empty" role="status">Loading the variant…</div>
          <div v-else-if="detail" class="desk-rows">
            <DeskWritingRows v-model:draft="editText"
              :detail="detail" :open-row="draft?.row" :saving="saving" @edit="edit" @save="save" />
          </div>
          <div v-else class="table-empty">
            <i class="pi pi-file-edit" aria-hidden="true" />
            <p>No variant selected</p>
            <p class="text-muted">Choose a variant to read its current copy and review drafts.</p>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>
