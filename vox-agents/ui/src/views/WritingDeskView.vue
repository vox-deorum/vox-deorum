<script setup lang="ts">
import { computed, onMounted } from 'vue';
import Button from 'primevue/button';
import DeskVariantList from '@/components/newspaper/DeskVariantList.vue';
import DeskWritingRows from '@/components/newspaper/DeskWritingRows.vue';
import DeskBatchBar from '@/components/newspaper/DeskBatchBar.vue';
import { useWritingDesk } from '@/stores/writing-desk';
import type { DeskText } from '@/utils/types';

const {
  catalogue, tags, show, search, checked, selected, detail, draft, job, models, choices, requestCount,
  error, detailLoading, saving, starting, stopping, busy, load, select, check, toggleAll, edit, save, generate, stop,
} = useWritingDesk();

const variants = computed(() => catalogue.value?.templates.flatMap(template => template.variants) ?? []);
const settled = computed(() => variants.value.filter(variant => variant.settled).length);
const editText = computed({
  get: () => draft.value?.text,
  set: (text: DeskText | undefined) => { if (draft.value && text) draft.value.text = text; },
});

onMounted(load);
</script>

<template>
  <div class="desk-view">
    <header class="desk-header">
      <div class="desk-title">
        <Button as="router-link" to="/debug" icon="pi pi-arrow-left" text rounded size="small"
          severity="secondary" aria-label="Back to Debug" title="Back to Debug" />
        <h1>Writing Desk</h1>
      </div>
      <span v-if="catalogue?.available" class="desk-overall">{{ settled }}/{{ variants.length }} settled</span>
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
      <DeskVariantList
        v-model:tags="tags" v-model:show="show" v-model:search="search"
        :templates="catalogue.templates" :checked="checked" :selected="selected"
        @check="check" @toggle-all="toggleAll" @select="select"
      />
      <section class="desk-sheet" aria-label="Writing">
        <div v-if="detailLoading" class="loading-container">Loading the variant…</div>
        <template v-else-if="detail">
          <header class="desk-sheet-header">
            <div class="desk-selection">
              <span>{{ detail.templateId }}</span><span class="desk-selection-slash">/</span>
              <h2>{{ detail.variantId }}</h2>
            </div>
            <span v-if="detail.settled" class="desk-review-state"><i class="pi pi-check-circle" aria-hidden="true" /> Settled</span>
            <span v-else class="text-muted">{{ detail.candidates.length }} {{ detail.candidates.length === 1 ? 'candidate' : 'candidates' }}</span>
          </header>
          <div class="desk-rows">
            <DeskWritingRows v-model:draft="editText"
              :detail="detail" :open-row="draft?.row" :saving="saving" @edit="edit" @save="save" />
          </div>
        </template>
        <div v-else class="table-empty desk-unselected">
          <i class="pi pi-file-edit" aria-hidden="true" />
          <span>Select a variant to read its current copy and review drafts.</span>
        </div>
      </section>
      <DeskBatchBar v-if="checked.size || busy" v-model:choices="choices" v-model:models="models"
        :checked="checked.size" :request-count="requestCount" :available-models="catalogue.models" :job="job" :busy="busy"
        :starting="starting" :stopping="stopping" @generate="generate" @stop="stop" />
    </section>
  </div>
</template>
