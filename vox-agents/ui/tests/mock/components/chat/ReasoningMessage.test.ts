import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReasoningMessage from '@/components/chat/ReasoningMessage.vue'

describe('ReasoningMessage', () => {
  it('renders the default title and a collapsed preview', () => {
    const wrapper = mount(ReasoningMessage, { props: { content: 'because reasons' } })

    expect(wrapper.text()).toContain('Reasoning')
    // Collapsed: preview shown, full content block not rendered.
    expect(wrapper.find('.collapsible-preview').exists()).toBe(true)
    expect(wrapper.find('.collapsible-content').exists()).toBe(false)
  })

  it('honours a custom title', () => {
    const wrapper = mount(ReasoningMessage, {
      props: { content: 'x', title: 'Thoughts' },
    })
    expect(wrapper.text()).toContain('Thoughts')
  })

  it('truncates a long preview with an ellipsis', () => {
    const long = 'a'.repeat(150)
    const wrapper = mount(ReasoningMessage, { props: { content: long } })
    const preview = wrapper.find('.collapsible-preview').text()
    expect(preview.endsWith('...')).toBe(true)
    expect(preview.length).toBeLessThan(long.length)
  })

  it('expands to show the full content on header click', async () => {
    const wrapper = mount(ReasoningMessage, { props: { content: 'full reasoning text' } })

    await wrapper.find('.collapsible-header').trigger('click')

    expect(wrapper.find('.collapsible-content').exists()).toBe(true)
    expect(wrapper.find('.collapsible-content').text()).toBe('full reasoning text')
    expect(wrapper.find('.collapsible-preview').exists()).toBe(false)
  })
})
