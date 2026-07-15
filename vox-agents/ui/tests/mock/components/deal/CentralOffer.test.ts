import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import CentralOffer from '@/components/deal/CentralOffer.vue';
import { range, carthageTarget, dealStubs } from '../../utils/deal/deal-test-fixtures';

const inspected = (over: Record<string, unknown> = {}) => ({
  fromPlayerID: 0, toPlayerID: 1, itemType: 'OPEN_BORDERS',
  legality: true, reasons: [], valueIfIGive: 99, valueIfIReceive: 88, ...over,
});

function mountOffer(props: Record<string, unknown> = {}) {
  return mount(CentralOffer, {
    props: {
      items: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'OPEN_BORDERS' }],
      promises: [],
      inspectedItems: [inspected()],
      inspectedPromises: [],
      youID: 0,
      counterpartID: 1,
      youLabel: 'You',
      counterpartLabel: 'Them',
      ranges: { '0': range(), '1': range() },
      promiseTargets: [],
      locked: false,
      busy: false,
      ...props,
    },
    global: { stubs: dealStubs, directives: { tooltip: {} } },
  });
}

describe('CentralOffer', () => {
  it('renders a given item under its giver column and emits remove-item on the red X', async () => {
    const wrapper = mountOffer();
    // The item is given by you (fromPlayerID = youID = 0) → it sits in the "You give" column.
    expect(wrapper.find('.deal-offer-col-title').text()).toContain('You give');
    expect(wrapper.find('.deal-offer-row').exists()).toBe(true);
    expect(wrapper.text()).toContain('Open Borders');

    await wrapper.find('.deal-offer-x').trigger('click');
    expect(wrapper.emitted('remove-item')![0]).toEqual([0]);
  });

  it('emits update-item with the new amount when a gold row is edited', async () => {
    const wrapper = mountOffer({
      items: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'GOLD', amount: 50 }],
      inspectedItems: [inspected({ itemType: 'GOLD', valueIfIGive: 50, valueIfIReceive: 50 })],
    });
    const num = wrapper.find('.number-stub');
    expect(num.exists()).toBe(true);
    (num.element as HTMLInputElement).value = '120';
    await num.trigger('input');

    expect(wrapper.emitted('update-item')![0]).toEqual([0, { amount: 120 }]);
  });

  it('caps the gold-per-turn editor at the giver’s net income (netGoldPerTurn)', () => {
    const wrapper = mountOffer({
      items: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'GOLD_PER_TURN', amount: 10, duration: 30 }],
      inspectedItems: [inspected({ itemType: 'GOLD_PER_TURN', valueIfIGive: 10, valueIfIReceive: 10 })],
    });
    const num = wrapper.find('.number-stub');
    // netGoldPerTurn = 42 in the fixture → the GPT input clamps to [1, 42].
    expect(num.attributes('max')).toBe('42');
    expect(num.attributes('min')).toBe('1');
  });

  it('caps the gold editor at the giver’s treasury (gold.max)', () => {
    const wrapper = mountOffer({
      items: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'GOLD', amount: 50 }],
      inspectedItems: [inspected({ itemType: 'GOLD', valueIfIGive: 50, valueIfIReceive: 50 })],
    });
    const num = wrapper.find('.number-stub');
    // gold.max = 500 in the fixture; gold's floor is 0.
    expect(num.attributes('max')).toBe('500');
    expect(num.attributes('min')).toBe('0');
  });

  it('emits remove-promise for a pledged promise row', async () => {
    const wrapper = mountOffer({
      items: [],
      inspectedItems: [],
      promises: [{ promiserID: 0, recipientID: 1, promiseType: 'COOP_WAR', targetPlayerID: 3 }],
      inspectedPromises: [{ promiserID: 0, recipientID: 1, promiseType: 'COOP_WAR' }],
      promiseTargets: [carthageTarget],
    });
    await wrapper.find('.deal-offer-x').trigger('click');
    expect(wrapper.emitted('remove-promise')![0]).toEqual([0]);
  });

  it('shows a structurally impossible term in red', () => {
    const wrapper = mountOffer({
      inspectedItems: [inspected({ legality: false, reasons: ['No longer possible'], valueIfIGive: 0, valueIfIReceive: 0 })],
    });
    expect(wrapper.find('.deal-offer-row-illegal').exists()).toBe(true);
  });

  it('sums the live, sentinel-aware value balance for both sides', () => {
    const wrapper = mountOffer();
    // You give the term (lose 99); the counterpart receives it (gains 88).
    expect(wrapper.text()).toContain('Value to You: -99');
    expect(wrapper.text()).toContain('Value to Them: +88');
  });

  it('disables the remove + amount controls while locked', () => {
    const wrapper = mountOffer({
      items: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'GOLD', amount: 50 }],
      inspectedItems: [inspected({ itemType: 'GOLD', valueIfIGive: 50, valueIfIReceive: 50 })],
      locked: true,
    });
    expect(wrapper.find('.deal-offer-x').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.number-stub').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.deal-message .text-stub').attributes('disabled')).toBeDefined();
  });

  it('two-way binds the one-sentence deal message', async () => {
    const wrapper = mountOffer({ message: 'Initial note.' });
    const msg = wrapper.find('.deal-message .text-stub');
    expect((msg.element as HTMLInputElement).value).toBe('Initial note.');

    (msg.element as HTMLInputElement).value = 'A revised line.';
    await msg.trigger('input');
    expect(wrapper.emitted('update:message')![0]).toEqual(['A revised line.']);
  });
});
