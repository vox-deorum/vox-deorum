import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolCallMessage from '@/components/chat/ToolCallMessage.vue'

// Stub the detail dialog so we can inspect the entries/visibility it receives without
// rendering PrimeVue's Dialog.
const DetailDialogStub = {
  name: 'DetailDialog',
  props: ['visible', 'header', 'entries'],
  template: '<div class="detail-dialog-stub" />',
}

function mountCall(props: Record<string, unknown>) {
  return mount(ToolCallMessage, {
    props: props as never,
    global: { stubs: { DetailDialog: DetailDialogStub } },
  })
}

describe('ToolCallMessage', () => {
  it('shows a spinner while the call is pending', () => {
    const wrapper = mountCall({ toolName: 'get-players', completed: false })
    expect(wrapper.find('.pi-spinner').exists()).toBe(true)
    expect(wrapper.find('.pi-check-circle').exists()).toBe(false)
    expect(wrapper.find('.tool-status-name').text()).toBe('get-players')
  })

  it('shows a completed icon once finished', () => {
    const wrapper = mountCall({ toolName: 'get-players', completed: true })
    expect(wrapper.find('.pi-check-circle').exists()).toBe(true)
    expect(wrapper.find('.pi-spinner').exists()).toBe(false)
    expect(wrapper.find('.tool-completed').exists()).toBe(true)
  })

  it('builds detail entries for both input and output', () => {
    const wrapper = mountCall({
      toolName: 'get-players',
      args: { playerId: 1 },
      result: { name: 'Rome' },
      completed: true,
    })
    const entries = wrapper.findComponent(DetailDialogStub).props('entries')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ label: 'Input', value: { playerId: 1 } })
    expect(entries[1]).toMatchObject({ label: 'Output', value: { name: 'Rome' }, dividerBefore: true })
  })

  it('omits the input entry when there are no args', () => {
    const wrapper = mountCall({ toolName: 'noop', result: 'done', completed: true })
    const entries = wrapper.findComponent(DetailDialogStub).props('entries')
    expect(entries).toHaveLength(1)
    expect(entries[0].label).toBe('Output')
  })

  it('opens the detail dialog when the status row is clicked', async () => {
    const wrapper = mountCall({ toolName: 'get-players', args: { x: 1 }, completed: true })
    expect(wrapper.findComponent(DetailDialogStub).props('visible')).toBe(false)

    await wrapper.find('.tool-status').trigger('click')

    expect(wrapper.findComponent(DetailDialogStub).props('visible')).toBe(true)
  })
})
