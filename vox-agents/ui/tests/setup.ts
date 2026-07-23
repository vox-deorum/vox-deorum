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
 * Vue Test Utils wrappers are unmounted before timer and mock cleanup so component
 * watchers cannot survive into later files. Fake timers also keep stores'
 * `setInterval` polling from leaking real timers across tests; `shouldAdvanceTime`
 * keeps microtasks and fetches flowing.
 */
import { vi, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

let unmountWrappers: () => void = () => undefined

// Capture Vue Test Utils' tracked-wrapper cleanup so teardown order is explicit.
enableAutoUnmount((cleanup) => {
  unmountWrappers = cleanup
})

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
  unmountWrappers()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
