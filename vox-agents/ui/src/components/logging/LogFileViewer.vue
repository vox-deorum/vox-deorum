<template>
  <div class="log-pane">
    <div class="log-toolbar">
      <Select
        v-model="selectedFile"
        :options="files"
        optionLabel="name"
        optionValue="name"
        placeholder="No files"
        :disabled="files.length === 0"
        size="small"
        class="file-select"
      >
        <template #option="{ option }">
          <div class="file-option">
            <span>{{ option.name }}</span>
            <span class="text-muted text-small">{{ formatAge(option.modified) }} · {{ formatFileSize(option.size) }}</span>
          </div>
        </template>
      </Select>
      <SelectButton
        v-if="isStructured"
        v-model="selectedLevel"
        :options="levelOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        size="small"
      />
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText v-model="query" placeholder="Search" size="small" class="search-input" />
      </IconField>
      <span class="toolbar-spacer"></span>
      <span
        v-if="file?.truncated"
        class="text-muted text-small"
        v-tooltip.bottom="'Download all to get the full file'"
      >Last 512 KB of {{ formatFileSize(file.size) }}</span>
      <Button
        icon="pi pi-refresh"
        :loading="loading"
        @click="refresh"
        v-tooltip.bottom="'Refresh'"
        severity="secondary"
        text
        size="small"
      />
    </div>

    <LogTable
      v-if="isStructured || !file"
      ref="table"
      :entries="structuredEntries"
      :emptyText="emptyText"
      :emptyHint="files.length === 0 ? emptyHint : undefined"
    />

    <div v-else-if="textLines.length === 0" class="log-table-empty table-empty">
      <i class="pi pi-inbox"></i>
      <p>{{ emptyText }}</p>
    </div>

    <VList v-else ref="textList" :data="textLines" class="text-log" #default="{ item, index }">
      <div :key="index" class="text-line" :class="{ error: errorPattern.test(item) }">{{ item }}</div>
    </VList>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useToast } from 'primevue/usetoast';
import { VList } from 'virtua/vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import { api } from '@/api/client';
import { extractLogParams, filterLogs, levelOptions, logMatchesQuery } from '@/api/log-utils';
import { formatFileSize } from '@/api/telemetry-utils';
import type { DebugLogFile, DebugLogFileResponse, DebugLogSource, LogEntry } from '@/utils/types';
import { errorMessage } from '@/utils/errors';
import LogTable from './LogTable.vue';

const props = defineProps<{
  source: DebugLogSource;
  files: DebugLogFile[];
  /** File to open first when it exists, such as Lua.log. Otherwise the newest non-error log opens. */
  preferredFile?: string;
  /** Shown under the empty state when the folder has no logs yet. */
  emptyHint?: string;
}>();

const emit = defineEmits<{ refresh: [] }>();

const toast = useToast();
const selectedFile = ref<string>();
const selectedLevel = ref<LogEntry['level']>('info');
const query = ref('');
const file = ref<DebugLogFileResponse>();
const loading = ref(false);
const table = ref<InstanceType<typeof LogTable>>();
const textList = ref<InstanceType<typeof VList>>();

/** Lines that read like failures in plain-text logs such as Lua.log. */
const errorPattern = /\berror\b|exception|traceback/i;

/** Parse each line as a JSON log entry, or return undefined when the file is plain text. */
const parsedEntries = computed<LogEntry[] | undefined>(() => {
  const lines = (file.value?.content ?? '').split(/\r?\n/).filter(line => line.trim());
  const entries: LogEntry[] = [];
  for (const line of lines) {
    if (!line.startsWith('{')) return undefined;
    try {
      entries.push(extractLogParams(JSON.parse(line)));
    } catch {
      return undefined;
    }
  }
  return entries;
});

const isStructured = computed(() => parsedEntries.value !== undefined && parsedEntries.value.length > 0);

const structuredEntries = computed(() => {
  const search = query.value.trim().toLowerCase();
  return filterLogs(parsedEntries.value ?? [], selectedLevel.value, [])
    .filter(entry => logMatchesQuery(entry, search));
});

const textLines = computed(() => {
  const search = query.value.trim().toLowerCase();
  const lines = (file.value?.content ?? '').split(/\r?\n/).filter(line => line.length > 0);
  return search ? lines.filter(line => line.toLowerCase().includes(search)) : lines;
});

const emptyText = computed(() => {
  if (props.files.length === 0) return 'No log files yet';
  if (loading.value && !file.value) return 'Loading...';
  return query.value ? 'Nothing matches your search' : 'Nothing to show at this level';
});

/** Keep the current choice if it still exists, else open the preferred file or the newest non-error log. */
function pickFile() {
  const names = props.files.map(entry => entry.name);
  if (selectedFile.value && names.includes(selectedFile.value)) return;
  if (props.preferredFile && names.includes(props.preferredFile)) {
    selectedFile.value = props.preferredFile;
    return;
  }
  // Files arrive newest first, and rotated service logs put the active file at the highest number.
  selectedFile.value = names.find(name => !name.toLowerCase().startsWith('error')) ?? names[0];
}

/** Describe how long ago a file was written, for example "5 min ago". */
function formatAge(modified: string): string {
  const minutes = Math.round((Date.now() - new Date(modified).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Counts file loads so a slow response for a file no longer selected is dropped. */
let loadGeneration = 0;

/** Load the selected file and jump to its newest lines. */
async function loadFile() {
  const generation = ++loadGeneration;
  if (!selectedFile.value) {
    file.value = undefined;
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const response = await api.getLogFile(props.source, selectedFile.value);
    if (generation !== loadGeneration) return;
    file.value = response;
    await nextTick();
    requestAnimationFrame(() => {
      if (isStructured.value) table.value?.scrollToIndex(structuredEntries.value.length - 1);
      else textList.value?.scrollToIndex(textLines.value.length - 1);
    });
  } catch (error) {
    if (generation !== loadGeneration) return;
    toast.add({ severity: 'error', summary: 'Could not read log', detail: errorMessage(error), life: 5000 });
  } finally {
    if (generation === loadGeneration) loading.value = false;
  }
}

/** Reload the folder listing and the open file. */
function refresh() {
  emit('refresh');
  void loadFile();
}

watch(() => props.files, pickFile, { immediate: true });
watch(selectedFile, () => void loadFile(), { immediate: true });
</script>

<style scoped>
.file-select {
  min-width: 13rem;
}

.file-option {
  display: flex;
  justify-content: space-between;
  gap: 1.5rem;
  width: 100%;
}

.search-input {
  width: 12rem;
}

.log-table-empty {
  flex: 1;
  gap: 0.5rem;
  border-top: 1px solid var(--p-content-border-color);
}

.log-table-empty .pi {
  font-size: 1.75rem;
}

.text-log {
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--p-content-border-color);
  padding: 0.25rem 0;
}

.text-line {
  padding: 0.0625rem 0.75rem;
  font-family: Consolas, 'Cascadia Mono', Menlo, monospace;
  font-size: 0.8125rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.text-line:hover {
  background: var(--p-content-hover-background);
}

.text-line.error {
  color: var(--p-red-500);
}
</style>
