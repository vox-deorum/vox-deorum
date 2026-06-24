import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

// Mock the API client the component drives.
const api = vi.hoisted(() => ({
  inspectDeal: vi.fn(),
  getDealMessages: vi.fn(),
  proposeDeal: vi.fn(),
  counterDeal: vi.fn(),
  rejectDeal: vi.fn(),
  acceptDeal: vi.fn(),
}));
vi.mock('@/api/client', () => ({ api }));
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: vi.fn() }) }));

import DealScreen from '@/components/deal/DealScreen.vue';

/** A normalized tradable-range fixture (the enriched shape inspect-deal now returns). */
const range = (over: Record<string, unknown> = {}) => ({
  gold: { available: true, max: 500, reasons: [] },
  goldPerTurn: { available: true, reasons: [] },
  maps: { legal: true, reasons: [] },
  openBorders: { legal: true, reasons: [] },
  defensivePact: { legal: true, reasons: [] },
  researchAgreement: { legal: true, reasons: [] },
  peaceTreaty: { legal: true, reasons: [] },
  allowEmbassy: { legal: true, reasons: [] },
  declarationOfFriendship: { legal: true, reasons: [] },
  vassalage: { legal: true, reasons: [] },
  vassalageRevoke: { legal: true, reasons: [] },
  resources: [],
  cities: [],
  techs: [],
  thirdPartyPeace: [],
  thirdPartyWar: [],
  voteCommitments: [],
  ...over,
});

const inspectionResult = (items: unknown[] = [], over: Record<string, unknown> = {}) => ({
  items,
  promises: [],
  tradableRange: { '0': range(), '1': range() },
  defaultDuration: 30,
  promiseTargets: [],
  ...over,
});

/** Create a promise whose completion is controlled by the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const stubs = {
  Button: {
    props: ['label', 'icon', 'disabled', 'loading', 'severity'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>',
  },
  Tag: { props: ['value'], template: '<span class="tag">{{ value }}</span>' },
  Select: { props: ['options', 'modelValue'], emits: ['update:modelValue'], template: '<span class="select-stub"></span>' },
  InputNumber: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input class="number-stub" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
  InputText: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input class="text-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  Message: { props: ['severity'], template: '<div class="message"><slot /></div>' },
};

function mountScreen(props: Record<string, unknown> = {}) {
  return mount(DealScreen, {
    props: {
      chatId: 'dipl:g:0:1',
      leftID: 0,
      rightID: 1,
      leftLabel: 'You, Rome',
      rightLabel: 'Germany',
      ...props,
    },
    global: { stubs, directives: { tooltip: {} } },
  });
}

/** Find an inventory row button (by visible label) inside a given panel. */
const rowInPanel = (wrapper: ReturnType<typeof mountScreen>, panel: string, label: string) =>
  wrapper.find(panel).findAll('button.deal-row').find((b) => b.text().includes(label));

const incomingProposal = (over: Record<string, unknown> = {}) => ({
  ID: 9,
  Player1ID: 0,
  Player2ID: 1,
  Player1Role: 'the leader',
  Player2Role: 'diplomat',
  SpeakerID: 1,
  MessageType: 'deal-proposal',
  Content: '',
  Payload: { Deal: { version: 1, items: [], promises: [] } },
  Turn: 1,
  CreatedAt: 1,
  ...over,
});

