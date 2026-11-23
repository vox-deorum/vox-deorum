<script setup lang="ts">
import { computed } from 'vue';
import Button from 'primevue/button';
import type { DeskText as Writing, DeskVariantDetail } from '@/utils/types';
import { deskCurrentRow } from '@/stores/writing-desk';
import DeskText from './DeskText.vue';
import DeskRowEditor from './DeskRowEditor.vue';

const props = defineProps<{
  detail: DeskVariantDetail;
  openRow?: string;
  edits?: ReadonlyMap<string, { text: Writing }>;
  saving: boolean;
}>();
const draft = defineModel<Writing>('draft');
const emit = defineEmits<{ edit: [row: string]; save: [row: string] }>();

interface Row {
  id: string;
  label?: string;
  text: Writing;
  warnings?: string[];
  first?: boolean;
}

const rows = computed<Row[]>(() => {
  const groups = new Map<string, Row[]>();
  for (const candidate of props.detail.candidates) {
    const group = groups.get(candidate.model) ?? [];
    group.push({
      id: candidate.id, label: group.length ? undefined : candidate.model,
      text: props.edits?.get(candidate.id)?.text ?? candidate,
      warnings: candidate.warnings, first: !group.length,
    });
    groups.set(candidate.model, group);
  }
  const current = props.edits?.get(deskCurrentRow)?.text ?? props.detail.text;
  return [{ id: deskCurrentRow, label: 'Current', text: current },
    ...[...groups.values()].flat()];
});

/** Name the action using the text it will settle. */
function actionLabel(row: Row): string {
  if (props.detail.settled) return 'Unsettle';
  return row.id === deskCurrentRow ? 'Settle current copy' : 'Settle candidate: ' + row.text.headline;
}
</script>

<template>
  <article v-for="row in rows" :key="row.id" class="desk-writing-row" :data-row="row.id"
    :class="{ 'desk-writing-open': openRow === row.id, 'desk-writing-group': row.first }"
  >
    <div class="desk-row-source">
      <span :class="{ 'desk-current-label': row.id === deskCurrentRow }">{{ row.label }}</span>
      <i v-if="row.warnings?.length" class="pi pi-exclamation-triangle desk-row-warning" tabindex="0"
        :title="row.warnings.join('\n')" :aria-label="row.warnings.join('; ')" />
    </div>
    <DeskRowEditor
      v-if="openRow === row.id && draft" v-model="draft" :variables="detail.variables" :disabled="saving"
      :subheadline="detail.text.subheadline !== undefined || row.text.subheadline !== undefined"
      :byline="detail.text.byline !== undefined || row.text.byline !== undefined"
    />
    <component :is="detail.settled ? 'div' : 'button'" v-else class="desk-copy"
      :type="detail.settled ? undefined : 'button'" :disabled="saving || undefined"
      :aria-expanded="detail.settled ? undefined : false"
      @click="emit('edit', row.id)"
    >
      <span class="desk-copy-headline"><DeskText :text="row.text.headline" :variables="detail.variables" /></span>
      <span v-if="row.text.subheadline" class="desk-copy-subtitle"><DeskText :text="row.text.subheadline" :variables="detail.variables" /></span>
      <span v-if="row.text.byline" class="desk-copy-byline"><DeskText :text="row.text.byline" :variables="detail.variables" /></span>
      <span v-for="(paragraph, index) in row.text.body" :key="index" class="desk-copy-paragraph">
        <DeskText :text="paragraph" :variables="detail.variables" />
      </span>
    </component>
    <div class="desk-row-actions">
      <Button v-if="openRow === row.id" icon="pi pi-chevron-up" text rounded size="small" severity="secondary"
        :disabled="saving" aria-label="Close editor" title="Close editor" @click="emit('edit', row.id)" />
      <Button :icon="detail.settled ? 'pi pi-times' : 'pi pi-check'" text rounded size="small"
        :severity="detail.settled ? 'secondary' : 'success'" :disabled="saving"
        :title="actionLabel(row)" :aria-label="actionLabel(row)" @click="emit('save', row.id)" />
    </div>
  </article>
</template>
