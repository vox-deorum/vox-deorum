import { describe, it, expect } from 'vitest'
import { extractLogParams, filterLogs, getLevelEmoji } from '@/api/log-utils'

describe('extractLogParams', () => {
  it('keeps fixed fields and collects the rest as params, dropping transport', () => {
    const entry = extractLogParams({
      timestamp: '2026-06-15T00:00:00.000Z',
      level: 'info',
      message: 'hi',
      source: 'agents',
      transport: 'console', // fixed field, excluded from params
      playerId: 3,
      turn: 42,
    })

    expect(entry.message).toBe('hi')
    expect(entry.source).toBe('agents')
    expect(entry.params).toEqual({ playerId: 3, turn: 42 })
    expect(entry.params).not.toHaveProperty('transport')
  })

  it('omits params entirely when there are no extra fields', () => {
    const entry = extractLogParams({ timestamp: 't', level: 'debug', message: 'm' })
    expect(entry.params).toBeUndefined()
  })
})

describe('filterLogs', () => {
  const logs = [
    { timestamp: 't', level: 'debug', message: 'd', source: 'agents' },
    { timestamp: 't', level: 'error', message: 'e', source: 'bridge' },
  ] as any

  it('filters out entries below the minimum level', () => {
    const result = filterLogs(logs, 'warn', [])
    expect(result).toHaveLength(1)
    expect(result[0]?.level).toBe('error')
  })

  it('filters by selected source', () => {
    const result = filterLogs(logs, 'debug', ['bridge'])
    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('bridge')
  })

  it('returns everything at debug level with no source filter', () => {
    expect(filterLogs(logs, 'debug', [])).toHaveLength(2)
  })
})

describe('getLevelEmoji', () => {
  it('maps known levels', () => {
    expect(getLevelEmoji('error')).toBe('❌')
    expect(getLevelEmoji('warn')).toBe('⚠️')
  })

  it('falls back for unknown levels', () => {
    expect(getLevelEmoji('nope')).toBe('📝')
  })
})
