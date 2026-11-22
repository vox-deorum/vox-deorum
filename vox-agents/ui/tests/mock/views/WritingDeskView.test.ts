import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import WritingDeskView from '@/views/WritingDeskView.vue';
import { deskPollIntervalMs } from '@/stores/writing-desk';
import type { DeskCatalogueResponse, DeskJob, DeskVariantDetail } from '@/utils/types';

const api = vi.hoisted(() => ({
  getDeskCatalogue: vi.fn(),
  getDeskVariant: vi.fn(),
  getDeskJob: vi.fn(),
  startDeskJob: vi.fn(),
  stopDeskJob: vi.fn(),
  clearDeskCandidates: vi.fn(),
  settleDeskVariant: vi.fn(),
  unsettleDeskVariant: vi.fn(),
}));
vi.mock('@/api/client', () => ({ api }));

const style = { voice: 'gazette', stance: 'neutral', genre: 'report' };
const original = { headline: 'The current account', body: ['Current body'] };
const choices = [
  { id: 'first', model: 'default', headline: 'First account', body: ['First paragraph', 'Second paragraph'], warnings: [], createdAt: '2026-01-01' },
  { id: 'second', model: 'default', headline: 'Second account', body: ['Another paragraph'], warnings: [], createdAt: '2026-01-01' },
];
const initial: DeskVariantDetail = {
  templateId: 'era', variantId: 'gazette', style, revision: 'r1', settled: false, text: original,
  triggers: [], siblings: [], candidates: choices,
  variables: [{ name: 'civilization', group: 'trigger', source: 'player.name', keep: false, mayBeEmpty: false }],
};
const settled: DeskVariantDetail = {
  ...initial, variantId: 'report', revision: 'r2', settled: true, candidates: [],
  style: { voice: 'press', stance: 'friendly', genre: 'analysis' },
};
const catalogue: DeskCatalogueResponse = {
  available: true, models: ['default', 'another'],
  templates: [{
    id: 'era', file: 'science.json', tags: ['science'], triggerSummary: 'A friend enters a new era',
    variants: [initial, settled].map(value => ({
      id: value.variantId, style: value.style, headline: value.text.headline, settled: value.settled, candidateCount: value.candidates.length,
    })),
  }],
};
const running: DeskJob = {
  id: 'batch', status: 'running', total: 2, done: 0, failed: 0, tokens: { input: 0, output: 0 }, errors: [],
};

vi.mock('virtua/vue', () => ({
  VList: {
    props: ['data'],
    template: '<div><slot v-for="item in data.slice(0, 10)" :key="item.template.id" :item="item" /></div>',
  },
}));

/** Mount the desk with real inputs and stable list rendering for jsdom. */
function mountView() {
  return mount(WritingDeskView, {
    attachTo: document.body,
    global: { plugins: [PrimeVue, ToastService], stubs: { RouterLink: true }, directives: { tooltip: () => undefined } },
  });
}

let wrapper: ReturnType<typeof mountView>;

/** Open a variant from the list. */
async function selectVariant(id: string) {
  const item = wrapper.findAll('.desk-variant-link').find(button => button.get('.desk-variant-id').text() === id);
  await item!.trigger('click');
  await flushPromises();
}

/** Locate the controls for a single writing row. */
function row(id: string) {
  return wrapper.get('[data-row="' + id + '"]');
}

/** Find a control by its label. */
function action(label: string) {
  return wrapper.findAll('button').find(button => button.text() === label || button.attributes('aria-label') === label)!;
}

/** Find a confirmation action in the dialog teleported to the document. */
function dialogAction(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
    .find(button => button.textContent?.trim() === label)!;
}

