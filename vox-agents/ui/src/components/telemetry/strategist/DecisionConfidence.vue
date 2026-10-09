<template>
  <span class="decision-confidence" :class="{ low: confidence !== undefined && confidence < 0.5 }">
    {{ confidence === undefined ? '' : `${Math.round(confidence * 100)}%` }}
  </span>
</template>

<script setup lang="ts">
/**
 * DecisionConfidence - The evaluator's confidence in an answer, highlighted below 50%.
 */
defineProps<{ confidence?: number }>();
</script>
