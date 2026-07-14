<script setup lang="ts">
import AutoComplete from 'primevue/autocomplete';
import Select from 'primevue/select';
import type { AgentInfo } from '@/utils/types';
import type { PlayerOption } from './types';

defineProps<{
  initiator: PlayerOption | null;
  initiatorOptions: PlayerOption[];
  role: string;
  suggestions: string[];
  voice: AgentInfo | null;
  voiceOptions: AgentInfo[];
  playersLoading: boolean;
}>();

defineEmits<{
  'update:initiator': [value: PlayerOption | null];
  'update:role': [value: string];
  'update:voice': [value: AgentInfo | null];
  'search-roles': [event: { query: string }];
}>();
</script>

<template>
  <div class="chat-launch-identity-step">
    <div class="chat-launch-identity-form">
      <label for="dipl-initiator">Speaking as (your seat)</label>
      <Select id="dipl-initiator" :modelValue="initiator" :options="initiatorOptions" optionLabel="label"
        placeholder="Select your seat..." :loading="playersLoading"
        @update:modelValue="$emit('update:initiator', $event)" />
      <label for="dipl-role">Your role</label>
      <AutoComplete id="dipl-role" :modelValue="role" :suggestions="suggestions"
        placeholder="e.g., the leader, a diplomat..." :dropdown="true"
        @update:modelValue="$emit('update:role', $event)" @complete="$emit('search-roles', $event)" />
      <label for="dipl-voice">Voice (defaults to the target seat's diplomat)</label>
      <Select id="dipl-voice" :modelValue="voice" :options="voiceOptions" optionLabel="name"
        placeholder="Use the configured diplomat" showClear @update:modelValue="$emit('update:voice', $event)" />
    </div>
  </div>
</template>
