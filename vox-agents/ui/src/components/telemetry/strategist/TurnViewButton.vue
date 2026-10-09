<template>
  <Button
    icon="pi pi-sliders-h"
    text
    rounded
    size="small"
    :loading="loading"
    v-tooltip="'Strategist turn view'"
  />
</template>

<script setup lang="ts">
/**
 * TurnViewButton - The icon that marks a span with a strategist turn view and opens it.
 */
import Button from 'primevue/button';

defineProps<{ loading?: boolean }>();
</script>
