import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatSessionsList from '@/components/ChatSessionsList.vue'
import type { EnvoyThread } from '@/utils/types'

// Lightweight stand-ins for the PrimeVue chrome so we don't need the PrimeVue plugin.
const stubs = {
  Toolbar: { template: '<div class="p-toolbar"><slot name="start" /></div>' },
  Tag: { props: ['value'], template: '<span class="p-tag">{{ value }}</span>' },
  Button: {
    props: ['label', 'icon'],
    emits: ['click'],
    template: '<button class="p-btn" :data-icon="icon" @click="$emit(\'click\', $event)">{{ label }}</button>',
  },
}

function makeSession(overrides: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 's1',
    agent: 0,
    title: 'Rome ↔ Egypt',
    gameID: 'game-1',
    player1ID: 0,
    player2ID: 1,
    player1Role: 'diplomat',
    player2Role: 'the leader',
    contextType: 'live',
    contextId: 'game-1-player-0',
    messages: [],
    ...overrides,
  } as EnvoyThread
}

function mountList(props: Record<string, unknown>) {
  return mount(ChatSessionsList, {
    props: props as never,
    global: { stubs },
  })
}

describe('ChatSessionsList', () => {
  it('renders a row per session with its title and a count tag', () => {
    const wrapper = mountList({ sessions: [makeSession(), makeSession({ id: 's2' })] })
    expect(wrapper.findAll('.table-row')).toHaveLength(2)
    expect(wrapper.text()).toContain('Rome ↔ Egypt')
    expect(wrapper.find('.p-tag').text()).toBe('2')
  })

  it('falls back to an agent/game title and resolves the voicing agent name', () => {
    const wrapper = mountList({
      sessions: [
        makeSession({ title: undefined, agent: 1, player2Role: 'envoy' }),
      ],
    })
    // agent === player2ID -> player2Role ('envoy'); title falls back to the composed string.
    expect(wrapper.find('.table-row .col-expand').text()).toBe('Chat with envoy - Game game-1')
    expect(wrapper.find('.table-row .col-fixed-120').text()).toBe('envoy')
  })

  it('emits session-selected when a row is clicked', async () => {
    const session = makeSession()
    const wrapper = mountList({ sessions: [session] })
    await wrapper.find('.table-row').trigger('click')
    expect(wrapper.emitted('session-selected')?.[0]).toEqual([session])
  })

  it('emits session-resume without also selecting the row', async () => {
    const wrapper = mountList({ sessions: [makeSession()] })
    const resume = wrapper.findAll('.p-btn').find(b => b.text() === 'Resume')!
    await resume.trigger('click')
    expect(wrapper.emitted('session-resume')?.[0]).toEqual(['s1'])
    expect(wrapper.emitted('session-selected')).toBeUndefined()
  })

  it('emits session-delete without also selecting the row', async () => {
    const wrapper = mountList({ sessions: [makeSession()] })
    const del = wrapper.findAll('.p-btn').find(b => b.attributes('data-icon') === 'pi pi-trash')!
    await del.trigger('click')
    expect(wrapper.emitted('session-delete')?.[0]).toEqual(['s1'])
    expect(wrapper.emitted('session-selected')).toBeUndefined()
  })

  it('hides the actions column when showActions is false', () => {
    const wrapper = mountList({ sessions: [makeSession()], showActions: false })
    expect(wrapper.find('.col-fixed-150').exists()).toBe(false)
    expect(wrapper.findAll('.p-btn')).toHaveLength(0)
  })

  it('shows the empty state and its action slot when there are no sessions', () => {
    const wrapper = mount(ChatSessionsList, {
      props: { sessions: [], emptyMessage: 'Nothing here' } as never,
      global: { stubs },
      slots: { 'empty-action': '<button class="new-chat">New</button>' },
    })
    expect(wrapper.find('.table-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('Nothing here')
    expect(wrapper.find('.new-chat').exists()).toBe(true)
  })
})
