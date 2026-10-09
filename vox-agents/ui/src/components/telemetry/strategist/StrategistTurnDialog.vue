<template>
  <DetailDialog
    v-model:visible="dialogVisible"
    :header="root.name"
    :entries="rawEntries"
    height="90vh"
  >
    <template #header>
      <div class="flex align-items-center flex-wrap gap-2 flex-1">
        <span class="p-dialog-title">{{ root.name }}</span>
        <Tag :value="turn.kind === 'evaluator' ? 'Evaluator' : 'LLM'" :severity="turn.kind === 'evaluator' ? 'info' : undefined" />
        <Tag :value="`${turn.player.name} (${turn.player.id})`" severity="secondary" />
        <Tag v-for="flag in flags" :key="flag.label" :value="flag.label" :severity="flag.severity" />
        <span class="flex-1"></span>
        <Button :label="showRaw ? 'Decisions' : 'Raw attributes'" text size="small" @click="showRaw = !showRaw" />
      </div>
    </template>

    <template v-if="!showRaw" #default>
      <div class="turn-layout">
        <div class="turn-decisions">
          <div class="table-toolbar">
            <SelectButton
              v-model="filter"
              :options="filters"
              optionLabel="label"
              optionValue="value"
              :allowEmpty="false"
              size="small"
            />
          </div>

          <DecisionSection v-if="turn.statusQuo" title="Status quo" :rationale="turn.statusQuo" />

          <DecisionSection title="Strategy" :items="turn.choices">
            <ChoiceRow
              v-for="item in shown(turn.choices)"
              :key="item.key"
              :item="item"
              :rationale="item.state === 'same' ? undefined : turn.rationales[item.key]"
            />
          </DecisionSection>

          <DecisionSection
            v-for="section in scaleSections"
            :key="section.title"
            :title="section.title"
            :items="section.items"
            :rationale="section.rationale"
          >
            <div v-if="shown(section.items).length" class="scale-grid">
              <div
                v-for="item in shown(section.items)"
                :key="item.key"
                class="scale-row"
                :class="stateClass(item)"
              >
                <span class="decision-name" :title="item.label">{{ item.label }}</span>
                <ScaleCell :item="item" :min="section.range[0]" :max="section.range[1]" />
              </div>
            </div>
          </DecisionSection>

          <DecisionSection title="Relationships" :items="relationshipItems">
            <div class="relationship-row relationship-head">
              <span></span><span>Public</span><span>Private</span>
            </div>
            <div
              v-for="relation in shownRelationships"
              :key="relation.name"
              class="relationship-row"
            >
              <span class="decision-name" :class="{ 'state-same': !isChanged(relation.public) && !isChanged(relation.private) }">
                {{ relation.name }}
              </span>
              <ScaleCell :item="relation.public" :min="relationshipRange[0]" :max="relationshipRange[1]" />
              <ScaleCell :item="relation.private" :min="relationshipRange[0]" :max="relationshipRange[1]" />
              <MarkdownText v-if="relation.rationale" class="decision-why" :content="relation.rationale" />
            </div>
          </DecisionSection>
        </div>

        <TurnMetaSidebar :turn="turn" :spanCount="spans.length" />
      </div>
    </template>
  </DetailDialog>
</template>

<script setup lang="ts">
/**
 * StrategistTurnDialog - The decisions of one `strategist.turn.N` trace on the left and the turn
 * metadata on the right. Evaluator and LLM strategists share the same sections. It shares the
 * DetailDialog frame, so switching to the raw attributes keeps the same size.
 */
import { computed, ref, watch } from 'vue';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import SelectButton from 'primevue/selectbutton';
import DetailDialog from '../../shared/DetailDialog.vue';
import MarkdownText from '../../shared/MarkdownText.vue';
import DecisionSection from './DecisionSection.vue';
import ChoiceRow from './ChoiceRow.vue';
import ScaleCell from './ScaleCell.vue';
import TurnMetaSidebar from './TurnMetaSidebar.vue';
import type { Span } from '@/utils/types';
import {
  buildStrategistTurn,
  flavorRange,
  isChanged,
  personaRange,
  relationshipRange,
  stateClass,
  turnFlags,
  type DecisionItem,
} from '@/api/strategist-turn';
import { spanDetailEntries } from '@/api/telemetry-utils';

const props = defineProps<{
  visible: boolean;
  root: Span;
  /** All spans of the root's trace, with parsed attributes. */
  spans: Span[];
}>();

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
}>();

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
});

const filters = [
  { label: 'Changed', value: 'changed' },
  { label: 'All', value: 'all' },
];
const filter = ref<'changed' | 'all'>('changed');

const turn = computed(() => buildStrategistTurn(props.root, props.spans));
const flags = computed(() => turnFlags(props.root));

// The raw attributes of the turn root, shown in place of the decisions
const showRaw = ref(false);
const rawEntries = computed(() => spanDetailEntries(props.root));
watch(() => props.root, () => { showRaw.value = false; });

/** Rows the active filter shows. */
function shown(items: DecisionItem[]): DecisionItem[] {
  return filter.value === 'all' ? items : items.filter(isChanged);
}

const scaleSections = computed(() => [
  { title: 'Flavors', items: turn.value.flavors, range: flavorRange, rationale: turn.value.rationales.flavors },
  { title: 'Persona', items: turn.value.persona, range: personaRange, rationale: turn.value.rationales.persona },
]);

const relationshipItems = computed(() => turn.value.relationships.flatMap(r => [r.public, r.private]));

const shownRelationships = computed(() => turn.value.relationships
  .filter(r => filter.value === 'all' || isChanged(r.public) || isChanged(r.private)));
</script>
