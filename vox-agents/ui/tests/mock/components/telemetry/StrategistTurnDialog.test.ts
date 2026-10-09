import { describe, it, expect } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import StrategistTurnDialog from '@/components/telemetry/strategist/StrategistTurnDialog.vue'
import { isStrategistTurnSpan } from '@/api/strategist-turn'
import { parseSpanAttributes } from '@/api/telemetry-utils'
import type { Span } from '@/utils/types'
import { ButtonStub, TagStub } from '../../../helpers/stubs.js'
import fixtures from '../../api/fixtures/strategist-turns.json'

const Dialog = defineComponent({
  template: '<div class="p-dialog"><slot name="header" /><slot /></div>',
})

const SelectButton = defineComponent({
  props: ['modelValue', 'options', 'optionLabel', 'optionValue'],
  emits: ['update:modelValue'],
  template: `<div class="p-selectbutton"><button v-for="o in options" :key="o.value" class="filter-opt" @click="$emit('update:modelValue', o.value)">{{ o.label }}</button></div>`,
})

/** Mount the dialog on one recorded trace fixture. */
function mountTurn(name: string) {
  const spans = (fixtures.find(f => f.name === name)!.spans as unknown as Span[]).map(parseSpanAttributes)
  return mountSpans(spans)
}

/** Mount the dialog with controlled trace spans. */
function mountSpans(spans: Span[]) {
  return mount(StrategistTurnDialog, {
    props: { visible: true, root: spans.find(isStrategistTurnSpan)!, spans },
    global: { stubs: { Dialog, SelectButton, Tag: TagStub, Button: ButtonStub }, directives: { tooltip: {} } },
  })
}

describe('StrategistTurnDialog', () => {
  it('should show only changed rows until All is picked', async () => {
    const wrapper = mountTurn('evaluator-20')
    const changed = wrapper.findAll('.scale-row').length
    await wrapper.findAll('.filter-opt')[1]!.trigger('click')
    expect(wrapper.findAll('.scale-row').length).toBeGreaterThan(changed)
  })

  it('should render rationales as markdown', () => {
    const wrapper = mountTurn('llm-327')
    expect(wrapper.findAll('.decision-why.message-content').length).toBeGreaterThan(0)
  })

  it('should render economic and military Strategy-mode choices', () => {
    const spans = (fixtures.find(f => f.name === 'llm-327')!.spans as unknown as Span[]).map(parseSpanAttributes)
    const options = spans.find(s => s.attributes['tool.name'] === 'get-options')!
    options.attributes = { ...options.attributes, 'tool.output': JSON.stringify({ Strategy: {
      GrandStrategy: 'Spaceship', EconomicStrategies: ['Expand'], MilitaryStrategies: ['Defend'],
    } }) }
    const call = spans.find(s => s.attributes['tool.name'] === 'set-flavors')!
    call.attributes = { ...call.attributes, 'tool.name': 'set-strategy', 'tool.input': JSON.stringify({
      EconomicStrategies: ['Grow'], MilitaryStrategies: ['Attack'],
    }) }
    const choices = mountSpans(spans).findAll('.decision-row').map(row => row.text())
    expect(choices.some(row => row.includes('Expand') && row.includes('Grow'))).toBe(true)
    expect(choices.some(row => row.includes('Defend') && row.includes('Attack'))).toBe(true)
  })

  it('should show the pacing flags in the header', () => {
    const tags = mountTurn('llm-327').findAll('.p-tag').map(t => t.text())
    expect(tags).toContain('decided')
    expect(tags).toContain('interrupted')
  })

  it('should switch between the decisions and the raw attributes in place', async () => {
    const wrapper = mountTurn('llm-262')
    expect(wrapper.find('.turn-layout').exists()).toBe(true)
    await wrapper.find('.p-btn').trigger('click')
    expect(wrapper.find('.turn-layout').exists()).toBe(false)
    expect(wrapper.findAll('.detail-row').length).toBeGreaterThan(0)
    await wrapper.find('.p-btn').trigger('click')
    expect(wrapper.find('.turn-layout').exists()).toBe(true)
  })
})
