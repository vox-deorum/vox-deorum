import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Shared spy so tests can assert auto-scroll without a real virtual scroller.
// vi.hoisted lets the (hoisted) vi.mock factory below reference it safely.
const scrollToSpy = vi.hoisted(() => vi.fn())

// Stub virtua/vue's VList: render the default slot per data item and expose the scroll
// surface (scrollTo + size getters) the component reads.
vi.mock('virtua/vue', () => ({
  VList: {
    name: 'VList',
    props: ['data', 'overscan'],
    data() {
      return { scrollSize: 1000, scrollOffset: 0, viewportSize: 500 }
    },
    methods: {
      scrollTo: scrollToSpy,
    },
    template: `<div class="vlist">
      <div v-for="(item, index) in data" :key="index" class="vlist-item">
        <slot :item="item" :index="index" />
      </div>
    </div>`,
  },
}))

import ChatMessages from '@/components/chat/ChatMessages.vue'

const ChatMessageStub = {
  name: 'ChatMessage',
  props: ['message', 'metadata', 'userLabel', 'agentLabel'],
  template: '<div class="chat-message-stub">{{ message.content }}</div>',
}

function makeMessage(content: string, turn = 1) {
  return { message: { role: 'assistant', content }, metadata: { datetime: new Date(), turn } }
}

function mountMessages(props: Record<string, unknown>) {
  return mount(ChatMessages, {
    props: props as never,
    global: { stubs: { ChatMessage: ChatMessageStub } },
  })
}

describe('ChatMessages', () => {
  beforeEach(() => {
    scrollToSpy.mockClear()
    // Run requestAnimationFrame callbacks synchronously so scrollToBottom resolves
    // without depending on the global fake-timer config.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the empty state when there are no messages', () => {
    const wrapper = mountMessages({ messages: [] })
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('No messages yet')
    expect(wrapper.find('.vlist').exists()).toBe(false)
  })

  it('renders a ChatMessage per item and forwards labels/metadata', () => {
    const wrapper = mountMessages({
      messages: [makeMessage('one', 3), makeMessage('two', 4)],
      userLabel: 'Caesar',
      agentLabel: 'Rome',
    })

    const items = wrapper.findAllComponents(ChatMessageStub)
    expect(items).toHaveLength(2)
    expect(items[0]!.props('message')).toMatchObject({ content: 'one' })
    expect(items[0]!.props('metadata')).toMatchObject({ turn: 3 })
    expect(items[0]!.props('userLabel')).toBe('Caesar')
    expect(items[1]!.props('agentLabel')).toBe('Rome')
    expect(wrapper.find('.empty-state').exists()).toBe(false)
  })

  it('auto-scrolls to the bottom on mount', async () => {
    mountMessages({ messages: [makeMessage('one')] })
    await flushPromises()
    expect(scrollToSpy).toHaveBeenCalledWith(1000)
  })

  it('scrolls again when scrollTrigger changes (and not scrolled away)', async () => {
    const wrapper = mountMessages({ messages: [makeMessage('one')], scrollTrigger: 0 })
    await flushPromises()
    scrollToSpy.mockClear()

    await wrapper.setProps({ scrollTrigger: 1 })
    await flushPromises()

    expect(scrollToSpy).toHaveBeenCalledWith(1000)
  })

  it('does not auto-scroll on trigger when autoScroll is disabled', async () => {
    const wrapper = mountMessages({ messages: [makeMessage('one')], autoScroll: false, scrollTrigger: 0 })
    await flushPromises()
    scrollToSpy.mockClear()

    await wrapper.setProps({ scrollTrigger: 1 })
    await flushPromises()

    expect(scrollToSpy).not.toHaveBeenCalled()
  })
})
