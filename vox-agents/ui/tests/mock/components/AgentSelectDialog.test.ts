import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import AgentSelectDialog from '@/components/AgentSelectDialog.vue'

// --- Mocks -----------------------------------------------------------------

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/api/client', () => ({
  api: {
    getAgents: vi.fn(),
    getPlayersSummary: vi.fn(),
    createAgentChat: vi.fn(),
  },
}))

import { api } from '@/api/client'

// Lightweight stand-ins for the PrimeVue chrome.
const Dialog = {
  props: ['visible'],
  template: `<div class="p-dialog"><slot name="header" /><div class="p-dialog-content"><slot /></div><div class="p-dialog-footer"><slot name="footer" /></div></div>`,
}
const Tag = { props: ['value'], template: '<span class="p-tag">{{ value }}</span>' }
const Button = {
  props: ['label', 'disabled'],
  emits: ['click'],
  template: `<button class="p-btn" :disabled="disabled" @click="$emit('click')">{{ label }}</button>`,
}
const ProgressSpinner = { template: '<div class="p-spinner" />' }
const AutoComplete = {
  props: ['modelValue'],
  emits: ['update:modelValue', 'complete'],
  template: `<input class="p-autocomplete" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
}
const Select = defineComponent({
  props: ['modelValue', 'options', 'optionLabel'],
  emits: ['update:modelValue', 'change'],
  methods: {
    label(o: any) {
      return (this as any).optionLabel ? o[(this as any).optionLabel] : o
    },
    pick(o: any) {
      this.$emit('update:modelValue', o)
      this.$emit('change', { value: o })
    },
  },
  template: `<div class="p-select"><button v-for="(o, i) in options" :key="i" class="opt" @click="pick(o)">{{ label(o) }}</button></div>`,
})
const SelectButton = defineComponent({
  props: ['modelValue', 'options', 'optionLabel', 'optionValue'],
  emits: ['update:modelValue', 'change'],
  methods: {
    pick(o: any) {
      const v = (this as any).optionValue ? o[(this as any).optionValue] : o
      this.$emit('update:modelValue', v)
      this.$emit('change', { value: v })
    },
  },
  template: `<div class="p-selectbutton"><button v-for="(o, i) in options" :key="i" class="mode-opt" @click="pick(o)">{{ o[optionLabel] }}</button></div>`,
})

const stubs = { Dialog, Tag, Button, ProgressSpinner, AutoComplete, Select, SelectButton }

const AGENTS = {
  agents: [
    { name: 'diplomat', description: 'voices a civ', tags: ['active-game', 'diplomatic'] },
    { name: 'negotiator', description: 'deal specialist', tags: ['active-game', 'diplomatic'] },
    { name: 'spokesperson', description: 'spokesperson', tags: ['active-game', 'diplomatic'] },
  ],
}

// Player 1 = Rome (the AI seat chosen via the session), Player 2 = Egypt (the human seat).
const PLAYERS = {
  players: {
    '1': { Leader: 'Augustus', Civilization: 'Rome' },
    '2': { Leader: 'Cleopatra', Civilization: 'Egypt' },
  },
  assignments: {
    1: { strategist: 'simple', diplomat: 'diplomat', configSlot: 1 },
    2: { strategist: 'human-strategist', configSlot: 2 },
  },
}

const CONTEXT_ID = 'game-abc-player-1'
const SECOND_CONTEXT_ID = 'game-def-player-2'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

/** Create a promise whose completion can be ordered explicitly by a test. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => {
    resolve = complete
  })
  return { promise, resolve }
}

/** Mount the dialog hidden, then open it so the visible-watcher fires (as in real usage). */
async function openDialog() {
  const wrapper = mount(AgentSelectDialog, {
    props: { visible: false, contextId: CONTEXT_ID },
    global: { stubs },
  })
  await flushPromises()
  await wrapper.setProps({ visible: true })
  await flushPromises()
  return wrapper
}

function clickButton(wrapper: any, label: string) {
  const btn = wrapper.findAll('.p-btn').find((b: any) => b.text() === label)
  if (!btn) throw new Error(`Button "${label}" not found`)
  return btn.trigger('click')
}

describe('AgentSelectDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(api.getAgents as any).mockResolvedValue(AGENTS)
    ;(api.getPlayersSummary as any).mockResolvedValue(PLAYERS)
    ;(api.createAgentChat as any).mockResolvedValue({ id: 'sess-1' })
  })

  it('titles the dialog after the chosen seat civ and drops the session-id tag', async () => {
    const wrapper = await openDialog()

    expect(wrapper.find('h2').text()).toBe('Chat with Rome')
    // The context-id is no longer surfaced as a tag.
    const tagText = wrapper.findAll('.p-tag').map(t => t.text())
    expect(tagText).toContain('Active Game')
    expect(tagText).not.toContain(CONTEXT_ID)
  })

  it('omits the negotiator from the observer chat list', async () => {
    const wrapper = await openDialog()

    const names = wrapper.findAll('.table-row .col-fixed-150').map(c => c.text())
    expect(names).toEqual(['diplomat', 'spokesperson'])
    expect(names).not.toContain('negotiator')
  })

  it('derives the diplomacy target from the session (no target selector)', async () => {
    const wrapper = await openDialog()

    // Switch to the diplomacy (civ↔civ) mode via the mode toggle.
    const diplomacyToggle = wrapper.findAll('.mode-opt').find(b => b.text().includes('Diplomacy'))!
    await diplomacyToggle.trigger('click')
    await flushPromises()

    // The free-choice "Target civilization" selector is gone.
    expect(wrapper.text()).not.toContain('Target civilization')
    expect(wrapper.text()).toContain('Speaking as')

    await clickButton(wrapper, 'Start Conversation')
    await flushPromises()

    expect(api.createAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'diplomacy',
        contextId: CONTEXT_ID,
        targetPlayerID: 1, // Rome — derived from the contextId, not selected.
        // Both identities travel from the dialog's non-FOW summary so the backend never re-resolves.
        targetIdentity: { name: 'Rome', leader: 'Augustus' },
        callerPlayerID: 2, // the audience seat, defaulted to the human seat.
        callerIdentity: { name: 'Egypt', leader: 'Cleopatra' },
      })
    )
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'chat-detail', params: { sessionId: 'sess-1' } })
    )
  })

  it('sends the hardcoded observer identity for an observer chat', async () => {
    const wrapper = await openDialog()

    // Step 1: pick the diplomat, advance to the identity step.
    const row = wrapper.findAll('.table-row').find(r => r.text().includes('diplomat'))!
    await row.trigger('click')
    await clickButton(wrapper, 'Next')
    await flushPromises()

    // Step 2: a role, and the Observer affiliation (last option in the "Representing" select).
    await wrapper.find('.p-autocomplete').setValue('a journalist')
    const selects = wrapper.findAll('.p-select')
    const repSelect = selects[selects.length - 1]!
    const observerOpt = repSelect.findAll('.opt').find((o: any) => o.text() === 'Observer')!
    await observerOpt.trigger('click')

    await clickButton(wrapper, 'Start Chat')
    await flushPromises()

    expect(api.createAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'diplomat',
        contextId: CONTEXT_ID,
        callerPlayerID: -1,
        callerIdentity: { name: 'an observer', leader: '' },
      })
    )
  })

  it('clears a failed chat launch when retrying with cached agents', async () => {
    vi.mocked(api.getAgents).mockResolvedValue({
      agents: [{ name: 'telepathist', description: 'database analyst', tags: ['telepathist'] }],
    })
    vi.mocked(api.createAgentChat)
      .mockRejectedValueOnce(new Error('Chat creation failed'))
      .mockResolvedValueOnce({
        id: 'sess-retried',
        agent: 0,
        gameID: 'example',
        player1ID: -1,
        player2ID: 0,
        contextType: 'database',
        contextId: '',
        messages: [],
      })
    const wrapper = mount(AgentSelectDialog, {
      props: { visible: false, databasePath: 'telemetry/example.db' },
      global: { stubs },
    })

    await wrapper.setProps({ visible: true })
    await flushPromises()
    await wrapper.find('.table-row').trigger('click')
    await clickButton(wrapper, 'Start Chat')
    await flushPromises()

    expect(wrapper.text()).toContain('Chat creation failed')
    await clickButton(wrapper, 'Retry')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Chat creation failed')
    expect(api.getAgents).toHaveBeenCalledTimes(1)

    await clickButton(wrapper, 'Start Chat')
    await flushPromises()
    expect(api.createAgentChat).toHaveBeenCalledTimes(2)
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'chat-detail', params: { sessionId: 'sess-retried' } })
    )
  })

  it('deduplicates the agent registry request across a close and reopen', async () => {
    const pendingAgents = deferred<typeof AGENTS>()
    ;(api.getAgents as any).mockReturnValue(pendingAgents.promise)
    const wrapper = mount(AgentSelectDialog, {
      props: { visible: false, databasePath: 'telemetry/example.db' },
      global: { stubs },
    })

    await wrapper.setProps({ visible: true })
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })

    expect(api.getAgents).toHaveBeenCalledTimes(1)
    pendingAgents.resolve(AGENTS)
    await flushPromises()
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
    expect(api.getAgents).toHaveBeenCalledTimes(1)
  })

  it('ignores player data from a closed context after reopening another context', async () => {
    const firstPlayers = deferred<typeof PLAYERS>()
    const secondPlayers = deferred<typeof PLAYERS>()
    ;(api.getPlayersSummary as any)
      .mockReturnValueOnce(firstPlayers.promise)
      .mockReturnValueOnce(secondPlayers.promise)
    const wrapper = mount(AgentSelectDialog, {
      props: { visible: true, contextId: CONTEXT_ID },
      global: { stubs },
    })
    await flushPromises()

    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true, contextId: SECOND_CONTEXT_ID })
    secondPlayers.resolve({
      players: {
        '1': { Leader: 'Augustus', Civilization: 'Rome' },
        '2': { Leader: 'Cleopatra', Civilization: 'Egypt' },
      },
      assignments: PLAYERS.assignments,
    })
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('Chat with Egypt')

    firstPlayers.resolve(PLAYERS)
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('Chat with Egypt')
    expect(api.getPlayersSummary).toHaveBeenCalledTimes(2)
  })

  it('invalidates an in-flight player request when context changes while open', async () => {
    const firstPlayers = deferred<typeof PLAYERS>()
    const secondPlayers = deferred<typeof PLAYERS>()
    ;(api.getPlayersSummary as any)
      .mockReturnValueOnce(firstPlayers.promise)
      .mockReturnValueOnce(secondPlayers.promise)
    const wrapper = mount(AgentSelectDialog, {
      props: { visible: true, contextId: CONTEXT_ID },
      global: { stubs },
    })
    await flushPromises()

    await wrapper.setProps({ contextId: SECOND_CONTEXT_ID })
    firstPlayers.resolve(PLAYERS)
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('Select Agent')

    secondPlayers.resolve({
      players: {
        '1': { Leader: 'Augustus', Civilization: 'Rome' },
        '2': { Leader: 'Cleopatra', Civilization: 'Egypt' },
      },
      assignments: PLAYERS.assignments,
    })
    await flushPromises()
    expect(wrapper.find('h2').text()).toBe('Chat with Egypt')
    expect(api.getPlayersSummary).toHaveBeenCalledTimes(2)
  })
})
