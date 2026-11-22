<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import SelectButton from 'primevue/selectbutton';
import { VList } from 'virtua/vue';
import type { DeskRef, DeskTemplateSummary, DeskVariantSummary } from '@/utils/types';
import type { DeskShow } from '@/stores/writing-desk';
import { deskRefKey } from '@vox/newspaper/desk/batch.js';

const props = defineProps<{
  templates: DeskTemplateSummary[];
  checked: ReadonlyMap<string, DeskRef>;
  selected?: DeskRef;
}>();
const emit = defineEmits<{
  check: [refs: DeskRef[], enabled: boolean];
  toggleAll: [];
  select: [ref: DeskRef];
}>();
const tags = defineModel<string[]>('tags', { required: true });
const show = defineModel<DeskShow>('show', { required: true });
const search = defineModel<string>('search', { required: true });
const query = ref(search.value);

watch(search, (value, _previous, onCleanup) => {
  const timeout = window.setTimeout(() => { query.value = value; }, 300);
  onCleanup(() => window.clearTimeout(timeout));
});

const showOptions: { label: string; value: DeskShow }[] = [
  { label: 'All', value: 'all' },
  { label: 'Unsettled', value: 'unsettled' },
  { label: 'Settled', value: 'settled' },
];

const voices: Record<string, string> = {
  general: 'slate', spoken: 'orange', crier: 'yellow', chronicle: 'violet', gazette: 'blue',
  pamphlet: 'pink', press: 'teal', tabloid: 'rose', broadcast: 'indigo', feed: 'cyan',
};

const allTags = computed(() => [...new Set(props.templates.flatMap(template => template.tags))].sort());
const hasUnsettled = computed(() => props.templates.some(template => template.variants.some(variant => !variant.settled)));
const groups = computed(() => {
  const term = query.value.trim().toLowerCase();
  return props.templates.flatMap(template => {
    if (tags.value.length && !template.tags.some(tag => tags.value.includes(tag))) return [];
    const matchesTemplate = template.id.toLowerCase().includes(term);
    const variants = template.variants.filter(variant =>
      (show.value === 'all' || variant.settled === (show.value === 'settled')) &&
      (matchesTemplate || [variant.id, variant.headline, variant.style.voice].some(value => value.toLowerCase().includes(term))),
    );
    if (!variants.length) return [];
    const eligible = template.variants.filter(variant => !variant.settled)
      .map(variant => address(template.id, variant.id));
    const selectedCount = eligible.filter(target => props.checked.has(deskRefKey(target))).length;
    return [{ template, variants, eligible, selectedCount }];
  });
});

/** Toggle a topic without disturbing other filters. */
function toggleTag(tag: string) {
  tags.value = tags.value.includes(tag) ? tags.value.filter(value => value !== tag) : [...tags.value, tag];
}

/** Build the address used for selection and batch operations. */
function address(templateId: string, variantId: string): DeskRef {
  return { templateId, variantId };
}

/** Avoid repeating the template name when the ID gives the variant a shared prefix. */
function variantLabel(templateId: string, variantId: string): string {
  const prefix = templateId.replace(/-account$/, '') + '-';
  return variantId.startsWith(prefix) ? variantId.slice(prefix.length) : variantId;
}

/** Describe the three review states without relying on the dot color. */
function status(variant: DeskVariantSummary): string {
  if (variant.settled) return 'Settled';
  if (variant.candidateCount) return variant.candidateCount + (variant.candidateCount === 1 ? ' candidate' : ' candidates');
  return 'No candidates';
}
</script>

<template>
  <div v-if="allTags.length" class="desk-tags" aria-label="Topic filters">
    <button
      v-for="tag in allTags" :key="tag" type="button" class="desk-filter-chip"
      :aria-pressed="tags.includes(tag)" @click="toggleTag(tag)"
    >{{ tag }}</button>
  </div>
  <aside class="desk-list surface-section" aria-label="Templates">
    <div class="desk-list-tools">
      <InputText v-model="search" size="small" placeholder="Find a template or variant" aria-label="Search templates or variants" />
      <SelectButton
        v-model="show" :options="showOptions" option-label="label" option-value="value"
        :allow-empty="false" size="small" aria-label="Show variants"
      />
      <Button v-if="hasUnsettled" :label="checked.size ? 'Clear selection' : 'Select all unsettled'"
        size="small" severity="secondary" text @click="emit('toggleAll')" />
    </div>
    <div v-if="!groups.length" class="table-empty">No variants match these filters.</div>
    <VList v-else :data="groups" class="desk-list-scroll" #default="{ item: { template, variants, eligible, selectedCount } }">
      <div class="desk-template">
        <div class="desk-template-title">
          <Checkbox
            :model-value="eligible.length > 0 && selectedCount === eligible.length"
            :indeterminate="selectedCount > 0 && selectedCount < eligible.length"
            :disabled="!eligible.length"
            binary :aria-label="'Check all variants of ' + template.id"
            @update:model-value="emit('check', eligible, selectedCount !== eligible.length)"
          />
          <h2>{{ template.id }}</h2>
          <i v-if="template.triggerSummary" class="pi pi-info-circle text-muted" tabindex="0"
            :title="template.triggerSummary" :aria-label="template.triggerSummary" />
        </div>
        <div
          v-for="variant in variants" :key="variant.id" class="desk-variant"
          :class="{ 'desk-variant-selected': selected?.templateId === template.id && selected?.variantId === variant.id }"
        >
          <Checkbox
            :model-value="checked.has(deskRefKey(address(template.id, variant.id)))"
            :disabled="variant.settled"
            binary :aria-label="'Check ' + template.id + ' / ' + variant.id"
            @update:model-value="emit('check', [address(template.id, variant.id)], Boolean($event))"
          />
          <button type="button" class="desk-variant-link"
            :aria-label="variant.id + ', ' + status(variant) + ', ' + variant.style.voice"
            :aria-current="selected?.templateId === template.id && selected?.variantId === variant.id ? 'true' : undefined"
            @click="emit('select', address(template.id, variant.id))"
          >
            <span class="desk-status" role="img" :title="status(variant)" :aria-label="status(variant)"
              :data-status="variant.settled ? 'settled' : variant.candidateCount ? 'candidates' : 'empty'" />
            <span class="desk-variant-id" :title="variant.id">{{ variantLabel(template.id, variant.id) }}</span>
            <span class="desk-voice" :data-voice-color="voices[variant.style.voice] ?? voices.general"
              :title="variant.style.voice + ' / ' + variant.style.stance + ' / ' + variant.style.genre"
            >{{ variant.style.voice }}</span>
          </button>
        </div>
      </div>
    </VList>
  </aside>
</template>
