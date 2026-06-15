/**
 * @module tests/helpers/mock-mcp-client
 *
 * A generalized, reusable mock for the vox-agents `mcpClient` singleton
 * (`src/utils/models/mcp-client.ts`) — the single seam between vox-agents and the MCP
 * server. Replacing it lets any feature that calls MCP tools be unit-tested without a
 * live game, bridge-service, or MCP server: transcript I/O, metadata wrappers, the
 * `wrapMCPTool` execute path, notification handling, and more.
 *
 * ## Usage
 *
 * `vi.mock` is hoisted above imports, so its factory may not close over normal imports.
 * Use the dynamic-import escape hatch so the factory resolves to the same shared mock
 * this module exports:
 *
 * ```ts
 * import { installMockMcpClient, structuredResult } from '../helpers/mock-mcp-client.js';
 *
 * vi.mock('../../src/utils/models/mcp-client.js', async () => {
 *   const helper = await import('../helpers/mock-mcp-client.js');
 *   return helper.mockMcpClientModule();
 * });
 *
 * let mcp: ReturnType<typeof installMockMcpClient>;
 * beforeEach(() => { mcp = installMockMcpClient(); });
 *
 * it('calls a tool', async () => {
 *   mcp.respondWith('get-players', structuredResult([{ Key: 0 }]));
 *   // ...exercise code that calls mcpClient.callTool('get-players', ...)
 *   expect(mcp.calls('get-players')).toHaveLength(1);
 * });
 * ```
 *
 * The relative path `'../helpers/mock-mcp-client.js'` is correct for any test file one
 * level under `tests/` (e.g. `tests/diplomacy/`, `tests/utils/`, `tests/envoy/`).
 */

import { vi } from 'vitest';

/** A registered per-tool handler: receives the call args, returns (or throws) a raw MCP result. */
export type ToolHandler = (args: Record<string, unknown>) => unknown;

/** One recorded `callTool` invocation. */
export interface RecordedCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Hand-written stand-in for the `MCPClient` singleton. Mirrors the full surface the
 * codebase touches (`callTool`, `getTools`, `connect`/`disconnect`/`connected`,
 * `onNotification`/`onToolError`) plus a programmable tool registry and notification
 * emitters for assertions.
 */
export class MockMcpClient {
  private handlers = new Map<string, ToolHandler>();
  private notificationListeners: Array<(data: unknown) => void> = [];
  private toolErrorListeners: Array<(error: { toolName: string; error: unknown }) => void> = [];
  private toolList: unknown[] = [];

  /** Every `callTool` invocation, in order. */
  public callLog: RecordedCall[] = [];

  /** Connection state, toggled by `connect`/`disconnect`. */
  public connected = true;

  /** Dispatch to a registered handler; record the call; throw loudly on an unknown tool. */
  callTool = vi.fn(async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    this.callLog.push({ name, args });
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`MockMcpClient: no handler registered for tool "${name}"`);
    }
    return handler(args);
  });

  getTools = vi.fn(async (): Promise<unknown[]> => this.toolList);

  connect = vi.fn(async (): Promise<void> => {
    this.connected = true;
  });

  disconnect = vi.fn(async (): Promise<void> => {
    this.connected = false;
  });

  onNotification = vi.fn((handler: (data: unknown) => void): void => {
    this.notificationListeners.push(handler);
  });

  onToolError = vi.fn((handler: (error: { toolName: string; error: unknown }) => void): void => {
    this.toolErrorListeners.push(handler);
  });

  // ---- controller helpers (test-facing) ----

  /** Register a handler for `name`. The handler may return a raw MCP result or throw. */
  onTool(name: string, handler: ToolHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  /** Register a constant raw MCP result for `name`. */
  respondWith(name: string, value: unknown): this {
    return this.onTool(name, () => value);
  }

  /** Register `name` to throw, exercising error/retry branches. */
  failWith(name: string, error: Error | string): this {
    const err = typeof error === 'string' ? new Error(error) : error;
    return this.onTool(name, () => {
      throw err;
    });
  }

  /** Set the list returned by `getTools()`. */
  setTools(tools: unknown[]): this {
    this.toolList = tools;
    return this;
  }

  /** Recorded calls, optionally filtered to a single tool name. */
  calls(name?: string): RecordedCall[] {
    return name ? this.callLog.filter((c) => c.name === name) : this.callLog;
  }

  /** Drive a server notification to every registered `onNotification` listener. */
  emitNotification(params: unknown): void {
    for (const listener of this.notificationListeners) listener(params);
  }

  /** Drive a tool error to every registered `onToolError` listener. */
  emitToolError(error: { toolName: string; error: unknown }): void {
    for (const listener of this.toolErrorListeners) listener(error);
  }

  /** Clear all registrations, recorded calls, and mock-fn history; restore connected. */
  reset(): void {
    this.handlers.clear();
    this.notificationListeners = [];
    this.toolErrorListeners = [];
    this.toolList = [];
    this.callLog = [];
    this.connected = true;
    this.callTool.mockClear();
    this.getTools.mockClear();
    this.connect.mockClear();
    this.disconnect.mockClear();
    this.onNotification.mockClear();
    this.onToolError.mockClear();
  }
}

/**
 * The shared mock instance. Both the `vi.mock` factory (via dynamic import) and the test
 * (via static import) resolve to this same object, so programming it in the test affects
 * the singleton the production code imports.
 */
export const mockMcpClient = new MockMcpClient();

/** Module replacement for the `vi.mock` factory — same export surface as `mcp-client.js`. */
export function mockMcpClientModule(): { mcpClient: MockMcpClient; MCPClient: typeof MockMcpClient } {
  return { mcpClient: mockMcpClient, MCPClient: MockMcpClient };
}

/** Reset and return the shared controller. Call in `beforeEach`. */
export function installMockMcpClient(): MockMcpClient {
  mockMcpClient.reset();
  return mockMcpClient;
}

// ---- result-shape helpers (mirror real MCP CallToolResult envelopes) ----

/** Object/array result carried in `structuredContent` (with a JSON text mirror). */
export const structuredResult = (obj: unknown) => ({
  structuredContent: obj,
  content: [{ type: 'text', text: JSON.stringify(obj) }],
});

/** Primitive result carried as a single text content item (booleans/strings/numbers). */
export const textResult = (value: string | boolean | number) => ({
  content: [{ type: 'text', text: String(value) }],
});

/** Legacy `{ Result: ... }` envelope, unwrapped by `normalizeMCPToolResult`. */
export const resultEnvelope = (obj: unknown) => ({ structuredContent: { Result: obj } });

/** Error wrapper (`isError: true`), preserved intact by `normalizeMCPToolResult`. */
export const errorResult = (message: string) => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});
