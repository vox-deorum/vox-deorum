/**
 * Global UI test setup.
 *
 * jsdom provides no `EventSource`, but several stores (e.g. stores/logs.ts) open an
 * SSE stream via `new EventSource(...)` at module-import time. A bare import of such a
 * store would throw `EventSource is not defined` and crash the suite. We install a
 * no-op shim so an accidental store import degrades to a dead stream instead of a
 * hard error. Tests that actually care about SSE should stub `apiClient.streamLogs`
 * and friends and drive the callbacks directly.
 *
 * We also use fake timers so the stores' `setInterval` polling can't leak real timers
 * across tests; `shouldAdvanceTime` keeps microtasks/fetch flowing.
 */
import { vi, beforeEach, afterEach } from 'vitest'

class FakeEventSource {
  url: string
  withCredentials = false
  readyState = 0
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  constructor(url: string) {
    this.url = url
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

if (typeof globalThis.EventSource === 'undefined') {
  // @ts-expect-error - minimal stand-in for the browser EventSource
  globalThis.EventSource = FakeEventSource
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
