import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TextMessage from '@/components/chat/TextMessage.vue'

describe('TextMessage', () => {
  it('maps roles to display labels, honouring custom labels', () => {
    const user = mount(TextMessage, {
      props: { role: 'user', content: 'hi', userLabel: 'Caesar' },
    })
    expect(user.find('.font-semibold').text()).toBe('Caesar')

    const assistant = mount(TextMessage, {
      props: { role: 'assistant', content: 'hi', agentLabel: 'Rome' },
    })
    expect(assistant.find('.font-semibold').text()).toBe('Rome')

    const system = mount(TextMessage, { props: { role: 'system', content: 'hi' } })
    expect(system.find('.font-semibold').text()).toBe('System')
  })

  it('renders markdown content as sanitized HTML', () => {
    const wrapper = mount(TextMessage, { props: { role: 'assistant', content: '**bold**' } })
    expect(wrapper.find('.message-content').html()).toContain('<strong>bold</strong>')
  })

  it('strips an echoed [Turn N] prefix from the rendered content', () => {
    const wrapper = mount(TextMessage, {
      props: { role: 'assistant', content: '[Turn 5] hello world' },
    })
    const content = wrapper.find('.message-content').text()
    expect(content).toContain('hello world')
    expect(content).not.toContain('[Turn 5]')
  })

  it('shows the turn badge when a turn is provided', () => {
    const wrapper = mount(TextMessage, {
      props: { role: 'assistant', content: 'x', turn: 12 },
    })
    expect(wrapper.text()).toContain('Turn 12')
  })
})
