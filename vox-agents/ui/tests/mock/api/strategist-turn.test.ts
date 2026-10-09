import { describe, it, expect } from 'vitest'
import {
  answerHistogram,
  buildStrategistTurn,
  countTags,
  formatAnswer,
  isStrategistTurnSpan,
  type DecisionItem,
  type StrategistTurn,
} from '@/api/strategist-turn'
import { parseSpanAttributes } from '@/api/telemetry-utils'
import type { Span } from '@/utils/types'
import fixtures from './fixtures/strategist-turns.json'

/** Build the turn model for one recorded trace fixture. */
function turnOf(name: string): StrategistTurn {
  const trace = fixtures.find(f => f.name === name)!
  const spans = (trace.spans as unknown as Span[]).map(parseSpanAttributes)
  return buildStrategistTurn(spans.find(isStrategistTurnSpan)!, spans)
}

/** Find a decision item by key. */
function find(items: DecisionItem[], key: string): DecisionItem {
  return items.find(i => i.key === key)!
}

/** Build a complete span with controlled fields for normalization tests. */
function span(fields: Partial<Span>): Span {
  return {
    contextId: 'context', traceId: 'trace', turn: 1, spanId: 'root', parentSpanId: null,
    name: 'strategist.turn.1', startTime: 0, endTime: 1, durationMs: 1,
    statusCode: 1, statusMessage: null, attributes: {}, ...fields,
  }
}

/** Build one strategist step and its recorded tool calls from controlled inputs. */
function llmSpans(options: object, calls: { tool: string; input: object; output?: object | null; statusCode?: number }[]): Span[] {
  return [
    span({ attributes: { 'player.id': 1 } }),
    span({ spanId: 'agent', parentSpanId: 'root', name: 'agent.simple-strategist' }),
    span({ spanId: 'options', parentSpanId: 'root', name: 'mcp-tool.get-options', attributes: { 'tool.name': 'get-options', 'tool.output': JSON.stringify(options) } }),
    span({ spanId: 'step', parentSpanId: 'agent', name: 'agent.simple-strategist.step.1', attributes: { 'step.number': 1 } }),
    ...calls.map((call, index) => span({
      spanId: `call-${index}`, parentSpanId: 'step', name: `mcp-tool.${call.tool}`, startTime: index + 1,
      statusCode: call.statusCode ?? 1,
      attributes: {
        'tool.name': call.tool, 'tool.input': JSON.stringify(call.input),
        'tool.output': JSON.stringify(call.output === undefined ? { Success: true } : call.output),
      },
    })),
  ]
}

