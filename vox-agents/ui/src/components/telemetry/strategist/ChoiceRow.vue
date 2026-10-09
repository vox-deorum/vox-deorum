<template>
  <div class="decision-row" :class="stateClass(item)" v-tooltip.top="answerTooltip(item)">
    <span class="decision-name">{{ item.label }}</span>
    <DecisionValue :item="item" />
    <DecisionConfidence :confidence="item.answer?.confidence" />
    <div v-if="probabilities.length" class="decision-probs">
      <span v-for="p in probabilities" :key="p.option" :class="{ picked: p.option === item.answer?.choice }">
        <i :style="{ width: `${Math.max(2, p.probability * 40)}px` }"></i>{{ p.option }} {{ Math.round(p.probability * 100) }}%
      </span>
    </div>
    <MarkdownText v-if="rationale" class="decision-why" :content="rationale" />
  </div>
</template>

<script setup lang="ts">
/**
 * ChoiceRow - One named choice (grand strategy, research, policy) with its change, the
 * evaluator's option probabilities, and the rationale.
 */
import { computed } from 'vue';
import MarkdownText from '../../shared/MarkdownText.vue';
import DecisionValue from './DecisionValue.vue';
import DecisionConfidence from './DecisionConfidence.vue';
import { answerTooltip, stateClass, type DecisionItem } from '@/api/strategist-turn';

const props = defineProps<{ item: DecisionItem; rationale?: string }>();

// Choice options worth showing inline, highest first
const probabilities = computed(() => props.item.answer?.type === 'choice'
  ? props.item.answer.probabilities.filter(p => p.probability >= 0.01)
  : []);
</script>
