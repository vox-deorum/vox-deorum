import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import type { CreateChatRequest } from '@/utils/types';

/** Centralize chat creation, navigation, error state, and dialog cleanup. */
export function useChatLauncher(onComplete: () => void) {
  const router = useRouter();
  const isCreatingSession = ref(false);
  const launchError = ref<string | null>(null);

  /** Create a chat session, navigate to it, and reset the calling dialog. */
  async function launchChat(request: CreateChatRequest, fallbackMessage: string): Promise<void> {
    isCreatingSession.value = true;
    launchError.value = null;
    try {
      const session = await api.createAgentChat(request);
      await router.push({ name: 'chat-detail', params: { sessionId: session.id } });
      onComplete();
    } catch (error) {
      launchError.value = error instanceof Error ? error.message : fallbackMessage;
    } finally {
      isCreatingSession.value = false;
    }
  }

  /** Clear an error before a new selection or mode is shown. */
  function clearLaunchError(): void {
    launchError.value = null;
  }

  return { isCreatingSession, launchError, launchChat, clearLaunchError };
}
