<template>
  <div class="message-content" v-html="html"></div>
</template>

<script setup lang="ts">
/**
 * MarkdownText - Render a markdown string as sanitized HTML, styled by `.message-content`.
 */
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  breaks: true,
  gfm: true,
});

const props = defineProps<{ content: string }>();

// Parse markdown and sanitize the HTML
const html = computed(() => DOMPurify.sanitize(marked(props.content) as string));
</script>
