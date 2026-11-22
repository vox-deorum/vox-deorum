<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from 'primevue/button';
import InputNumber from 'primevue/inputnumber';
import MultiSelect from 'primevue/multiselect';
import ProgressBar from 'primevue/progressbar';
import ModelDiscoveryDialog from '@/components/config/ModelDiscoveryDialog.vue';
import type { DeskJob, DiscoveredModel } from '@/utils/types';
import { deskChoicesLimit } from '@vox/newspaper/desk/batch.js';

const props = defineProps<{
  checked: number;
  requestCount: number;
  availableModels: string[];
  job: DeskJob | null;
  busy: boolean;
  starting: boolean;
  stopping: boolean;
  clearing: boolean;
  candidateCount: number;
  saving: boolean;
}>();
const choices = defineModel<number | null>('choices', { required: true });
const models = defineModel<string[]>('models', { required: true });
const emit = defineEmits<{ generate: []; stop: []; clear: []; addModel: [id: string] }>();
const modelField = ref<InstanceType<typeof MultiSelect>>();
const discoveryVisible = ref(false);

/** Close the model dropdown and open the full service picker. */
function browseModels() {
  modelField.value?.hide();
  discoveryVisible.value = true;
}

/** Add the chosen provider model to the desk's list and select it. */
function addModel(model: DiscoveredModel) {
  emit('addModel', model.id);
}

/** Restore focus to the model field after the dialog closes. */
function focusModels() {
  document.getElementById('desk-models')?.focus();
}

const completed = computed(() => props.job?.done ?? 0);
const progress = computed(() => props.job?.total ? Math.min(100, 100 * completed.value / props.job.total) : 0);
const progressLabel = computed(() => {
  const job = props.job;
  if (!job) return '';
  return [
    completed.value + ' of ' + job.total + ' requests · ' + job.failed + ' failed',
    job.tokens.input.toLocaleString() + ' input / ' + job.tokens.output.toLocaleString() + ' output tokens',
    ...job.errors.map(error => error.model + ': ' + error.message),
  ].join('\n');
});
</script>

<template>
  <div class="panel-toolbar desk-toolbar desk-batch" role="group" aria-label="Draft batch">
    <span class="desk-checked text-muted">{{ checked }} checked</span>
    <div class="desk-batch-models">
      <InputNumber v-model="choices" input-id="desk-choices" size="small" :min="1" :max="deskChoicesLimit"
        :disabled="busy" :use-grouping="false" :input-style="{ width: '3rem', textAlign: 'center' }"
        :pt="{ pcInputText: { root: { 'aria-label': 'Choices per model' } } }" title="Choices per model" />
      <span class="text-muted" aria-hidden="true">×</span>
      <MultiSelect ref="modelField" v-model="models" input-id="desk-models" :options="availableModels" display="chip" size="small"
        placeholder="Choose models" aria-label="Models" :disabled="busy" :show-toggle-all="false" filter auto-filter-focus>
        <template #footer>
          <Button label="More models…" icon="pi pi-plus" severity="secondary" text size="small"
            class="w-full" @click="browseModels" />
        </template>
      </MultiSelect>
      <ModelDiscoveryDialog v-model:visible="discoveryVisible" saved-connection @select="addModel" @after-hide="focusModels" />
    </div>
    <span v-if="!busy && requestCount" class="text-small text-muted" role="status">
      {{ requestCount }} {{ requestCount === 1 ? 'request' : 'requests' }}
    </span>
    <span class="toolbar-spacer" aria-hidden="true" />
    <div v-if="job" class="desk-batch-progress" :title="progressLabel">
      <span class="text-muted">{{ completed }}/{{ job.total }} requests<span v-if="job.status === 'stopped'"> · stopped</span></span>
      <ProgressBar :value="progress" :show-value="false" :aria-label="progressLabel" />
    </div>
    <Button v-if="candidateCount || clearing" label="Clear drafts" icon="pi pi-trash" size="small" severity="secondary"
      outlined :disabled="busy || saving" :loading="clearing" :title="job?.status === 'running' ? 'Stop the batch before clearing drafts' : undefined"
      @click="emit('clear')" />
    <Button label="Generate" icon="pi pi-sparkles" size="small" :loading="starting"
      :disabled="busy || !requestCount || !choices" @click="emit('generate')" />
    <Button v-if="job?.status === 'running'" label="Stop" icon="pi pi-stop" size="small" severity="secondary"
      outlined :loading="stopping" @click="emit('stop')" />
  </div>
</template>
