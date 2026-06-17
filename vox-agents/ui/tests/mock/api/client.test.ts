import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Capture every SSE instance constructed by the client so tests can drive its events
// and assert the constructor args (url + options). Defined via vi.hoisted so the
// (hoisted) vi.mock factory below can reference them.
const { FakeSSE, sseInstances } = vi.hoisted(() => {
  const instances: any[] = []
  class FakeSSE {
    url: string
    options: any
    listeners: Record<string, ((e: any) => void)[]> = {}
    streamed = false
    closed = false
    onerror: ((e: any) => void) | null = null
    constructor(url: string, options: any) {
      this.url = url
      this.options = options
      instances.push(this)
    }
    addEventListener(event: string, cb: (e: any) => void) {
      ;(this.listeners[event] ||= []).push(cb)
    }
    stream() {
      this.streamed = true
    }
    close() {
      this.closed = true
    }
    emit(event: string, data?: any) {
      for (const cb of this.listeners[event] || []) cb({ data })
    }
  }
  return { FakeSSE, sseInstances: instances }
})

vi.mock('sse.js', () => ({ SSE: FakeSSE }))

// Likewise capture EventSource instances for the SSE GET streams.
const esInstances: FakeEventSource[] = []

class FakeEventSource {
  url: string
  listeners: Record<string, ((e: any) => void)[]> = {}
  onmessage: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  closed = false
  constructor(url: string) {
    this.url = url
    esInstances.push(this)
  }
  addEventListener(event: string, cb: (e: any) => void) {
    ;(this.listeners[event] ||= []).push(cb)
  }
  close() {
    this.closed = true
  }
  emit(event: string, data?: any) {
    for (const cb of this.listeners[event] || []) cb({ data })
  }
}

import { api } from '@/api/client'

function mockFetch(impl: (url: string, options?: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(impl as any)
  vi.stubGlobal('fetch', fn)
  return fn
}

/** A minimal ok/error Response stand-in. */
function jsonResponse(body: unknown, ok = true, statusText = 'OK'): Response {
  return {
    ok,
    statusText,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

beforeEach(() => {
  sseInstances.length = 0
  esInstances.length = 0
  vi.stubGlobal('EventSource', FakeEventSource as any)
})

afterEach(() => {
  api.closeAllConnections()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ApiClient REST methods', () => {
  it('GETs health from the configured base url', async () => {
    const fetchFn = mockFetch(() => jsonResponse({ service: 'vox-agents-webui' }))
    const res = await api.getHealth()
    expect(res).toEqual({ service: 'vox-agents-webui' })
    expect(fetchFn).toHaveBeenCalledWith('http://localhost:5555/api/health', undefined)
  })

  it('POSTs startSession with a JSON body and content-type', async () => {
    const fetchFn = mockFetch(() => jsonResponse({}))
    await api.startSession({ type: 'strategist' } as never)
    const [url, options] = fetchFn.mock.calls[0]! as [string, any]
    expect(url).toBe('http://localhost:5555/api/session/start')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(options.body)).toEqual({ config: { type: 'strategist' } })
  })

  it('DELETEs a session config with an encoded filename', async () => {
    const fetchFn = mockFetch(() => jsonResponse({ success: true }))
    await api.deleteSessionConfig('my config.json')
    const [url, options] = fetchFn.mock.calls[0]! as [string, any]
    expect(url).toBe('http://localhost:5555/api/session/config/my%20config.json')
    expect(options.method).toBe('DELETE')
  })

  it('builds the traces URL with limit/offset query params', async () => {
    const fetchFn = mockFetch(() => jsonResponse({ traces: [] }))
    await api.getDatabaseTraces('telemetry/game.db', 50, 10)
    const [url] = fetchFn.mock.calls[0]! as [string]
    expect(url).toContain('/api/telemetry/db/telemetry%2Fgame.db/traces?')
    expect(url).toContain('limit=50')
    expect(url).toContain('offset=10')
  })

  it('maps a JSON error body to its error message', async () => {
    mockFetch(() => jsonResponse({ error: 'boom from server' }, false, 'Bad Request'))
    await expect(api.getHealth()).rejects.toThrow('boom from server')
  })

  it('falls back to raw text when the error body is not JSON', async () => {
    mockFetch(
      () =>
        ({
          ok: false,
          statusText: 'Server Error',
          json: async () => ({}),
          text: async () => 'plain text failure',
        }) as Response,
    )
    await expect(api.getHealth()).rejects.toThrow('plain text failure')
  })
})

describe('ApiClient uploadDatabase', () => {
  it('throws the mapped error on a failed upload', async () => {
    mockFetch(
      () =>
        ({
          ok: false,
          statusText: 'Too Large',
          json: async () => ({}),
          text: async () => JSON.stringify({ error: 'file too big' }),
        }) as Response,
    )
    const file = { name: 'x.db' } as File
    await expect(api.uploadDatabase(file)).rejects.toThrow('file too big')
  })
})

describe('ApiClient SSE streams', () => {
  it('streamLogs opens an EventSource and parses log events', () => {
    const onMessage = vi.fn()
    const onHeartbeat = vi.fn()
    const cleanup = api.streamLogs(onMessage, undefined, onHeartbeat)

    expect(esInstances).toHaveLength(1)
    expect(esInstances[0]!.url).toBe('http://localhost:5555/api/logs/stream')

    esInstances[0]!.emit('log', JSON.stringify({ message: 'hello', level: 'info' }))
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0]![0]).toMatchObject({ message: 'hello' })

    esInstances[0]!.emit('heartbeat')
    expect(onHeartbeat).toHaveBeenCalled()

    cleanup()
    expect(esInstances[0]!.closed).toBe(true)
  })

  it('replaces an existing logs connection when called again', () => {
    api.streamLogs(vi.fn())
    api.streamLogs(vi.fn())
    expect(esInstances).toHaveLength(2)
    // The first connection is closed when the second replaces it.
    expect(esInstances[0]!.closed).toBe(true)
    expect(esInstances[1]!.closed).toBe(false)
  })

  it('streamAgentMessage POSTs via SSE and dispatches message/done/error', () => {
    const onMessage = vi.fn()
    const onError = vi.fn()
    const onDone = vi.fn()
    const cleanup = api.streamAgentMessage(
      { chatId: 'c1', message: 'hi' } as never,
      onMessage,
      onError,
      onDone,
    )

    expect(sseInstances).toHaveLength(1)
    const sse = sseInstances[0]
    expect(sse.url).toBe('http://localhost:5555/api/agents/message')
    expect(sse.options.method).toBe('POST')
    expect(JSON.parse(sse.options.payload)).toEqual({ chatId: 'c1', message: 'hi' })
    expect(sse.streamed).toBe(true)

    sse.emit('message', JSON.stringify({ type: 'text-delta', text: 'hi' }))
    expect(onMessage).toHaveBeenCalledWith({ type: 'text-delta', text: 'hi' })

    sse.emit('done')
    expect(onDone).toHaveBeenCalled()

    sse.emit('error', JSON.stringify('server failed'))
    expect(onError).toHaveBeenCalledWith('server failed')

    cleanup()
    expect(sse.closed).toBe(true)
  })

  it('closeAllConnections closes every open stream', () => {
    api.streamLogs(vi.fn())
    api.streamAgentMessage({ chatId: 'c2', message: 'x' } as never, vi.fn(), vi.fn(), vi.fn())

    api.closeAllConnections()

    expect(esInstances.every(e => e.closed)).toBe(true)
    expect(sseInstances.every(s => s.closed)).toBe(true)
  })
})
