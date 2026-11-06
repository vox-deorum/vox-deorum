/**
 * Global UI test setup.
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  unmountWrappers()
  // Some tests switch back to real timers themselves; flushing then would throw.
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
