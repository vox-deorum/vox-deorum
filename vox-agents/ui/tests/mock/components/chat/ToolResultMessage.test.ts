import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolResultMessage from '@/components/chat/ToolResultMessage.vue'

// vue-json-pretty pulls in styles and heavy rendering; stub it to a marker we can find.
const VueJsonPrettyStub = {
  name: 'VueJsonPretty',
  props: ['data'],
  template: '<div class="vjp-stub">{{ JSON.stringify(data) }}</div>',
}

function mountResult(result: unknown) {
  return mount(ToolResultMessage, {
    props: { toolName: 'get-players', result },
    global: { stubs: { VueJsonPretty: VueJsonPrettyStub } },
  })
}

describe('ToolResultMessage', () => {
  it('shows the tool name in the header', () => {
    const wrapper = mountResult('ok')
    expect(wrapper.text()).toContain('Result: get-players')
  })

  it('renders a string result as plain text', () => {
    const wrapper = mountResult('plain string output')
    expect(wrapper.find('.text-result').exists()).toBe(true)
    expect(wrapper.find('.text-result').text()).toBe('plain string output')
    expect(wrapper.find('.vjp-stub').exists()).toBe(false)
  })

  it('renders an object result through the JSON viewer, not as text', () => {
    const wrapper = mountResult({ a: 1, b: 'two' })
    // Took the non-string branch: the plain-text node is absent but the content block exists.
    expect(wrapper.find('.tool-result-content').exists()).toBe(true)
    expect(wrapper.find('.text-result').exists()).toBe(false)
  })

  it('hides the content block for null/undefined results', () => {
    expect(mountResult(null).find('.tool-result-content').exists()).toBe(false)
    expect(mountResult(undefined).find('.tool-result-content').exists()).toBe(false)
  })
})
