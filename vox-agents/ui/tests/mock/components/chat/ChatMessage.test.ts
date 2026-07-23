import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// Mock the text cleaner so we can observe that it runs on text parts and that an
// all-artifact part collapses to nothing. The stub strips a sentinel and trims.
vi.mock('@vox/utils/models/text-cleaning', () => ({
  cleanToolArtifacts: vi.fn((text: string) => text.replace(/\[ARTIFACT\]/g, '').trim()),
}))

import ChatMessage from '@/components/chat/ChatMessage.vue'
import { cleanToolArtifacts } from '@vox/utils/models/text-cleaning'

const TextMessageStub = {
  name: 'TextMessage',
  props: ['role', 'content', 'turn', 'userLabel', 'agentLabel'],
  template: '<div class="text-stub">{{ content }}</div>',
}
const ReasoningMessageStub = {
  name: 'ReasoningMessage',
  props: ['content'],
  template: '<div class="reasoning-stub">{{ content }}</div>',
}
const ToolCallMessageStub = {
  name: 'ToolCallMessage',
  props: ['toolName', 'args', 'result', 'completed', 'failed', 'preliminary', 'providerExecuted', 'dynamic'],
  template: '<div class="toolcall-stub">{{ toolName }}</div>',
}

function mountMessage(message: unknown, extra: Record<string, unknown> = {}) {
  return mount(ChatMessage, {
    props: { message, ...extra } as never,
    global: {
      stubs: {
        TextMessage: TextMessageStub,
        ReasoningMessage: ReasoningMessageStub,
        ToolCallMessage: ToolCallMessageStub,
      },
    },
  })
}

describe('ChatMessage', () => {
  it('dispatches a plain string content to a single TextMessage', () => {
    const wrapper = mountMessage({ role: 'assistant', content: 'hello world' })
    const texts = wrapper.findAllComponents(TextMessageStub)
    expect(texts).toHaveLength(1)
    expect(texts[0]!.props('content')).toBe('hello world')
    expect(cleanToolArtifacts).toHaveBeenCalledWith('hello world')
  })

  it('drops a string part that cleans down to empty', () => {
    const wrapper = mountMessage({ role: 'assistant', content: '[ARTIFACT]' })
    expect(wrapper.findAllComponents(TextMessageStub)).toHaveLength(0)
  })

  it('dispatches array parts to the matching child components in order', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'the answer' },
        { type: 'tool-call', toolName: 'get-players', input: { x: 1 }, toolCallId: 'c1' },
      ],
    })

    expect(wrapper.findComponent(ReasoningMessageStub).props('content')).toBe('thinking')
    expect(wrapper.findComponent(TextMessageStub).props('content')).toBe('the answer')
    expect(wrapper.findComponent(ToolCallMessageStub).props('toolName')).toBe('get-players')

    // chronological order preserved
    const classes = wrapper.findAll('.chat-message > *').map(w => w.classes())
    expect(classes[0]).toContain('reasoning-stub')
    expect(classes[1]).toContain('text-stub')
    expect(classes[2]).toContain('toolcall-stub')
  })

  it('folds a tool-result into its matching tool-call (result + completed) and hides it', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolName: 'get-players', input: {}, toolCallId: 'c1' },
        { type: 'tool-result', toolCallId: 'c1', output: { players: 2 } },
      ],
    })

    const calls = wrapper.findAllComponents(ToolCallMessageStub)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.props('completed')).toBe(true)
    expect(calls[0]!.props('result')).toEqual({ players: 2 })
    // The tool-result is not rendered as its own block.
    expect(wrapper.findAll('.chat-message > *')).toHaveLength(1)
  })

  it('leaves a tool-call uncompleted when there is no matching result', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', toolName: 'get-players', input: {}, toolCallId: 'c1' }],
    })
    const call = wrapper.findComponent(ToolCallMessageStub)
    expect(call.props('completed')).toBe(false)
    expect(call.props('result')).toBeUndefined()
  })

  it('keeps preliminary progress pending and retains provider provenance', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolName: 'command',
          input: {},
          toolCallId: 'c1',
          providerExecuted: true,
          dynamic: true,
        },
        {
          type: 'tool-result',
          toolName: 'command',
          toolCallId: 'c1',
          output: { status: 'in_progress' },
          providerExecuted: true,
          dynamic: true,
          preliminary: true,
        },
      ],
    })
    const call = wrapper.findComponent(ToolCallMessageStub)
    expect(call.props()).toMatchObject({
      completed: false,
      failed: false,
      preliminary: true,
      providerExecuted: true,
      dynamic: true,
    })
  })

  it('renders a structured failed result as a completed failure', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolName: 'command', input: {}, toolCallId: 'c1' },
        {
          type: 'tool-result',
          toolName: 'command',
          toolCallId: 'c1',
          output: { status: 'failed', error: { message: 'boom' } },
        },
      ],
    })
    const call = wrapper.findComponent(ToolCallMessageStub)
    expect(call.props('completed')).toBe(true)
    expect(call.props('failed')).toBe(true)
  })

  it('folds a tool-error into its matching call', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolName: 'command', input: {}, toolCallId: 'c1' },
        { type: 'tool-error', toolName: 'command', toolCallId: 'c1', error: 'boom' },
      ],
    })
    const call = wrapper.findComponent(ToolCallMessageStub)
    expect(call.props('completed')).toBe(true)
    expect(call.props('failed')).toBe(true)
    expect(call.props('result')).toBe('boom')
    expect(wrapper.findAll('.chat-message > *')).toHaveLength(1)
  })

  it('cleans tool artifacts from array text parts', () => {
    const wrapper = mountMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'kept[ARTIFACT]' }],
    })
    expect(wrapper.findComponent(TextMessageStub).props('content')).toBe('kept')
  })

  it('passes metadata turn and labels through to TextMessage', () => {
    const wrapper = mountMessage(
      { role: 'user', content: 'hi' },
      { metadata: { datetime: new Date(), turn: 9 }, userLabel: 'Caesar', agentLabel: 'Rome' },
    )
    const text = wrapper.findComponent(TextMessageStub)
    expect(text.props('turn')).toBe(9)
    expect(text.props('userLabel')).toBe('Caesar')
    expect(text.props('agentLabel')).toBe('Rome')
  })
})
