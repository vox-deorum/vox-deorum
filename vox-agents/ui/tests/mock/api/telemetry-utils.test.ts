import { describe, it, expect } from 'vitest'
import { formatDuration, formatFileSize, getStatusText } from '@/api/telemetry-utils'

describe('formatDuration', () => {
  it('formats across unit boundaries', () => {
    expect(formatDuration(0.0005)).toBe('500ns')
    expect(formatDuration(0.5)).toBe('500μs')
    expect(formatDuration(12.34)).toBe('12.3ms')
    expect(formatDuration(1500)).toBe('1.50s')
    expect(formatDuration(65000)).toBe('1m 5.0s')
  })
})

describe('formatFileSize', () => {
  it('formats bytes through gigabytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('getStatusText', () => {
  it('maps OpenTelemetry status codes', () => {
    expect(getStatusText(0)).toBe('UNSET')
    expect(getStatusText(1)).toBe('OK')
    expect(getStatusText(2)).toBe('ERROR')
    expect(getStatusText(99)).toBe('UNKNOWN')
  })
})