describe('DealScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getDealMessages.mockResolvedValue({ messages: [] });
    api.inspectDeal.mockResolvedValue(inspectionResult());
  });

  it('renders the counterpart on the left and you on the right (three-panel orientation)', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    expect(api.getDealMessages).toHaveBeenCalledWith('dipl:g:0:1');
    expect(api.inspectDeal).toHaveBeenCalled();
    // Host passes leftID=you, rightID=LLM; the board inverts to counterpart-left / you-right.
    expect(wrapper.find('.deal-panel-left .deal-panel-title').text()).toContain('Germany');
    expect(wrapper.find('.deal-panel-right .deal-panel-title').text()).toContain('You, Rome');
  });

  it('adds a clicked inventory term to the correct giver/column', async () => {
    api.proposeDeal.mockResolvedValue({ id: 5, messageType: 'deal-proposal', turn: 1 });
    const wrapper = mountScreen();
    await flushPromises();

    // Your panel (right) → you are the giver (fromPlayerID = leftID = 0).
    await rowInPanel(wrapper, '.deal-panel-right', 'Open Borders')!.trigger('click');
    await flushPromises();

    // It lands under "You give" in the central offer.
    expect(wrapper.find('.deal-panel-center').text()).toContain('Open Borders');

    const proposeBtn = wrapper.findAll('button').find((b) => b.text() === 'Propose');
    await proposeBtn!.trigger('click');
    await flushPromises();

    expect(api.proposeDeal).toHaveBeenCalledTimes(1);
    expect(api.proposeDeal.mock.calls[0]![1].deal.items[0]).toMatchObject({
      fromPlayerID: 0,
      toPlayerID: 1,
      itemType: 'OPEN_BORDERS',
    });
    // Initial load, pre-submit freshness check, then reload after the write.
    expect(api.getDealMessages).toHaveBeenCalledTimes(3);
  });

  it('adds a counterpart-panel term as the counterpart giver', async () => {
    api.proposeDeal.mockResolvedValue({ id: 6, messageType: 'deal-proposal', turn: 1 });
    const wrapper = mountScreen();
    await flushPromises();

    // Counterpart panel (left) → the counterpart is the giver (fromPlayerID = rightID = 1).
    await rowInPanel(wrapper, '.deal-panel-left', 'Open Borders')!.trigger('click');
    await flushPromises();
    await wrapper.findAll('button').find((b) => b.text() === 'Propose')!.trigger('click');
    await flushPromises();

    expect(api.proposeDeal.mock.calls[0]![1].deal.items[0]).toMatchObject({ fromPlayerID: 1, toPlayerID: 0 });
  });

  it('renders structurally impossible inventory rows red and disabled, while legal rows stay clickable', async () => {
    api.inspectDeal.mockResolvedValue(
      inspectionResult([], { tradableRange: { '0': range({ defensivePact: { legal: false, reasons: ['No embassy'] } }), '1': range() } })
    );
    const wrapper = mountScreen();
    await flushPromises();

    // Rows use `aria-disabled` (not the native attribute) so the reason tooltip still fires on hover.
    const dp = rowInPanel(wrapper, '.deal-panel-right', 'Defensive Pact')!;
    expect(dp.classes()).toContain('deal-row-illegal');
    expect(dp.attributes('aria-disabled')).toBe('true');
    expect(dp.attributes('disabled')).toBeUndefined();

    const ob = rowInPanel(wrapper, '.deal-panel-right', 'Open Borders')!;
    expect(ob.classes()).not.toContain('deal-row-illegal');
    expect(ob.attributes('aria-disabled')).toBe('false');
  });

  it('surfaces an incoming proposal with Refuse/Counter/Accept', async () => {
    api.getDealMessages.mockResolvedValue({ messages: [incomingProposal()] });
    const wrapper = mountScreen();
    await flushPromises();

    const labels = wrapper.findAll('button').map((b) => b.text());
    expect(labels).toContain('Accept');
    expect(labels).toContain('Refuse');
    expect(labels).toContain('Counter');
    expect(labels).not.toContain('Retract');
  });

  it('offers Retract/Counter (no Accept) for the viewer’s own active proposal', async () => {
    api.getDealMessages.mockResolvedValue({ messages: [incomingProposal({ SpeakerID: 0 })] });
    const wrapper = mountScreen();
    await flushPromises();

    const labels = wrapper.findAll('button').map((b) => b.text());
    expect(labels).not.toContain('Accept');
    expect(labels).toContain('Retract');
    expect(labels).toContain('Counter');
  });

  it('keeps a stale-impossible proposal visible in red and blocks Accept (Counter/Refuse stay available)', async () => {
    api.getDealMessages.mockResolvedValue({
      messages: [incomingProposal({ Payload: { Deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS' }], promises: [] } } })],
    });
    // The proposal's single term is no longer structurally legal.
    api.inspectDeal.mockResolvedValue(
      inspectionResult([{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS', legality: false, reasons: ['No longer possible'], valueIfIGive: 0, valueIfIReceive: 0 }])
    );
    const wrapper = mountScreen();
    await flushPromises();

    // The illegal term is shown red in the central offer.
    expect(wrapper.find('.deal-offer-row-illegal').exists()).toBe(true);

    const button = (label: string) => wrapper.findAll('button').find((b) => b.text() === label)!;
    expect(button('Accept').attributes('disabled')).toBeDefined();
    expect(button('Counter').attributes('disabled')).toBeUndefined();
    expect(button('Refuse').attributes('disabled')).toBeUndefined();
  });

  it('does not counter when the active proposal changed identity before submit', async () => {
    const proposal = (id: number) => incomingProposal({
      ID: id,
      Payload: { Deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS' }], promises: [] } },
    });
    // Initial render shows proposal #9; the pre-submit freshness check sees a newer #10 arrive.
    api.getDealMessages
      .mockResolvedValueOnce({ messages: [proposal(9)] })
      .mockResolvedValueOnce({ messages: [proposal(9), proposal(10)] });
    const wrapper = mountScreen();
    await flushPromises();

    await wrapper.findAll('button').find((b) => b.text() === 'Counter')!.trigger('click');
    await flushPromises();

    expect(api.counterDeal).not.toHaveBeenCalled();
  });

  it('keeps the newest inspection result when an older request finishes later', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await rowInPanel(wrapper, '.deal-panel-right', 'Open Borders')!.trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();

    const slow = deferred<ReturnType<typeof inspectionResult>>();
    api.inspectDeal.mockImplementationOnce(() => slow.promise);
    api.inspectDeal.mockResolvedValueOnce(
      inspectionResult([{ fromPlayerID: 0, toPlayerID: 1, itemType: 'OPEN_BORDERS', legality: true, reasons: [], valueIfIGive: 99, valueIfIReceive: 88 }])
    );

    await wrapper.find('.deal-refresh').trigger('click');
    await flushPromises();
    await wrapper.find('.deal-refresh').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('give 99');

    slow.resolve(
      inspectionResult([{ fromPlayerID: 0, toPlayerID: 1, itemType: 'OPEN_BORDERS', legality: true, reasons: [], valueIfIGive: 1, valueIfIReceive: 2 }])
    );
    await flushPromises();

    expect(wrapper.text()).toContain('give 99');
    expect(wrapper.text()).not.toContain('give 1 ·');
  });

  it('re-inspects with the edited amount when a central gold row is changed', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    // Add gold from your panel, then edit its amount on the central row.
    await rowInPanel(wrapper, '.deal-panel-right', 'Gold')!.trigger('click');
    await flushPromises();

    const goldInput = wrapper.find('.deal-panel-center .number-stub');
    expect(goldInput.exists()).toBe(true);
    (goldInput.element as HTMLInputElement).value = '250';
    await goldInput.trigger('input');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();

    const calls = api.inspectDeal.mock.calls;
    const lastDeal = calls[calls.length - 1]![1].deal;
    expect(lastDeal.items[0]).toMatchObject({ itemType: 'GOLD', amount: 250, fromPlayerID: 0 });
  });

  it('adds a targeted promise by expanding the inventory row and choosing a civ', async () => {
    api.inspectDeal.mockResolvedValue(
      inspectionResult([], { promiseTargets: [{ playerID: 3, teamID: 3, name: 'Carthage', kind: 'major', coopWarEligible: true }] })
    );
    api.proposeDeal.mockResolvedValue({ id: 7, messageType: 'deal-proposal', turn: 1 });
    const wrapper = mountScreen();
    await flushPromises();

    // Expand the Coop War promise in your (right) panel; the target list appears inline.
    await rowInPanel(wrapper, '.deal-panel-right', 'cooperative war')!.trigger('click');
    await flushPromises();
    // Pick the target on the inventory row — the promise is added already targeted.
    await rowInPanel(wrapper, '.deal-panel-right', 'Carthage')!.trigger('click');
    await flushPromises();

    const proposeBtn = wrapper.findAll('button').find((b) => b.text() === 'Propose')!;
    expect(proposeBtn.attributes('disabled')).toBeUndefined();
    await proposeBtn.trigger('click');
    await flushPromises();

    expect(api.proposeDeal.mock.calls[0]![1].deal.promises[0]).toMatchObject({
      promiserID: 0,
      recipientID: 1,
      promiseType: 'COOP_WAR',
      targetPlayerID: 3,
    });
  });

  it('adds a third-party war by expanding "Declare war on…" and choosing a team', async () => {
    api.inspectDeal.mockResolvedValue(
      inspectionResult([], { tradableRange: { '0': range({ thirdPartyWar: [{ teamID: 5, name: 'Greece', legal: true, reasons: [] }] }), '1': range() } })
    );
    api.proposeDeal.mockResolvedValue({ id: 8, messageType: 'deal-proposal', turn: 1 });
    const wrapper = mountScreen();
    await flushPromises();

    await rowInPanel(wrapper, '.deal-panel-right', 'Declare war')!.trigger('click');
    await flushPromises();
    await rowInPanel(wrapper, '.deal-panel-right', 'Greece')!.trigger('click');
    await flushPromises();

    expect(wrapper.find('.deal-panel-center').text()).toContain('War with Greece');
    await wrapper.findAll('button').find((b) => b.text() === 'Propose')!.trigger('click');
    await flushPromises();

    expect(api.proposeDeal.mock.calls[0]![1].deal.items[0]).toMatchObject({
      itemType: 'THIRD_PARTY_WAR',
      thirdPartyTeamID: 5,
      fromPlayerID: 0,
    });
  });

  it('refuses Accept in the handler when the proposal turns illegal at the preflight re-inspect', async () => {
    api.getDealMessages.mockResolvedValue({
      messages: [incomingProposal({ Payload: { Deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS' }], promises: [] } } })],
    });
    // Legal at the initial inspect (Accept enabled), illegal at the pre-submit re-inspect.
    api.inspectDeal
      .mockResolvedValueOnce(inspectionResult([{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS', legality: true, reasons: [], valueIfIGive: 1, valueIfIReceive: 1 }]))
      .mockResolvedValue(inspectionResult([{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS', legality: false, reasons: ['No longer possible'], valueIfIGive: 0, valueIfIReceive: 0 }]));
    const wrapper = mountScreen();
    await flushPromises();

    const acceptBtn = wrapper.findAll('button').find((b) => b.text() === 'Accept')!;
    expect(acceptBtn.attributes('disabled')).toBeUndefined(); // legal at render
    await acceptBtn.trigger('click');
    await flushPromises();

    // The preflight re-inspection now sees an illegal term, so the handler (via mayAccept) refuses.
    expect(api.acceptDeal).not.toHaveBeenCalled();
  });

  it('aborts Accept when the preflight re-inspection fails outright (never acts on stale legality)', async () => {
    api.getDealMessages.mockResolvedValue({
      messages: [incomingProposal({ Payload: { Deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS' }], promises: [] } } })],
    });
    // Legal at the initial inspect (Accept enabled), but the pre-submit re-inspect fails (network/game down).
    api.inspectDeal
      .mockResolvedValueOnce(inspectionResult([{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS', legality: true, reasons: [], valueIfIGive: 1, valueIfIReceive: 1 }]))
      .mockRejectedValue(new Error('inspect unavailable'));
    const wrapper = mountScreen();
    await flushPromises();

    const acceptBtn = wrapper.findAll('button').find((b) => b.text() === 'Accept')!;
    expect(acceptBtn.attributes('disabled')).toBeUndefined(); // legal at render

    await acceptBtn.trigger('click');
    await flushPromises();

    // A failed preflight makes refreshDealState return false, so ensureActionStillValid aborts the write.
    expect(api.acceptDeal).not.toHaveBeenCalled();
  });

  it('hides Accept once the incoming proposal is edited and restores it on Reset', async () => {
    api.getDealMessages.mockResolvedValue({
      messages: [incomingProposal({ Payload: { Deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS' }], promises: [] } } })],
    });
    api.inspectDeal.mockResolvedValue(
      inspectionResult([{ fromPlayerID: 1, toPlayerID: 0, itemType: 'OPEN_BORDERS', legality: true, reasons: [], valueIfIGive: 1, valueIfIReceive: 1 }])
    );
    const wrapper = mountScreen();
    await flushPromises();

    const labels = () => wrapper.findAll('button').map((b) => b.text());
    // Unedited: Accept is offered (it would record exactly the stored proposal); no Reset yet.
    expect(labels()).toContain('Accept');
    expect(labels()).not.toContain('Reset');

    // Edit the proposal by adding a term from your panel — the draft now diverges from the stored deal.
    await rowInPanel(wrapper, '.deal-panel-right', 'Open Borders')!.trigger('click');
    await flushPromises();
    expect(labels()).not.toContain('Accept'); // hidden: Accept would record the wrong (original) terms
    expect(labels()).toContain('Counter');
    expect(labels()).toContain('Reset');

    // Reset restores the stored proposal terms → Accept returns, Reset goes away.
    await wrapper.findAll('button').find((b) => b.text() === 'Reset')!.trigger('click');
    await flushPromises();
    expect(labels()).toContain('Accept');
    expect(labels()).not.toContain('Reset');
  });
});
