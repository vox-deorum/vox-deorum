<template>
  <aside class="turn-meta">
    <dl>
      <template v-for="[label, value] in general" :key="label">
        <dt>{{ label }}</dt><dd>{{ value }}</dd>
      </template>
    </dl>

    <h4>Model</h4>
    <dl>
      <template v-for="[label, value] in model" :key="label">
        <dt>{{ label }}</dt><dd>{{ value }}</dd>
      </template>
    </dl>

    <h4>Pacing</h4>
    <dl>
      <template v-for="[label, value] in pacing" :key="label">
        <dt>{{ label }}</dt><dd>{{ value }}</dd>
      </template>
    </dl>

    <template v-if="turn.steps.length">
      <h4>Steps</h4>
      <dl>
        <template v-for="step in turn.steps" :key="step.number">
          <dt>{{ step.number }}</dt>
          <dd>{{ step.tools.length }} {{ step.tools.length === 1 ? 'call' : 'calls' }} · {{ formatDuration(step.durationMs) }}</dd>
          <MarkdownText v-if="step.reasoning" class="step-reasoning" :content="step.reasoning" />
        </template>
      </dl>
    </template>
  </aside>
</template>

<script setup lang="ts">
/**
 * TurnMetaSidebar - The strategist turn's metadata in a compact column: status and timing, the
 * model and tokens, the pacing state, and the LLM's steps.
 */
import { computed } from 'vue';
import MarkdownText from '../../shared/MarkdownText.vue';
import { formatDuration, formatTimestamp, formatTokenCount, getStatusText } from '@/api/telemetry-utils';
import type { StrategistTurn } from '@/api/strategist-turn';

const props = defineProps<{ turn: StrategistTurn; spanCount: number }>();

type Row = [string, string | number];

const rootAttrs = computed(() => props.turn.root.attributes as Record<string, unknown>);
const agentAttrs = computed(() => (props.turn.agent?.attributes ?? {}) as Record<string, unknown>);

/** Read a numeric attribute, or undefined when it is missing. */
function num(value: unknown): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : Number(value);
}

/** Drop rows whose value is missing. */
function present(rows: (Row | undefined)[]): Row[] {
  return rows.filter((r): r is Row => !!r && r[1] !== undefined && r[1] !== '');
}

const general = computed(() => present([
  ['Status', getStatusText(props.turn.root.statusCode)],
  props.turn.root.statusMessage ? ['Message', props.turn.root.statusMessage] : undefined,
  ['Duration', formatDuration(props.turn.root.durationMs)],
  ['Started', formatTimestamp(props.turn.root.startTime)],
  ['Spans', props.spanCount],
]));

const model = computed(() => {
  const a = rootAttrs.value, agent = agentAttrs.value, evaluation = props.turn.evaluation;
  return present([
    ['Type', String(a['strategist.type'] ?? '')],
    ['Model', String(agent.model ?? '')],
    agent['triage.baseline'] ? ['Triage', String(agent['triage.baseline'])] : undefined,
    ['Input', formatTokenCount(num(a['tokens.input']))],
    num(agent['tokens.input.cached']) ? ['Cached', formatTokenCount(num(agent['tokens.input.cached']))] : undefined,
    ['Reasoning', formatTokenCount(num(a['tokens.reasoning']))],
    ['Output', formatTokenCount(num(a['tokens.output']))],
    evaluation ? ['State', formatTokenCount(evaluation.stateTokens)] : undefined,
    evaluation ? ['Questions', evaluation.questions] : undefined,
    evaluation ? ['Deadband', evaluation.deadband ?? 'default'] : undefined,
  ]);
});

const pacing = computed(() => {
  const a = rootAttrs.value;
  const from = a.event_from, to = a.event_to;
  return present([
    ['Every', String(a['pacing.every_turns'] ?? '')],
    ['Interruption', String(a['pacing.interruption'] ?? '')],
    ['Last decision', a['pacing.last_decision_turn'] ? `T${a['pacing.last_decision_turn']}` : '-'],
    from !== undefined ? ['Events', from === to ? `T${from}` : `T${from}-${to}`] : undefined,
    num(a.event_dropped_tiers) ? ['Dropped tiers', String(a.event_dropped_tiers)] : undefined,
    num(a['deliberation.ms']) ? ['Deliberation', formatDuration(num(a['deliberation.ms'])!)] : undefined,
  ]);
});
</script>
