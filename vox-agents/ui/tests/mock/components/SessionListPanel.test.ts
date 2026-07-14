import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SessionListPanel from '@/components/SessionListPanel.vue';

const stubs = {
  Toolbar: { template: '<div class="p-toolbar"><slot name="start" /></div>' },
  Tag: {
    props: ['value', 'severity'],
    template: '<span class="p-tag" :data-severity="severity">{{ value }}</span>',
  },
};

describe('SessionListPanel', () => {
  it('renders the title, count, table header, and rows', () => {
    const wrapper = mount(SessionListPanel, {
      props: {
        title: 'Sessions',
        count: 2,
        emptyMessage: 'No sessions',
        emptyIcon: 'pi pi-info-circle',
        countSeverity: 'success',
      },
      global: { stubs },
      slots: {
        header: '<div class="test-header">Name</div>',
        default: '<div class="table-row">First row</div>',
      },
    });

    expect(wrapper.get('h3').text()).toBe('Sessions');
    expect(wrapper.get('.p-tag').text()).toBe('2');
    expect(wrapper.get('.p-tag').attributes('data-severity')).toBe('success');
    expect(wrapper.get('.table-header').text()).toBe('Name');
    expect(wrapper.get('.table-body').text()).toBe('First row');
  });

  it('renders the empty state and empty action without table framing', () => {
    const wrapper = mount(SessionListPanel, {
      props: {
        title: 'Sessions',
        count: 0,
        emptyMessage: 'Nothing active',
        emptyIcon: 'pi pi-comments',
      },
      global: { stubs },
      slots: { 'empty-action': '<button class="empty-action">Start</button>' },
    });

    expect(wrapper.get('.table-empty').text()).toContain('Nothing active');
    expect(wrapper.get('.table-empty i').classes()).toEqual(['pi', 'pi-comments']);
    expect(wrapper.find('.empty-action').exists()).toBe(true);
    expect(wrapper.find('.data-table').exists()).toBe(false);
    expect(wrapper.find('.p-tag').exists()).toBe(false);
  });
});
