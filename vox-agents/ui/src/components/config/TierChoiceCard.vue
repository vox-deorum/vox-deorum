<script setup lang="ts">
import { computed } from 'vue';
import ModelPickerList from '@/components/config/ModelPickerList.vue';
import type { DiscoveredModel } from '@/utils/types';

/** One preset answer on a tier card. Values are model IDs or caller-defined markers. */
export interface TierOption {
  value: string;
  label: string;
  detail?: string;
  badge?: string;
}

interface Props {
  /** Radio group name, unique per card. */
  name: string;
  icon: string;
  title: string;
  /** One line telling the player what this AI is for. */
  purpose: string;
  /** Short trade-off hint shown at the bottom of the card. */
  traits: string;
  options: TierOption[];
  models: DiscoveredModel[];
}

const props = defineProps<Props>();
/** The chosen option value, or 'custom' while the player picks from the full list. */
const choice = defineModel<string>('choice', { required: true });
const customId = defineModel<string>('customId', { required: true });

/** Append the full-list option after the caller's presets. */
const allOptions = computed<TierOption[]>(() => [
  ...props.options,
  { value: 'custom', label: 'Choose a model…' }
]);
</script>

<template>
  <fieldset class="setup-tier-card">
    <legend class="setup-tier-card-title"><i :class="icon" /> {{ title }}</legend>
    <p class="setup-tier-card-purpose">{{ purpose }}</p>
    <div class="setup-tier-card-options" role="radiogroup" :aria-label="title">
      <label v-for="option in allOptions" :key="option.value" class="setup-wizard-model">
        <input v-model="choice" type="radio" :name="name" :value="option.value" />
        <span><strong>{{ option.label }}</strong><small v-if="option.detail">{{ option.detail }}</small></span>
        <span v-if="option.badge" class="setup-wizard-badge">{{ option.badge }}</span>
      </label>
    </div>
    <ModelPickerList v-if="choice === 'custom'" v-model="customId" :models="models" :name="`${name}-model`" />
    <small class="setup-tier-card-traits">{{ traits }}</small>
  </fieldset>
</template>
