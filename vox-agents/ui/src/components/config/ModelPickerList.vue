<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import InputText from 'primevue/inputtext';
import type { DiscoveredModel } from '@/utils/types';

interface Props {
  models: DiscoveredModel[];
  /** Radio group name, unique per picker when several render at once. */
  name?: string;
  /** Model marked as the service's recommendation. */
  recommendedId?: string;
}

const props = withDefaults(defineProps<Props>(), { name: 'setup-model', recommendedId: '' });
const selected = defineModel<string>({ required: true });
const filter = ref('');

/** Filter the supplied models by their stable identifier or display name. */
const filteredModels = computed(() => {
  const query = filter.value.trim().toLowerCase();
  if (!query) return props.models;
  return props.models.filter(model =>
    model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query)
  );
});

/** Clear the previous search whenever the available models are replaced. */
watch(
  () => props.models,
  () => {
    filter.value = '';
  }
);
</script>

<template>
  <div class="setup-wizard-field">
    <InputText :id="`${name}-filter`" v-model="filter" placeholder="Search by AI model name" />
  </div>
  <div class="setup-wizard-model-list" role="radiogroup" aria-label="Available AIs">
    <label v-for="model in filteredModels" :key="model.id" class="setup-wizard-model">
      <input v-model="selected" type="radio" :name="name" :value="model.id" />
      <span><strong>{{ model.id }}</strong><small>{{ model.name }}</small></span>
      <span v-if="model.id === recommendedId" class="setup-wizard-badge">Recommended</span>
    </label>
    <div v-if="filteredModels.length === 0" class="setup-wizard-empty" aria-live="polite">
      {{ filter.trim() ? 'No AIs match that filter.' : 'No AIs were found for this service.' }}
    </div>
  </div>
</template>
