<template>
  <div class="chat-messages-container">
    <div v-if="messages.length === 0" class="empty-state">
      <i class="pi pi-comments" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5"></i>
      <p>No messages yet. Start a conversation!</p>
    </div>

    <VList
      v-else
      ref="virtualScroller"
      :data="messages"
      :overscan="3"
      class="virtual-list"
      @scroll="handleScroll"
    >
      <template #default="{ item, index }">
        <DealMessageCard
          v-if="item.deal"
          :key="`deal-${item.deal.ID}`"
          :deal="item.deal"
          :you-i-d="youID ?? -1"
          :them-i-d="themID ?? -1"
          :you-label="userLabel ?? 'You'"
          :them-label="agentLabel ?? 'Them'"
          :is-active="item.deal.ID === activeDealID"
          :status="dealStatus"
          :locked="dealLocked"
          :busy="dealActionBusy"
          @accept="$emit('deal-accept', $event)"
          @reject="$emit('deal-reject', $event)"
          @counter="$emit('deal-counter', $event)"
        />
        <ChatMessage
          v-else
          :key="`${item.message.role}-${index}`"
          :message="item.message"
          :metadata="item.metadata"
          :user-label="userLabel"
          :agent-label="agentLabel"
        />
      </template>
    </VList>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import { VList } from 'virtua/vue';
import ChatMessage from './ChatMessage.vue';
import DealMessageCard from '../deal/DealMessageCard.vue';
import type { MessageWithMetadata } from '@/utils/types';
import type { DealStatus } from '../deal/deal-reduce';

interface Props {
  /** Rendered stream items: ordinary chat messages plus inline deal cards (a row's `deal`). */
  messages: MessageWithMetadata[];
  autoScroll?: boolean;
  scrollTrigger?: number;
  userLabel?: string;
  agentLabel?: string;
  /** Deal-card context: the viewer ("you") and the voiced ("them") endpoint IDs. */
  youID?: number;
  themID?: number;
  /** The latest proposal's message ID — its card shows the live status / actions. */
  activeDealID?: number;
  /** Status of the latest proposal: `open` offers actions, else it renders rejected/enacted. */
  dealStatus?: DealStatus;
  /** Closed-this-turn lock disables deal-card actions. */
  dealLocked?: boolean;
  /** A deal action is currently in flight from the parent view. */
  dealActionBusy?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  autoScroll: true,
  scrollTrigger: 0
});

defineEmits<{
  (e: 'deal-accept', id: number): void;
  (e: 'deal-reject', id: number): void;
  (e: 'deal-counter', id: number): void;
}>();

// Template refs
const virtualScroller = ref<InstanceType<typeof VList>>();

// State for user-scroll-aware auto-scroll
const userScrolledAway = ref(false);
let isProgrammaticScroll = false;

// Scroll to the absolute bottom of the scroll container.
// Uses scrollTo(scrollSize) instead of scrollToIndex to handle items that
// grow taller than the viewport during streaming.
const scrollToBottom = () => {
  if (!virtualScroller.value) return;
  isProgrammaticScroll = true;
  requestAnimationFrame(() => {
    if (!virtualScroller.value) return;
    virtualScroller.value.scrollTo(virtualScroller.value.scrollSize);
    // Clear the flag after the scroll event fires
    requestAnimationFrame(() => {
      isProgrammaticScroll = false;
    });
  });
};

// Detect user scrolling away from bottom to pause auto-scroll.
// Auto-scroll resumes when the user scrolls back within 100px of the bottom.
const handleScroll = () => {
  if (!virtualScroller.value || isProgrammaticScroll) return;

  const scroller = virtualScroller.value;
  const distanceFromBottom = scroller.scrollSize - scroller.scrollOffset - scroller.viewportSize;
  userScrolledAway.value = distanceFromBottom > 100;
};

// Watch for scroll trigger events (streaming chunks)
watch(() => props.scrollTrigger, () => {
  if (props.autoScroll && !userScrolledAway.value && virtualScroller.value) {
    nextTick(() => {
      scrollToBottom();
    });
  }
});

onMounted(() => {
  nextTick(() => {
    scrollToBottom();
  });
});
</script>

<style scoped>
@import '@/styles/states.css';
@import '@/styles/chat.css';
</style>
