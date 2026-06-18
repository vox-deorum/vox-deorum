import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DealMessageCard from '@/components/deal/DealMessageCard.vue';
import type { DealTranscriptMessage } from '@/utils/types';

const Button = {
  props: ['label', 'icon', 'severity', 'disabled'],
  emits: ['click'],
  template: '<button @click="$emit(\'click\')">{{ label }}</button>',
};

function dealMsg(over: Partial<DealTranscriptMessage> = {}): DealTranscriptMessage {
  return {
    ID: 5,
    Player1ID: 0,
    Player2ID: 1,
    Player1Role: 'the leader',
    Player2Role: 'diplomat',
    SpeakerID: 0,
    MessageType: 'deal-proposal',
    Content: '',
    Payload: {
      Deal: {
        version: 1,
        items: [
          { fromPlayerID: 0, toPlayerID: 1, itemType: 'GOLD', amount: 100 },
          { fromPlayerID: 1, toPlayerID: 0, itemType: 'MAPS' },
        ],
        promises: [],
      },
      Value1: { '0': 100, '1': 20 },
      Value2: { '0': 90, '1': 18 },
    },
    Turn: 7,
    CreatedAt: 1,
    ...over,
  };
}

function mountCard(props: Record<string, unknown> = {}) {
  return mount(DealMessageCard, {
    props: {
      deal: dealMsg(),
      youID: 0,
      themID: 1,
      youLabel: 'You',
      themLabel: 'Germany',
      isActive: true,
      status: 'open',
      ...props,
    },
    global: { stubs: { Button } },
  });
}

describe('DealMessageCard', () => {
  it('renders an outgoing proposal with you/them terms and value to you', () => {
    const wrapper = mountCard();
    expect(wrapper.text()).toContain('You proposed a deal');
    expect(wrapper.text()).toContain('Gold: 100'); // you give
    expect(wrapper.text()).toContain('Maps'); // they give
    // value to you from stored Value1 (you == player1): receive 20 (maps), give 100 (gold) → −80
    expect(wrapper.text()).toContain('value to You: -80');
  });

  it('offers Counter/Retract (not Accept) for my own active proposal', () => {
    const wrapper = mountCard();
    const labels = wrapper.findAll('button').map((b) => b.text());
    expect(labels).toContain('Counter');
    expect(labels).toContain('Retract');
    expect(labels).not.toContain('Accept');
  });

  it('offers Accept/Counter/Reject for an incoming active proposal and emits ID', async () => {
    const wrapper = mountCard({ deal: dealMsg({ SpeakerID: 1 }) });
    const labels = wrapper.findAll('button').map((b) => b.text());
    expect(labels).toEqual(expect.arrayContaining(['Accept', 'Counter', 'Reject']));

    await wrapper.findAll('button').find((b) => b.text() === 'Accept')!.trigger('click');
    expect(wrapper.emitted('accept')?.[0]).toEqual([5]);
  });

  it('shows superseded and no actions when not active', () => {
    const wrapper = mountCard({ isActive: false });
    expect(wrapper.text()).toContain('superseded');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('renders the rejected status (not actions) on the active proposal when it was rejected', () => {
    // The rejection is shown as the proposal's status rather than a standalone reject card.
    const wrapper = mountCard({ deal: dealMsg({ SpeakerID: 1 }), status: 'rejected' });
    expect(wrapper.text()).toContain('Rejected');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });
});
