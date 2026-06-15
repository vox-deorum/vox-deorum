/**
 * Tests for the session-level metadata wrappers (src/utils/game/metadata.ts) over the MCP
 * get-metadata / set-metadata tools. Uses the shared mcpClient fixture — no live server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, textResult } from '../helpers/mock-mcp-client.js';

vi.mock('../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { getMetadata, setMetadata } from '../../src/utils/game/metadata.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});

describe('getMetadata', () => {
  it('passes the key and reads content[0].text', async () => {
    mcp.respondWith('get-metadata', textResult('cycle-3'));

    expect(await getMetadata('seating')).toBe('cycle-3');
    expect(mcp.calls('get-metadata')[0].args).toEqual({ Key: 'seating' });
  });

  it('returns "" when the value is absent or the shape is unexpected', async () => {
    mcp.respondWith('get-metadata', {}); // no content array
    expect(await getMetadata('missing')).toBe('');
  });
});

describe('setMetadata', () => {
  it('stringifies numeric values and passes Key/Value', async () => {
    mcp.respondWith('set-metadata', textResult('ok'));

    await setMetadata('seed', 12345);

    expect(mcp.calls('set-metadata')[0].args).toEqual({ Key: 'seed', Value: '12345' });
  });

  it('passes through string values unchanged', async () => {
    mcp.respondWith('set-metadata', textResult('ok'));

    await setMetadata('experiment', 'baseline');

    expect(mcp.calls('set-metadata')[0].args).toEqual({ Key: 'experiment', Value: 'baseline' });
  });
});
