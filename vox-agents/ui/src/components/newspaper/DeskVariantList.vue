<script setup lang="ts">
import { computed } from 'vue';
import Checkbox from 'primevue/checkbox';
import Tag from 'primevue/tag';
import { VList } from 'virtua/vue';
import type { DeskRef, DeskVariantSummary } from '@/utils/types';
import type { DeskVariantGroup } from '@/stores/writing-desk';
import { deskRefKey } from '@vox/newspaper/desk/batch.js';

const props = defineProps<{
  groups: DeskVariantGroup[];
  checked: ReadonlyMap<string, DeskRef>;
  selected?: DeskRef;
}>();
const emit = defineEmits<{
  check: [refs: DeskRef[], enabled: boolean];
  select: [ref: DeskRef];
}>();
const groups = computed(() => props.groups.map(group => ({
  ...group,
  selectedCount: group.eligible.filter(target => props.checked.has(deskRefKey(target))).length,
})));

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
  <aside class="desk-list" aria-label="Templates">
    <header class="table-header desk-sheet-header"><h2>Templates</h2></header>
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
          <h3>{{ template.id }}</h3>
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
            <Tag class="desk-voice" severity="secondary" :value="variant.style.voice"
              :title="variant.style.voice + ' / ' + variant.style.stance + ' / ' + variant.style.genre"
            />
          </button>
        </div>
      </div>
    </VList>
  </aside>
</template>
