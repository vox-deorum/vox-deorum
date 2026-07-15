<script setup lang="ts">
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import SpanViewer from './SpanViewer.vue';
import type { Span } from '@/utils/types';

interface Props {
  title: string;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  spans: Span[];
  rootSpan: Span | null;
  emptyMessage?: string;
  showEmptyState?: boolean;
  retainContentWhileLoading?: boolean;
  isStreaming?: boolean;
}

defineProps<Props>();
defineEmits<{ back: [] }>();
</script>

<template>
  <div class="telemetry-span-page">
    <div class="page-header">
      <div class="page-header-left">
        <Button icon="pi pi-arrow-left" text rounded @click="$emit('back')" />
        <h1>{{ title }}</h1>
        <slot name="status" />
      </div>
      <div class="page-header-controls">
        <slot name="controls" />
      </div>
    </div>

    <div v-if="loading && (!retainContentWhileLoading || !spans.length)" class="loading-container">
      <ProgressSpinner />
      <p>{{ loadingMessage }}</p>
    </div>

    <div v-else-if="error" class="error-container">
      <i class="pi pi-exclamation-triangle"></i>
      <p>{{ error }}</p>
      <Button label="Go Back" @click="$emit('back')" />
    </div>

    <div v-else-if="showEmptyState && spans.length === 0" class="empty-state">
      <i class="pi pi-inbox"></i>
      <p>{{ emptyMessage }}</p>
      <Button label="Go Back" @click="$emit('back')" />
    </div>

    <SpanViewer
      v-else-if="rootSpan"
      :spans="spans"
      :root-span="rootSpan"
      :is-streaming="isStreaming"
    />
  </div>
</template>