describe('buildStrategistTurn', () => {
  describe('evaluator turn', () => {
    const turn = turnOf('evaluator-20')

    it('should detect the evaluator and name the player', () => {
      expect(turn.kind).toBe('evaluator')
      expect(turn.player).toEqual({ id: 2, name: 'China' })
      expect(turn.evaluation?.questions).toBeGreaterThan(0)
    })

    it('should mark sent values as applied with their new value', () => {
      const recon = find(turn.flavors, 'flavor_NavalRecon')
      expect(recon).toMatchObject({ current: 25, next: 21, state: 'applied' })
      expect(find(turn.choices, 'policy')).toMatchObject({ next: 'Authority (New Branch)', state: 'applied' })
    })

    it('should treat unsent proposals as unchanged and keep the original answer', () => {
      const offense = find(turn.flavors, 'flavor_Offense')
      expect(offense.state).toBe('same')
      expect(offense.next).toBeUndefined()
      expect(offense.answer?.score).toBe(2.15)
      expect(offense.answer?.confidence).toBeGreaterThan(0)
    })

    it('should name relationship targets from the player list', () => {
      const polynesia = turn.relationships.find(r => r.name === 'Polynesia')!
      expect(polynesia.private).toMatchObject({ current: 4, next: 13, state: 'applied' })
      expect(polynesia.public.state).toBe('same')
    })
  })

  describe('LLM turn', () => {
    const turn = turnOf('llm-327')

    it('should read current values from get-options and new values from tool calls', () => {
      expect(turn.kind).toBe('llm')
      expect(turn.persona.filter(p => p.state === 'applied')).toHaveLength(4)
      expect(find(turn.choices, 'research').state).toBe('applied')
      expect(find(turn.choices, 'policy').state).toBe('applied')
    })

    it('should separate changed flavors from reaffirmed and untouched ones', () => {
      const states = new Set(turn.flavors.map(f => f.state))
      expect(states.has('applied')).toBe(true)
      expect(states.has('reaffirmed')).toBe(true)
      expect(states.has('same')).toBe(true)
    })

    it('should attach rationales and step summaries', () => {
      expect(turn.rationales.flavors).toBeTruthy()
      expect(turn.rationales.research).toBeTruthy()
      expect(turn.steps.map(s => s.number)).toEqual([1, 2])
      expect(turn.steps[1]!.tools).toContain('set-flavors')
      const changed = turn.relationships.filter(r => r.public.state !== 'same' || r.private.state !== 'same')
      expect(changed.length).toBeGreaterThan(0)
      expect(changed.every(r => r.rationale)).toBe(true)
    })

    it('should report a kept status quo', () => {
      const kept = turnOf('llm-262')
      expect(kept.statusQuo).toBeTruthy()
      expect(kept.flavors.every(f => f.state === 'same')).toBe(true)
    })

    it.each([
      { output: { isError: true, content: [{ type: 'text', text: 'Rejected' }] }, statusCode: 1 },
      { output: { Success: false }, statusCode: 1 },
      { output: null, statusCode: 1 },
      { output: { Success: true }, statusCode: 2 },
    ])('should classify failed tool results independently of the transport status ($statusCode)', ({ output, statusCode }) => {
      const spans = llmSpans({}, [{ tool: 'set-policy', input: { Policy: 'Authority' }, output, statusCode }])
      expect(find(buildStrategistTurn(spans[0]!, spans).choices, 'policy').state).toBe('failed')
    })

    it('should retain each field and its call outcome across repeated partial updates', () => {
      const spans = llmSpans({
        Strategy: { GrandStrategy: 'Spaceship', Flavors: { Offense: 50, Defense: 50 } },
        Persona: { Boldness: 5, Loyalty: 5 },
      }, [
        { tool: 'set-flavors', input: { GrandStrategy: 'Conquest', Flavors: { Offense: 20 } } },
        { tool: 'set-flavors', input: { Flavors: { Defense: 30 } }, output: { Success: false } },
        { tool: 'set-flavors', input: { Flavors: { Offense: 40 } } },
        { tool: 'set-persona', input: { Boldness: 4 } },
        { tool: 'set-persona', input: { Loyalty: 2 }, output: { isError: true } },
        { tool: 'set-persona', input: { Boldness: 6 } },
      ])
      const result = buildStrategistTurn(spans[0]!, [...spans].reverse())
      expect(find(result.choices, 'grand_strategy')).toMatchObject({ next: 'Conquest', state: 'applied' })
      expect(find(result.flavors, 'Offense')).toMatchObject({ next: 40, state: 'applied' })
      expect(find(result.flavors, 'Defense')).toMatchObject({ next: 30, state: 'failed' })
      expect(find(result.persona, 'Boldness')).toMatchObject({ next: 6, state: 'applied' })
      expect(find(result.persona, 'Loyalty')).toMatchObject({ next: 2, state: 'failed' })
    })

    it('should display Strategy-mode choices, including clearing a strategy list', () => {
      const spans = llmSpans({ Strategy: {
        GrandStrategy: 'Spaceship', EconomicStrategies: ['Expand'], MilitaryStrategies: ['Defend'],
      } }, [
        { tool: 'set-strategy', input: { GrandStrategy: 'Conquest', EconomicStrategies: ['Grow'], Rationale: 'economic' } },
        { tool: 'set-strategy', input: { MilitaryStrategies: [], Rationale: 'military' } },
      ])
      const result = buildStrategistTurn(spans[0]!, spans)
      expect(find(result.choices, 'grand_strategy')).toMatchObject({ current: 'Spaceship', next: 'Conquest', state: 'applied' })
      expect(find(result.choices, 'economic_strategies')).toMatchObject({ current: 'Expand', next: 'Grow', state: 'applied' })
      expect(find(result.choices, 'military_strategies')).toMatchObject({ current: 'Defend', next: '', state: 'applied' })
      expect(result.rationales).toMatchObject({ grand_strategy: 'economic', economic_strategies: 'economic', military_strategies: 'military' })
    })

    it('should exclude nested agents from strategist steps and decisions', () => {
      const spans = llmSpans({}, [{ tool: 'set-policy', input: { Policy: 'Authority' } }])
      spans.push(
        span({ spanId: 'briefer', parentSpanId: 'agent', name: 'agent.simple-briefer' }),
        span({ spanId: 'brief-step', parentSpanId: 'briefer', name: 'agent.simple-briefer.step.1', attributes: {
          'step.number': 1, 'step.responses': JSON.stringify([{ role: 'assistant', content: [{ type: 'reasoning', text: 'Briefer reasoning' }] }]),
        } }),
        span({ spanId: 'brief-call', parentSpanId: 'brief-step', name: 'mcp-tool.set-policy', startTime: 100,
          attributes: { 'tool.name': 'set-policy', 'tool.input': JSON.stringify({ Policy: 'Progress' }), 'tool.output': JSON.stringify({ Success: true }) } }),
      )
      const result = buildStrategistTurn(spans[0]!, spans)
      expect(result.steps).toHaveLength(1)
      expect(result.steps[0]!.reasoning).toBe('')
      expect(find(result.choices, 'policy').next).toBe('Authority')
    })
  })

  it('should fall back to an empty model without an agent span', () => {
    const root = { spanId: 'r', parentSpanId: null, name: 'strategist.turn.3', attributes: { 'player.id': 1 } } as unknown as Span
    const turn = buildStrategistTurn(root, [root])
    expect(turn.kind).toBe('other')
    expect(turn.player.name).toBe('Player 1')
    expect(turn.flavors).toEqual([])
  })
})

