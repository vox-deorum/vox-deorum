import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

/**
 * UI **real** tier: drive the genuine in-process vox-agents Express backend that the
 * UI's apiClient talks to, with the MCP client replaced by the shared MockMcpClient
 * (mock bottom — no mcp-server, bridge, or game). We exercise plain REST over fetch;
 * SSE routes are out of scope here because jsdom has no EventSource.
 *
 * This proves the backend honours the same /api contract the apiClient consumes,
 * without standing up the out-of-process stack.
 */

// Replace the vox-agents mcpClient singleton the route modules import. The alias
// resolves to vox-agents/src/utils/models/mcp-client.ts — the same module the routes
// load — so the mock takes effect for the live app.
vi.mock('@vox/utils/models/mcp-client.js', async () => {
  const helper = await import('../../../tests/helpers/mock-mcp-client.js')
  return helper.mockMcpClientModule()
})

let server: Server
let baseUrl: string

beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  process.env.LOG_LEVEL = 'error'
  const { app } = await import('@vox/web/server.js')
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(async () => {
  const helper = await import('../../../tests/helpers/mock-mcp-client.js')
  helper.installMockMcpClient()
})

describe('live backend (mock MCP)', () => {
  it('serves /api/health', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body).toHaveProperty('service', 'vox-agents-webui')
    expect(body).toHaveProperty('timestamp')
    expect(body).toHaveProperty('version')
  })

  it('serves /api/session/status with no active session', async () => {
    const res = await fetch(`${baseUrl}/api/session/status`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    // Shape the SessionView store reads; exact state depends on registry (idle here).
    expect(body).toBeTypeOf('object')
  })

  it('returns 404 from players-summary when no session is running', async () => {
    const res = await fetch(`${baseUrl}/api/session/players-summary`)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })
})
