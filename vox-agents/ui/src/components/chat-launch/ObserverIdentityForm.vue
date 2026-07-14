<script setup lang="ts">
import AutoComplete from 'primevue/autocomplete';
import Select from 'primevue/select';
import type { PlayerOption } from './types';

defineProps<{
  role: string;
  suggestions: string[];
  player: PlayerOption | null;
  playerOptions: PlayerOption[];
  playersLoading: boolean;
}>();

defineEmits<{
  'update:role': [value: string];
  'update:player': [value: PlayerOption | null];
  'search-roles': [event: { query: string }];
}>();
</script>

<template>
  <div class="chat-launch-identity-step">
    <div class="chat-launch-identity-form">
      <label for="user-role">Your Role</label>
      <AutoComplete id="user-role" :modelValue="role" :suggestions="suggestions"
        placeholder="e.g., a diplomat, the leader, a military general..." :dropdown="true"
        @update:modelValue="$emit('update:role', $event)" @complete="$emit('search-roles', $event)" />
      <label for="user-player">Representing</label>
      <Select id="user-player" :modelValue="player" :options="playerOptions" optionLabel="label"
        placeholder="Select a player or observer..." :loading="playersLoading"
        @update:modelValue="$emit('update:player', $event)" />
    </div>
  </div>
</template>
