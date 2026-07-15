<template>
  <component :is="() => renderValue(params)" />
</template>

<script setup lang="ts">
import { h, type VNode } from 'vue';

type DisplayPrimitive = string | number | boolean | null | undefined;
type DisplayValue = DisplayPrimitive | DisplayValue[] | DisplayObject;

interface DisplayObject {
  [key: string]: DisplayValue;
}

interface Props {
  params: DisplayValue;
}

const props = defineProps<Props>();

/** Render a log parameter value recursively with syntax-aware styling. */
const renderValue = (value: DisplayValue): VNode => {
  // Handle null/undefined
  if (value === null) return h('span', { class: 'param-null' }, 'null');
  if (value === undefined) return h('span', { class: 'param-undefined' }, 'undefined');

  // Handle primitives
  if (typeof value === 'string') return h('span', { class: 'param-string' }, `"${value}"`);
  if (typeof value === 'number') return h('span', { class: 'param-number' }, value);
  if (typeof value === 'boolean') return h('span', { class: 'param-boolean' }, value ? 'true' : 'false');

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return h('span', { class: 'param-empty' }, '[]');

    return h('ul', { class: 'param-array' },
      value.map((item, index) =>
        h('li', { key: index },
          [
            h('span', { class: 'param-key' }, `[${index}]: `),
            renderValue(item)
          ]
        )
      )
    );
  }

  // Handle objects. All remaining values are objects after the exhaustive primitive checks.
  const entries = Object.entries(value);
  if (entries.length === 0) return h('span', { class: 'param-empty' }, '{}');

  return h('ul', { class: 'param-object' },
    entries.map(([k, v]) =>
      h('li', { key: k },
        [
          h('span', { class: 'param-key' }, `${k}: `),
          renderValue(v)
        ]
      )
    )
  );
};
</script>

<style scoped>
ul {
  margin: 0 0 0 1rem;
  padding: 0;
  list-style: disc;
}

ul.param-array {
  list-style: circle;
}

li {
  margin: 0.125rem 0;
  line-height: 1.4;
}

.param-key {
  color: var(--p-text-color);
  font-weight: 600;
}

.param-string {
  color: var(--p-green-600);
}

.param-number {
  color: var(--p-blue-600);
}

.param-boolean {
  color: var(--p-orange-600);
  font-weight: 600;
}

.param-null, .param-undefined {
  color: var(--p-gray-500);
  font-style: italic;
}

.param-empty {
  color: var(--p-gray-500);
}

</style>
