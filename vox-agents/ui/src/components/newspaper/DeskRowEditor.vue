<script setup lang="ts">
import { nextTick, ref } from 'vue';
import Textarea from 'primevue/textarea';
import type { DeskText, DeskVariable } from '@/utils/types';

const props = defineProps<{ variables: DeskVariable[]; disabled: boolean; subheadline: boolean; byline: boolean }>();
const text = defineModel<DeskText>({ required: true });

type Field = 'headline' | 'subheadline' | 'byline' | number;
/** Remember the last textarea even after focus moves to a variable chip. */
let active: { field: Field; area: HTMLTextAreaElement } | undefined;
const editor = ref<HTMLElement>();

/** Read or replace a single field without mutating the incoming draft. */
function setField(field: Field, value: string) {
  if (typeof field === 'number') {
    const body = [...text.value.body];
    body[field] = value;
    text.value = { ...text.value, body };
  } else {
    text.value = { ...text.value, [field]: value };
  }
}

/** Retain the actual textarea and its current cursor location. */
function focusField(field: Field, event: FocusEvent) {
  if (event.target instanceof HTMLTextAreaElement) active = { field, area: event.target };
}

/** Insert the complete placeholder into the selection, then restore the cursor. */
async function insert(variable: DeskVariable) {
  if (props.disabled) return;
  const target = active ?? {
    field: 'headline' as const,
    area: editor.value?.querySelector('textarea'),
  };
  if (!target.area) return;
  const { area, field } = target;
  const value = typeof field === 'number' ? (text.value.body[field] ?? '') : (text.value[field] ?? '');
  const end = active ? area.selectionEnd : value.length;
  const start = active ? area.selectionStart : end;
  const placeholder = '{{' + variable.name + '}}';
  setField(field, value.slice(0, start) + placeholder + value.slice(end));
  await nextTick();
  area.focus();
  area.setSelectionRange(start + placeholder.length, start + placeholder.length);
}
</script>

<template>
  <div ref="editor" class="desk-editor">
    <label>
      <span>Headline</span>
      <Textarea :model-value="text.headline" rows="1" auto-resize :disabled="disabled"
        @focus="focusField('headline', $event)" @update:model-value="setField('headline', $event ?? '')" />
    </label>
    <label v-if="subheadline">
      <span>Subheadline</span>
      <Textarea :model-value="text.subheadline ?? ''" rows="1" auto-resize :disabled="disabled"
        @focus="focusField('subheadline', $event)" @update:model-value="setField('subheadline', $event ?? '')" />
    </label>
    <label v-if="byline">
      <span>Byline</span>
      <Textarea :model-value="text.byline ?? ''" rows="1" auto-resize :disabled="disabled"
        @focus="focusField('byline', $event)" @update:model-value="setField('byline', $event ?? '')" />
    </label>
    <label v-for="(paragraph, index) in text.body" :key="index">
      <span>{{ text.body.length > 1 ? 'Paragraph ' + (index + 1) : 'Body' }}</span>
      <Textarea :model-value="paragraph" rows="2" auto-resize :disabled="disabled"
        @focus="focusField(index, $event)" @update:model-value="setField(index, $event ?? '')" />
    </label>
    <div v-if="variables.length" class="desk-editor-vars" aria-label="Insert a variable">
      <button v-for="variable in variables" :key="variable.name" type="button" class="desk-variable-chip"
        :data-group="variable.group" :data-empty="variable.mayBeEmpty"
        :title="variable.source + (variable.keep ? ' · keep in the copy' : '') + (variable.mayBeEmpty ? ' · may be empty' : '')"
        :disabled="disabled" @click="insert(variable)"
      >{{ variable.name }}</button>
    </div>
  </div>
</template>
