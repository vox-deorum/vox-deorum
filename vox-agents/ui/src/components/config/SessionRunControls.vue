<script setup lang="ts">
import { computed, ref } from 'vue';
import Card from 'primevue/card';
import Checkbox from 'primevue/checkbox';
import Dropdown from 'primevue/dropdown';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import type { StrategistSessionConfig } from '@/utils/types';
import { type ProductionOption, type RunControlFormState, uint32Max, validateControlledSeedInputs, validateRunControls } from '@/utils/config-dialog-utils';

type SelectOption<T> = { label: string; value: T };

const props = defineProps<{ modelValue: RunControlFormState; repetition?: StrategistSessionConfig['repetition'] }>();
const emit = defineEmits<{
  'update:modelValue': [value: RunControlFormState];
  'update:repetition': [value: StrategistSessionConfig['repetition']];
}>();

const expanded = ref(false);
const productionOptions: SelectOption<ProductionOption>[] = [
  { label: 'Default', value: 'default' },
  { label: 'Test', value: 'test' },
  { label: 'Livestream', value: 'livestream' },
  { label: 'Recording', value: 'recording' }
];

/** Create a writable field backed by the immutable form-state model. */
function stateField<K extends keyof RunControlFormState>(key: K) {
  return computed<RunControlFormState[K]>({
    get: () => props.modelValue[key],
    set: value => emit('update:modelValue', { ...props.modelValue, [key]: value })
  });
}

const production = stateField('production');
const seatingCycleSeed = stateField('seatingCycleSeed');
const mapSeedsInput = stateField('mapSeedsInput');
const gameSeedsInput = stateField('gameSeedsInput');
const validationError = computed(() => validateRunControls(props.modelValue));
const seatingCycleSeedError = computed(() => {
  const value = props.modelValue.seatingCycleSeed;
  return value == null || !Number.isInteger(value) || value < -1 || value > uint32Max
    ? 'Seating cycle seed must be -1 or a uint32 integer.'
    : null;
});
const seedValidationError = computed(() => validateControlledSeedInputs(props.modelValue.mapSeedsInput, props.modelValue.gameSeedsInput));
const seatingCycleSeedSuffix = computed(() => seatingCycleSeed.value === -1 ? ' (disabled)' : ' (enabled)');
const isRepetitionAuto = computed<boolean>({
  get: () => props.repetition === 'auto',
  set: value => emit('update:repetition', value ? 'auto' : undefined)
});
const repetitionValue = computed<number | null>({
  get: () => typeof props.repetition === 'number' ? props.repetition : null,
  set: value => emit('update:repetition', value ?? undefined)
});

/** Toggle the advanced controls disclosure. */
function toggleExpanded(): void {
  expanded.value = !expanded.value;
}
</script>

<template>
  <Card class="config-section run-controls-section" :class="{ collapsed: !expanded }">
    <template #title>
      <div class="run-controls-header" role="button" tabindex="0" :aria-expanded="expanded"
        v-tooltip="expanded ? 'Collapse run controls' : 'Expand run controls'" @click="toggleExpanded"
        @keydown.enter.prevent="toggleExpanded" @keydown.space.prevent="toggleExpanded">
        <span class="run-controls-title">
          <i class="pi pi-sliders-h" /><span>Run Controls</span>
          <span v-if="validationError" class="run-control-badge">Invalid</span>
        </span>
        <i :class="[expanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down', 'run-controls-chevron']" />
      </div>
    </template>
    <template #content>
      <div v-if="expanded" class="run-controls-grid">
        <div class="detail-field production-field">
          <label for="productionMode">Production</label>
          <Dropdown id="productionMode" v-model="production" :options="productionOptions" optionLabel="label" optionValue="value" class="detail-input" />
        </div>
        <div class="detail-field compact-number-field seating-field">
          <label for="seatingCycleSeed">Seating cycle seed</label>
          <InputNumber id="seatingCycleSeed" v-model="seatingCycleSeed" :min="-1" :max="uint32Max" :suffix="seatingCycleSeedSuffix" showButtons class="detail-input" />
        </div>
        <div class="repetition-group">
          <div class="detail-field compact-number-field repetition-field">
            <label for="repetition">Repetitions</label>
            <InputNumber id="repetition" v-model="repetitionValue" :min="1" :max="100" :disabled="isRepetitionAuto" placeholder="# repeated games" class="detail-input" />
          </div>
          <div class="checkbox-wrapper run-auto-control">
            <Checkbox id="repetitionAuto" v-model="isRepetitionAuto" :binary="true" />
            <label for="repetitionAuto" class="checkbox-label">Auto repetition</label>
          </div>
        </div>
        <div class="detail-field map-seed-field">
          <label for="mapSeeds">Map seeds</label>
          <InputText id="mapSeeds" v-model="mapSeedsInput" placeholder="1, 2, 3" class="detail-input" />
        </div>
        <div class="detail-field game-seed-field">
          <label for="gameSeeds">Game seeds</label>
          <InputText id="gameSeeds" v-model="gameSeedsInput" placeholder="1, 2, 3" class="detail-input" />
        </div>
        <small v-if="seatingCycleSeedError" class="field-error run-control-error">{{ seatingCycleSeedError }}</small>
        <small v-else-if="seedValidationError" class="field-error run-control-error">{{ seedValidationError }}</small>
      </div>
    </template>
  </Card>
</template>

<style scoped>
.run-controls-section.collapsed :deep(.p-card-content) { display: none; }
.run-controls-section :deep(.p-card-title) { width: 100%; }
.run-controls-header { align-items: center; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; margin: -0.25rem; padding: 0.25rem; width: calc(100% + 0.5rem); }
.run-controls-header:hover { background: var(--p-content-hover-background); }
.run-controls-header:focus-visible { outline: 2px solid var(--p-primary-color); outline-offset: 2px; }
.run-controls-title { align-items: center; display: flex; gap: 0.5rem; min-width: 0; }
.run-controls-chevron { color: var(--p-primary-color); font-size: 0.9rem; margin-left: auto; }
.run-control-badge { background: var(--p-red-500); border-radius: 4px; color: var(--p-primary-contrast-color); font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.35rem; }
.run-controls-grid { align-items: end; display: grid; gap: 0.7rem 0.85rem; grid-template-areas: "production seating repetition" "map map game" "error error error"; grid-template-columns: minmax(14rem, 1.4fr) 13rem minmax(16rem, 1fr); }
.production-field { grid-area: production; }
.seating-field { grid-area: seating; }
.repetition-group { align-items: end; display: flex; gap: 0.75rem; grid-area: repetition; min-width: 0; }
.repetition-field { flex: 0 0 8rem; }
.run-auto-control { flex: 1; padding-bottom: 0.35rem; }
.compact-number-field :deep(.p-inputnumber-input) { width: 4.5rem; }
.seating-field :deep(.p-inputnumber-input) { width: 8.5rem; }
.map-seed-field { grid-area: map; }
.game-seed-field { grid-area: game; }
.field-error { color: var(--p-red-500); font-size: 0.8rem; }
.run-control-error { grid-area: error; }
.detail-field { display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
.detail-field label { color: var(--p-text-color); font-weight: 500; }
.detail-input { width: 100%; }

@media (max-width: 760px) {
  .run-controls-grid { grid-template-areas: "production" "seating" "repetition" "map" "game" "error"; grid-template-columns: 1fr; }
  .repetition-group { align-items: stretch; flex-direction: column; }
}
</style>
