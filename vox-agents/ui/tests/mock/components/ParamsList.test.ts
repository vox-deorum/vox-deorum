import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ParamsList from '@/components/ParamsList.vue'

describe('ParamsList', () => {
  it('renders object entries with typed value classes', () => {
    const wrapper = mount(ParamsList, {
      props: { params: { name: 'civ', count: 7, ok: true } },
    })

    expect(wrapper.find('ul.param-object').exists()).toBe(true)
    expect(wrapper.html()).toContain('name: ')
    expect(wrapper.find('.param-string').text()).toBe('"civ"')
    expect(wrapper.find('.param-number').text()).toBe('7')
    expect(wrapper.find('.param-boolean').text()).toBe('true')
  })

  it('renders arrays with index keys', () => {
    const wrapper = mount(ParamsList, { props: { params: ['a', 'b'] } })
    expect(wrapper.find('ul.param-array').exists()).toBe(true)
    expect(wrapper.html()).toContain('[0]: ')
    expect(wrapper.findAll('.param-string')).toHaveLength(2)
  })

  it('renders empty markers for empty object and array', () => {
    expect(mount(ParamsList, { props: { params: {} } }).find('.param-empty').text()).toBe('{}')
    expect(mount(ParamsList, { props: { params: [] } }).find('.param-empty').text()).toBe('[]')
  })

  it('renders null and undefined values', () => {
    const wrapper = mount(ParamsList, { props: { params: { a: null, b: undefined } } })
    expect(wrapper.find('.param-null').text()).toBe('null')
    expect(wrapper.find('.param-undefined').text()).toBe('undefined')
  })
})
