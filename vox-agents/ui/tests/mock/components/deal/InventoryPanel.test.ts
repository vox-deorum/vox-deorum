import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import InventoryPanel from '@/components/deal/InventoryPanel.vue';
import { buildSideCatalog } from '@/components/deal/deal-catalog';
import type { NormalizedSideRange, PromiseTargetInfo } from '@/utils/types';
import { range, carthageTarget } from './deal-test-fixtures';

/** Build this side's categories the way DealScreen does, owner=0 (you), other=1 (counterpart). */
const cats = (over: Partial<NormalizedSideRange> = {}, promiseTargets: PromiseTargetInfo[] = []) =>
  buildSideCatalog({
    ownerID: 0,
    otherID: 1,
    range: range(over),
    currentItems: [],
    currentPromises: [],
    defaultDuration: 30,
    peaceDuration: 10,
    relationshipDuration: 25,
    promiseTargets,
  });

function mountPanel(categories: ReturnType<typeof cats>, props: Record<string, unknown> = {}) {
  return mount(InventoryPanel, {
    props: { side: 'left', label: 'You, Rome', categories, locked: false, busy: false, ...props },
    global: { directives: { tooltip: {} } },
  });
}

const row = (wrapper: ReturnType<typeof mountPanel>, label: string) =>
  wrapper.findAll('button.deal-row').find((b) => b.text().includes(label));

describe('InventoryPanel', () => {
  it('renders the side label and emits add-term with the item when a legal row is clicked', async () => {
    const wrapper = mountPanel(cats());
    expect(wrapper.find('.deal-panel-left .deal-panel-title').text()).toContain('You, Rome');

    await row(wrapper, 'Open Borders')!.trigger('click');

    expect(wrapper.emitted('add-term')).toHaveLength(1);
    expect(wrapper.emitted('add-term')![0]![0]).toMatchObject({
      kind: 'item',
      item: { itemType: 'OPEN_BORDERS', fromPlayerID: 0, toPlayerID: 1 },
    });
  });

  it('marks a structurally impossible row red + aria-disabled and never emits on click', async () => {
    const wrapper = mountPanel(cats({ defensivePact: { legal: false, reasons: ['No embassy'] } }));
    const dp = row(wrapper, 'Defensive Pact')!;
    expect(dp.classes()).toContain('deal-row-illegal');
    expect(dp.attributes('aria-disabled')).toBe('true');

    await dp.trigger('click');
    expect(wrapper.emitted('add-term')).toBeUndefined();
  });

  it('suppresses adds while locked (rows are aria-disabled, clicks do nothing)', async () => {
    const wrapper = mountPanel(cats(), { locked: true });
    const ob = row(wrapper, 'Open Borders')!;
    expect(ob.attributes('aria-disabled')).toBe('true');

    await ob.trigger('click');
    expect(wrapper.emitted('add-term')).toBeUndefined();
  });

  it('suppresses adds while a write is busy', async () => {
    const wrapper = mountPanel(cats(), { busy: true });
    await row(wrapper, 'Open Borders')!.trigger('click');
    expect(wrapper.emitted('add-term')).toBeUndefined();
  });

  it('expands a targeted promise row and emits the already-targeted term when a target is chosen', async () => {
    const wrapper = mountPanel(
      cats({}, [carthageTarget]),
    );
    // Click the expandable Coop War row → its eligible targets appear inline.
    await row(wrapper, 'cooperative war')!.trigger('click');
    await row(wrapper, 'Carthage')!.trigger('click');

    expect(wrapper.emitted('add-term')).toHaveLength(1);
    expect(wrapper.emitted('add-term')![0]![0]).toMatchObject({
      kind: 'promise',
      promise: { promiseType: 'COOP_WAR', promiserID: 0, recipientID: 1, targetPlayerID: 3 },
    });
  });

  it('does not expand a targeted promise row while locked', async () => {
    const wrapper = mountPanel(
      cats({}, [carthageTarget]),
      { locked: true },
    );
    await row(wrapper, 'cooperative war')!.trigger('click');
    // No target row revealed → no Carthage button to click.
    expect(row(wrapper, 'Carthage')).toBeUndefined();
  });
});
