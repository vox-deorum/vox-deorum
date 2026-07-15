import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerConfigEditor from '@/components/session/config/PlayerConfigEditor.vue'
import type { PlayerConfig } from '@/utils/types'

const player: PlayerConfig = {
  strategist: 'simple-strategist',
  pacing: { everyTurns: 1, interruption: 'none' },
  llms: {},
}

/** Mount the editor with compact stubs because this test only exercises prop watchers. */
function mountEditor() {
  return mount(PlayerConfigEditor, {
    props: {
      players: { 0: player },
      autoPlay: true,
      strategistOptions: [{ label: 'Simple', value: 'simple-strategist' }],
      interruptionOptions: [{ label: 'None', value: 'none' }],
      loadingStrategists: false,
      loadingInterruptions: false,
    },
    global: {
      directives: { tooltip: () => undefined },
      stubs: {
        Button: true,
        Card: { template: '<section><slot name="title" /><slot name="content" /></section>' },
        Dropdown: true,
        InputNumber: true,
      },
    },
  })
}

describe('PlayerConfigEditor', () => {
  it('leaves default creation to ConfigDialog after resetting add mode', async () => {
    const wrapper = mountEditor()

    await wrapper.setProps({ players: {}, autoPlay: false })
    expect(wrapper.emitted('update:players')).toBeUndefined()

    const editor = wrapper.vm as typeof wrapper.vm & { addPlayer: () => void }
    editor.addPlayer()

    const updates = wrapper.emitted<Record<number, PlayerConfig>[]>('update:players')
    expect(updates).toHaveLength(1)
    expect(Object.keys(updates![0]![0]!)).toEqual(['1'])
  })
})