describe('isStrategistTurnSpan', () => {
  it('should match only turn root names', () => {
    expect(isStrategistTurnSpan({ name: 'strategist.turn.12' } as Span)).toBe(true)
    expect(isStrategistTurnSpan({ name: 'strategist.turn.12.extra' } as Span)).toBe(false)
    expect(isStrategistTurnSpan({ name: 'agent.simple-strategist' } as Span)).toBe(false)
  })
})

describe('countTags', () => {
  it('should count changed, failed, and reaffirmed rows, or report no change', () => {
    const item = (state: DecisionItem['state']): DecisionItem => ({ key: state, label: state, state })
    expect(countTags([item('applied'), item('applied'), item('failed'), item('same')]).map(t => t.label))
      .toEqual(['2 changed', '1 failed'])
    expect(countTags([item('same')]).map(t => t.severity)).toEqual(['secondary'])
  })
})

describe('evaluator answer display', () => {
  const offense = find(turnOf('evaluator-20').flavors, 'flavor_Offense')

  it('should list every probability and the confidence in the tooltip', () => {
    const lines = formatAnswer(offense.answer)!.split('\n')
    expect(lines).toHaveLength(1 + offense.answer!.probabilities.length + 1)
    expect(formatAnswer(undefined)).toBeUndefined()
  })

  it('should place histogram bars at the criteria positions', () => {
    const bars = answerHistogram(offense.answer)
    expect(bars.every(b => b.at >= 0 && b.at <= 100)).toBe(true)
    expect(Math.max(...bars.map(b => b.probability))).toBeCloseTo(0.76)
  })
})
