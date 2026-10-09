<template>
  <div
    class="scale-cell"
    :class="stateClass(item)"
    v-tooltip.top="answerTooltip(item)"
  >
    <div class="scale-bar">
      <div class="bar-track"></div>
      <div v-if="min < 0" class="bar-zero" :style="{ left: `${position(0)}%` }"></div>
      <div
        v-for="bar in answerHistogram(item.answer)"
        :key="bar.at"
        class="bar-hist"
        :style="{ left: `${position(bar.at)}%`, height: `${Math.max(1, bar.probability * 50)}%` }"
      ></div>
      <div
        v-if="next !== undefined && next !== current"
        class="bar-move"
        :style="{ left: `${Math.min(current, next)}%`, width: `${Math.abs(next - current)}%` }"
      ></div>
      <div class="bar-current" :style="{ left: `${current}%` }"></div>
      <div v-if="next !== undefined" class="bar-next" :style="{ left: `${next}%` }"></div>
    </div>
    <DecisionValue :item="item" />
    <DecisionConfidence :confidence="item.answer?.confidence" />
  </div>
</template>

<script setup lang="ts">
/**
 * ScaleCell - One numeric decision on a bar: the evaluator's score histogram, the current tick,
 * and the new value, followed by the values and the evaluator's confidence.
 */
import { computed } from 'vue';
import { answerHistogram, answerTooltip, stateClass, type DecisionItem } from '@/api/strategist-turn';
import DecisionValue from './DecisionValue.vue';
import DecisionConfidence from './DecisionConfidence.vue';

const props = defineProps<{ item: DecisionItem; min: number; max: number }>();

/** Position of a value along the bar, in percent. */
function position(value: number): number {
  return ((value - props.min) / (props.max - props.min)) * 100;
}

const current = computed(() => position(Number(props.item.current ?? props.min)));
const next = computed(() => props.item.next === undefined ? undefined : position(Number(props.item.next)));
</script>
