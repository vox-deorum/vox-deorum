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

const range = (over: Record<string, unknown> = {}) => ({
  gold: { available: true, max: 500 },
  goldPerTurn: { available: true },
  maps: false,
  openBorders: true,
  defensivePact: false,
  researchAgreement: false,
  peaceTreaty: false,
  allowEmbassy: false,
  declarationOfFriendship: false,
  vassalage: false,
  vassalageRevoke: false,
  resources: [],
  cities: [],
  techs: [],
  thirdPartyPeace: [],
  thirdPartyWar: [],
  ...over,
});

const inspectionResult = (items: unknown[] = []) => ({
  items,
  promises: [],
  tradableRange: { '0': range(), '1': range() },
});

/** Create a promise whose completion is controlled by the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const stubs = {
  Button: { props: ['label', 'icon', 'disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')">{{ label }}</button>' },
  Tag: { props: ['value'], template: '<span class="tag">{{ value }}</span>' },
  Select: { props: ['options', 'modelValue'], template: '<span class="select-stub"></span>' },
  InputNumber: { props: ['modelValue'], template: '<span class="number-stub"></span>' },
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

describe('DealScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getDealMessages.mockResolvedValue({ messages: [] });
    api.inspectDeal.mockResolvedValue(inspectionResult());
  });

  it('loads deal messages then inspects the empty deal, rendering both sides', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    expect(api.getDealMessages).toHaveBeenCalledWith('dipl:g:0:1');
    expect(api.inspectDeal).toHaveBeenCalled();
    const sideNames = wrapper.findAll('.deal-side-name').map((n) => n.text());
    expect(sideNames).toContain('You, Rome gives');
    expect(sideNames).toContain('Germany gives');
  });

  it('proposes the working deal and reloads', async () => {
    api.proposeDeal.mockResolvedValue({ id: 5, messageType: 'deal-proposal', turn: 1 });
    const wrapper = mountScreen();
    await flushPromises();

    // Add a term via the side's "Open Borders" toggle (no input needed), then propose.
    const openBordersBtn = wrapper.findAll('button').find((b) => b.text() === 'Open Borders');
    expect(openBordersBtn).toBeTruthy();
    await openBordersBtn!.trigger('click');
    await flushPromises();

    const proposeBtn = wrapper.findAll('button').find((b) => b.text() === 'Propose');
    expect(proposeBtn).toBeTruthy();
    await proposeBtn!.trigger('click');
    await flushPromises();

    expect(api.proposeDeal).toHaveBeenCalledTimes(1);
    const arg = api.proposeDeal.mock.calls[0]![1];
    expect(arg.deal.items[0]).toMatchObject({ fromPlayerID: 0, toPlayerID: 1, itemType: 'OPEN_BORDERS' });
    // Reloads after the write.
    expect(api.getDealMessages).toHaveBeenCalledTimes(2);
  });

  it('surfaces an active proposal and offers accept/reject', async () => {
    api.getDealMessages.mockResolvedValue({
      messages: [
        {
          ID: 9,
          Player1ID: 0,
          Player2ID: 1,
          Player1Role: 'the leader',
          Player2Role: 'diplomat',
          SpeakerID: 0,
          MessageType: 'deal-proposal',
          Content: '',
          Payload: { Deal: { version: 1, items: [], promises: [] } },
          Turn: 1,
          CreatedAt: 1,
        },
      ],
    });
    const wrapper = mountScreen();
    await flushPromises();

    const labels = wrapper.findAll('button').map((b) => b.text());
    expect(labels).toContain('Accept');
    expect(labels).toContain('Reject');
    expect(labels).toContain('Counter');
  });

  it('renders third-party and explicit vote-commitment controls', async () => {
    api.inspectDeal.mockResolvedValue({
      items: [],
      promises: [],
      tradableRange: {
        '0': range({ thirdPartyPeace: [{ teamID: 4 }], thirdPartyWar: [{ teamID: 5 }] }),
        '1': range(),
      },
    });
    const wrapper = mountScreen();
    await flushPromises();

    const labels = wrapper.findAll('button').map((b) => b.text());
    expect(labels).toContain('Add third-party peace');
    expect(labels).toContain('Add third-party war');
    expect(labels).toContain('Add vote commitment');
  });

  it('keeps the newest inspection result when an older request finishes later', async () => {
    const wrapper = mountScreen();
    await flushPromises();

    await wrapper.findAll('button').find((b) => b.text() === 'Open Borders')!.trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();

    const slow = deferred<ReturnType<typeof inspectionResult>>();
    api.inspectDeal.mockImplementationOnce(() => slow.promise);
    api.inspectDeal.mockResolvedValueOnce(inspectionResult([
      {
        fromPlayerID: 0,
        toPlayerID: 1,
        itemType: 'OPEN_BORDERS',
        legality: true,
        reasons: [],
        valueIfIGive: 99,
        valueIfIReceive: 88,
      },
    ]));

    await wrapper.find('.deal-refresh').trigger('click');
    await flushPromises();
    await wrapper.find('.deal-refresh').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('give 99');

    slow.resolve(inspectionResult([
      {
        fromPlayerID: 0,
        toPlayerID: 1,
        itemType: 'OPEN_BORDERS',
        legality: true,
        reasons: [],
        valueIfIGive: 1,
        valueIfIReceive: 2,
      },
    ]));
    await flushPromises();

    expect(wrapper.text()).toContain('give 99');
    expect(wrapper.text()).not.toContain('give 1 ·');
  });
});
