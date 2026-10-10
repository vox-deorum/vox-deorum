<!--
Component: DeleteSessionDialog
Purpose: Reusable delete confirmation dialog for chat sessions
-->
<template>
  <Dialog
    v-model:visible="visible"
    header="Confirm Delete"
    :style="{ width: '450px' }"
    modal
  >
    <p>{{ message }}</p>
    <template #footer>
      <Button
        label="Cancel"
        text
        @click="handleCancel"
      />
      <Button
        label="Delete"
        severity="danger"
        :loading="isDeleting"
        @click="handleDelete"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import { useToast } from 'primevue/usetoast';
import { api } from '@/api/client';
import type { EnvoyThread } from '@/utils/types';
import { errorMessage } from '@/utils/errors';

// Props
const props = withDefaults(defineProps<{
  modelValue: boolean;
  session: EnvoyThread | null;
  redirectAfterDelete?: boolean;
}>(), {
  redirectAfterDelete: false
});

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'deleted': [sessionId: string];
}>();

// Composables
const router = useRouter();
const toast = useToast();

// State
const isDeleting = ref(false);

// Computed
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
});

const message = computed(() => {
  const sessionName = props.session?.title || props.session?.id || 'this chat thread';
  return `Are you sure you want to delete the chat thread "${sessionName}"?`;
});

// Methods
const handleCancel = () => {
  visible.value = false;
};

const handleDelete = async () => {
  if (!props.session) {
    return;
  }

  isDeleting.value = true;

  try {
    await api.deleteAgentChat(props.session.id);

    toast.add({
      severity: 'success',
      summary: 'Success',
      detail: 'Chat thread deleted',
      life: 3000
    });

    emit('deleted', props.session.id);
    visible.value = false;

    if (props.redirectAfterDelete) {
      router.push('/chat');
    }
  } catch (error) {
    console.error('Failed to delete session:', error);

    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: errorMessage(error, 'Failed to delete session'),
      life: 3000
    });
  } finally {
    isDeleting.value = false;
  }
};
</script>
