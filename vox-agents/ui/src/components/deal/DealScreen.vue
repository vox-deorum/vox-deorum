<!-- DealScreen renders the diplomatic trade board. useDealEditor owns its state machine. -->
<template>
  <div class="deal-screen">
    <Message v-if="error" severity="error" :closable="true" @close="error = ''">{{ error }}</Message>
    <Message v-if="!inspection && !error" severity="secondary">Loading the tradable range...</Message>

    <div v-if="inspection" class="deal-board-scroll">
      <div class="deal-board">
        <InventoryPanel
          side="left"
          :label="youLabel"
          :categories="youCategories"
          :locked="locked"
          :busy="blocked"
          @add-term="onAddTerm"
        />
        <CentralOffer
          :items="workingDeal.items"
          :promises="workingDeal.promises"
          :inspected-items="inspection.items"
          :inspected-promises="inspection.promises"
          :counterpart-i-d="counterpartID"
          :you-i-d="youID"
          :counterpart-label="counterpartLabel"
          :you-label="youLabel"
          :ranges="inspection.tradableRange"
          :promise-targets="promiseTargets"
          v-model:message="dealMessage"
          :locked="locked"
          :busy="blocked"
          @update-item="onUpdateItem"
          @remove-item="onRemoveItem"
          @remove-promise="onRemovePromise"
        />
        <InventoryPanel
          side="right"
          :label="counterpartLabel"
          :categories="counterpartCategories"
          :locked="locked"
          :busy="blocked"
          @add-term="onAddTerm"
        />
      </div>
    </div>

    <div class="deal-actions">
      <span v-if="locked" class="deal-muted">Conversation closed this turn. Deal actions are locked.</span>
      <template v-else>
        <Button v-if="!hasOpenProposal" label="Propose" icon="pi pi-send" :loading="busy" :disabled="!canPropose" @click="doPropose" />
        <Button v-if="hasOpenProposal" label="Counter" icon="pi pi-replay" severity="secondary" :loading="busy" :disabled="!canCounter" @click="doCounter" />
        <Button v-if="hasOpenProposal && !activeAuthoredByViewer && !isEdited" label="Accept" icon="pi pi-check" severity="success" :loading="busy" :disabled="!canAccept" @click="doAccept" />
        <Button v-if="hasOpenProposal && isEdited" label="Reset" icon="pi pi-undo" severity="secondary" text :disabled="blocked" @click="resetToActiveProposal" v-tooltip.bottom="'Discard edits and restore the original proposal'" />
        <Button
          v-if="hasOpenProposal"
          :label="activeAuthoredByViewer ? 'Retract' : 'Refuse'"
          icon="pi pi-times-circle"
          severity="danger"
          :loading="busy"
          :disabled="!canReject"
          @click="doReject"
        />
        <span v-if="hasIllegalTerm && hasTerms" class="deal-muted">Remove or fix the impossible term (red)</span>
        <span v-else-if="hasOpenProposal && !activeAuthoredByViewer && isEdited" class="deal-muted">
          You changed this proposal. Send it as a Counter, or Reset to accept the original.
        </span>
      </template>
      <div class="deal-status">
        <Tag v-if="reduction.status === 'open'" value="Active proposal" severity="info" />
        <Tag v-else-if="reduction.status === 'rejected'" value="Last proposal rejected" severity="warn" />
        <Tag v-else-if="reduction.status === 'enacted'" value="Enacted" severity="success" />
        <span v-if="inspecting" class="deal-muted"><i class="pi pi-spin pi-spinner" /> evaluating...</span>
        <Button
          class="deal-refresh"
          icon="pi pi-refresh"
          text
          rounded
          size="small"
          :disabled="blocked"
          @click="reloadDeals"
          v-tooltip.bottom="'Reload proposals and re-evaluate'"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import Button from 'primevue/button';
import Tag from 'primevue/tag';
import Message from 'primevue/message';
import type { DealPayload } from '@/utils/types';
import { useDealEditor, type DealSubmission, type DealThreadResponse } from '@/composables/useDealEditor';
import InventoryPanel from './InventoryPanel.vue';
import CentralOffer from './CentralOffer.vue';

const props = defineProps<{
  chatId: string;
  leftID: number;
  rightID: number;
  leftLabel: string;
  rightLabel: string;
  locked?: boolean;
  agentBusy?: boolean;
}>();

const emit = defineEmits<{
  (event: 'changed', thread: DealThreadResponse): void;
  (event: 'send', payload: { deal: DealPayload; expectedProposalID?: number }): void;
}>();

const busy = defineModel<boolean>('busy', { default: false });

/** Forward a completed blocking write to the host. */
const emitChanged = (thread: DealThreadResponse): void => emit('changed', thread);

/** Forward a proposal or counter to the host streaming workflow. */
const emitSend = (submission: DealSubmission): void => emit('send', submission);

const editor = useDealEditor({
  chatId: toRef(props, 'chatId'),
  leftID: toRef(props, 'leftID'),
  rightID: toRef(props, 'rightID'),
  leftLabel: toRef(props, 'leftLabel'),
  rightLabel: toRef(props, 'rightLabel'),
  locked: toRef(props, 'locked'),
  agentBusy: toRef(props, 'agentBusy'),
  busy,
  onChanged: emitChanged,
  onSend: emitSend,
});

const {
  activeAuthoredByViewer, blocked, canAccept, canCounter, canPropose, canReject,
  counterpartCategories, counterpartID, counterpartLabel, dealMessage, doAccept, doCounter,
  doPropose, doReject, error, hasIllegalTerm, hasOpenProposal, hasTerms, inspecting, inspection,
  isEdited, onAddTerm, onRemoveItem, onRemovePromise, onUpdateItem, promiseTargets, reduction,
  reloadDeals, resetToActiveProposal, workingDeal, youCategories, youID, youLabel,
} = editor;
</script>

<style scoped>
@import '@/styles/deal.css';
.deal-screen {
  min-width: 0;
}
</style>