describe('WritingDeskView', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    api.getDeskCatalogue.mockResolvedValue(structuredClone(catalogue));
    api.getDeskVariant.mockImplementation(({ variantId }: { variantId: string }) =>
      Promise.resolve(structuredClone(variantId === 'report' ? settled : initial)));
    api.getDeskJob.mockResolvedValue(null);
    wrapper = mountView();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('should hide settled variants when Unsettled is selected', async () => {
    expect(wrapper.findAll('.desk-variant-link')).toHaveLength(2);
    await action('Unsettled').trigger('click');
    expect(wrapper.findAll('.desk-variant-link').map(button => button.get('.desk-variant-id').text())).toEqual(['gazette']);
  });

  it('should show the selected variant style and clear it while another variant loads', async () => {
    /** Read the visible labels and values from the copy header. */
    const visibleStyle = () => Object.fromEntries(wrapper.findAll('.desk-variant-style > div')
      .map(field => [field.get('dt').text(), field.get('dd').text()]));

    await selectVariant('gazette');
    expect(visibleStyle()).toEqual({ Voice: style.voice, Stance: style.stance, Genre: style.genre });
    expect(wrapper.get('.desk-sheet .desk-sheet-header').text()).toContain('2 candidates');

    let resolve!: (detail: DeskVariantDetail) => void;
    api.getDeskVariant.mockReturnValueOnce(new Promise<DeskVariantDetail>(done => { resolve = done; }));
    await selectVariant('report');
    expect(wrapper.find('.desk-variant-style').exists()).toBe(false);
    expect(wrapper.find('.desk-sheet [role="status"]').exists()).toBe(true);
    resolve(settled);
    await flushPromises();
    expect(visibleStyle()).toEqual({ Voice: 'press', Stance: 'friendly', Genre: 'analysis' });
    expect(wrapper.get('.desk-review-state').text()).toBe('Settled');
  });

  it('should send unchanged text when settling a collapsed candidate and show the settled state', async () => {
    await selectVariant('gazette');
    const { headline, body } = choices[0]!;
    api.settleDeskVariant.mockResolvedValue({ ...initial, settled: true, candidates: [], text: { headline, body } });
    await action('Settle candidate: First account').trigger('click');
    await flushPromises();
    expect(api.settleDeskVariant).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'era', variantId: 'gazette' }),
      { headline, body, revision: 'r1' });
    expect(wrapper.get('.desk-variant-selected .desk-status').attributes('aria-label')).toBe('Settled');
    expect(wrapper.find('[data-row="first"]').exists()).toBe(false);
    expect(wrapper.get('.desk-overall').text()).toBe('2/2 settled');
    expect(wrapper.find('.desk-batch').exists()).toBe(false);
  });

  it('should switch the one open editor and save its edited copy', async () => {
    await selectVariant('gazette');
    await row('first').get('.desk-copy').trigger('click');
    expect(row('first').findAll('textarea')).toHaveLength(3);
    await row('second').get('.desk-copy').trigger('click');
    expect(row('first').find('textarea').exists()).toBe(false);
    await row('second').get('textarea').setValue('My headline');
    api.settleDeskVariant.mockResolvedValue({ ...initial, settled: true, candidates: [] });
    await action('Settle candidate: Second account').trigger('click');
    expect(api.settleDeskVariant).toHaveBeenCalledWith(expect.objectContaining({ variantId: 'gazette' }),
      expect.objectContaining({ headline: 'My headline', body: ['Another paragraph'], revision: 'r1' }));
  });

  it('should reopen the settled current copy', async () => {
    await selectVariant('report');
    api.unsettleDeskVariant.mockResolvedValue({ ...settled, settled: false });
    await action('Unsettle').trigger('click');
    await flushPromises();
    expect(api.unsettleDeskVariant).toHaveBeenCalledWith(expect.objectContaining({ variantId: 'report' }), 'r2');
    expect(wrapper.get('.desk-variant-selected .desk-status').attributes('aria-label')).toBe('No candidates');
    expect(wrapper.get('input[aria-label="Check era / report"]').element).toHaveProperty('checked', true);
  });

  it('should clear drafts only on confirmation even when the filters hide all unsettled variants', async () => {
    await selectVariant('gazette');
    await row('first').get('.desk-copy').trigger('click');
    await action('Settled').trigger('click');
    expect(wrapper.findAll('.desk-variant-id').map(variant => variant.text())).toEqual(['report']);
    await action('Clear drafts').trigger('click');
    dialogAction('Cancel').click();
    await flushPromises();
    expect(api.clearDeskCandidates).not.toHaveBeenCalled();
    expect(row('first').find('textarea').exists()).toBe(true);

    api.clearDeskCandidates.mockResolvedValue({ cleared: 2 });
    const next = structuredClone(catalogue);
    next.templates[0]!.variants[0]!.candidateCount = 0;
    api.getDeskCatalogue.mockResolvedValue(next);
    api.getDeskVariant.mockResolvedValueOnce({ ...initial, candidates: [] });
    await action('Clear drafts').trigger('click');
    dialogAction('Clear all drafts').click();
    await flushPromises();

    expect(api.clearDeskCandidates).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-row="first"]').exists()).toBe(false);
    expect(row('current').text()).toContain(original.headline);
    expect(wrapper.get('.desk-overall').text()).toBe('1/2 settled');
    expect(wrapper.find('.desk-batch').exists()).toBe(false);
  });

  it('should show a batch that started elsewhere when it prevents clearing drafts', async () => {
    await selectVariant('gazette');
    await action('Clear drafts').trigger('click');
    api.clearDeskCandidates.mockRejectedValue(new Error('Stop the running batch first'));
    api.getDeskJob.mockResolvedValue(running);
    dialogAction('Clear all drafts').click();
    await flushPromises();

    expect(action('Stop').isVisible()).toBe(true);
    expect(action('Clear drafts').element.disabled).toBe(true);
    expect(row('first').isVisible()).toBe(true);
  });

  it('should generate for unsettled variants by default and exclude settled variants from template selection', async () => {
    const template = wrapper.get<HTMLInputElement>('input[aria-label="Check all variants of era"]');
    const report = wrapper.get<HTMLInputElement>('input[aria-label="Check era / report"]');
    expect(wrapper.get('.desk-overall').text()).toBe('1/2 settled');
    expect(template.element.checked).toBe(true);
    expect(report.element.checked).toBe(false);
    expect(report.element.disabled).toBe(true);
    await action('Clear selection').trigger('click');
    expect(template.element.checked).toBe(false);
    await action('Select all unsettled').trigger('click');
    expect(template.element.checked).toBe(true);
    await template.setValue(false);
    expect(action('Generate').element.disabled).toBe(true);
    await template.setValue(true);
    expect(wrapper.get('.desk-checked').text()).toContain('1 checked');
    api.startDeskJob.mockResolvedValue(running);
    await action('Generate').trigger('click');
    await flushPromises();
    expect(api.startDeskJob).toHaveBeenCalledWith({
      refs: [{ templateId: 'era', variantId: 'gazette' }],
      choices: 3, models: ['default'],
    });
    expect(action('Generate').element.disabled).toBe(true);
  });

  it('should count and generate only checked variants matching the filters', async () => {
    const science = catalogue.templates[0]!;
    const extra = { id: 'dispatch', headline: 'A border dispatch', settled: false, candidateCount: 0,
      style: { ...style, voice: 'press' } };
    const market = { id: 'market', headline: 'Markets trade', settled: false, candidateCount: 0,
      style: { ...style, voice: 'tabloid' } };
    wrapper.unmount();
    api.getDeskCatalogue.mockResolvedValue({
      ...catalogue,
      templates: [
        { ...science, variants: [...science.variants, extra] },
        { ...science, id: 'trade', tags: ['trade'], variants: [market] },
      ],
    });
    wrapper = mountView();
    await flushPromises();
    expect(wrapper.get('.desk-checked').text()).toContain('3 checked');
    expect(wrapper.get('.desk-batch [role="status"]').text()).toContain('3 requests');

    await action('Settled').trigger('click');
    expect(wrapper.findAll('.desk-variant-id').map(variant => variant.text())).toEqual(['report']);
    expect(action('Generate').element.disabled).toBe(true);
    await action('All').trigger('click');
    wrapper.getComponent({ name: 'MultiSelect' }).vm.$emit('update:modelValue', ['science']);
    await flushPromises();
    expect(wrapper.get('.desk-checked').text()).toContain('2 checked');
    expect(wrapper.get('.desk-batch [role="status"]').text()).toContain('2 requests');

    const search = wrapper.get('input[aria-label="Search templates or variants"]');
    await search.setValue('border');
    expect(wrapper.findAll('.desk-variant-id').map(variant => variant.text())).toEqual(['dispatch']);
    expect(wrapper.get('.desk-checked').text()).toContain('1 checked');
    expect(wrapper.get('.desk-batch [role="status"]').text()).toContain('1 request');
    await wrapper.get('input[aria-label="Check all variants of era"]').setValue(false);
    await search.setValue('');
    expect(wrapper.get('input[aria-label="Check era / gazette"]').element).toHaveProperty('checked', true);
    expect(wrapper.get('input[aria-label="Check era / dispatch"]').element).toHaveProperty('checked', false);
    await search.setValue('border');
    await action('Select matching unsettled').trigger('click');

    api.startDeskJob.mockResolvedValue(running);
    await action('Generate').trigger('click');
    expect(api.startDeskJob).toHaveBeenCalledWith({
      refs: [{ templateId: 'era', variantId: 'dispatch' }],
      choices: 3, models: ['default'],
    });
  });

  it('should submit all checked variants in a large batch', async () => {
    const largeCatalogue = {
      ...catalogue,
      templates: Array.from({ length: 201 }, (_, index) => ({
        ...catalogue.templates[0]!,
        id: `era-${index}`,
        variants: [{ id: 'report', headline: original.headline, settled: false, candidateCount: 0,
          style: { ...style, stance: `stance-${index}` } }],
      })),
    };
    wrapper.unmount();
    api.getDeskCatalogue.mockResolvedValue(largeCatalogue);
    wrapper = mountView();
    await flushPromises();
    expect(wrapper.get('.desk-batch [role="status"]').text()).toContain('201');
    expect(action('Generate').element.disabled).toBe(false);
    api.startDeskJob.mockResolvedValue(running);
    await action('Generate').trigger('click');
    expect(api.startDeskJob).toHaveBeenCalledWith({
      refs: largeCatalogue.templates.map(template => ({ templateId: template.id, variantId: 'report' })),
      choices: 3, models: ['default'],
    });
  });

  it('should preserve the draft and its starting revision through a poll refresh', async () => {
    vi.useFakeTimers();
    await selectVariant('gazette');
    await row('first').get('.desk-copy').trigger('click');
    await row('first').get('textarea').setValue('My unsaved edit');
    api.startDeskJob.mockResolvedValue(running);
    await action('Generate').trigger('click');
    await flushPromises();
    api.getDeskJob.mockResolvedValue({ ...running, status: 'done', done: 2 });
    api.getDeskVariant.mockResolvedValue({ ...initial, revision: 'new', candidates: [choices[1]] });
    await vi.advanceTimersByTimeAsync(deskPollIntervalMs);
    await flushPromises();
    expect(row('first').get('textarea').element.value).toBe('My unsaved edit');
    api.settleDeskVariant.mockResolvedValue({ ...initial, settled: true, candidates: [] });
    await action('Settle candidate: First account').trigger('click');
    expect(api.settleDeskVariant).toHaveBeenCalledWith(expect.objectContaining({ variantId: 'gazette' }),
      expect.objectContaining({ revision: 'r1', headline: 'My unsaved edit' }));
  });

  it('should insert a variable at the cursor in the focused paragraph', async () => {
    await selectVariant('gazette');
    await row('first').get('.desk-copy').trigger('click');
    const field = row('first').findAll('textarea')[2]!;
    field.element.focus();
    field.element.setSelectionRange(6, 6);
    await row('first').get('button.desk-variable-chip').trigger('click');
    expect(field.element.value).toBe('Second{{civilization}} paragraph');
    expect(field.element.selectionStart).toBe(22);
  });
});
