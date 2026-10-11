/**
 * Tests for the game reference writer (src/knowledge/reference.ts): one set of listing calls,
 * a folder that appears only after every listing succeeds, single-item detailed results, and
 * skipping a folder an earlier session wrote.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorResult, installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { writeGameReference } from '../../../src/knowledge/reference.js';
import { config } from '../../../src/utils/config.js';
import { workspaceReferencePath } from '../../../src/utils/workspace/player-workspace.js';

const tools = ['get-technology', 'get-policy', 'get-building', 'get-unit'];

let mcp: ReturnType<typeof installMockMcpClient>;
let telemetryDir: string;
let savedTelemetryDir: string | undefined;

beforeEach(() => {
  mcp = installMockMcpClient();
  savedTelemetryDir = config.telemetryDir;
  telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-reference-'));
  config.telemetryDir = telemetryDir;
  for (const tool of tools) {
    mcp.respondWith(tool, structuredResult({ Count: 2, Items: [{ Type: `${tool}-A`, Name: 'Alpha', Cost: 10 }, { Type: `${tool}-B`, Name: 'Beta', Cost: 20 }] }));
  }
});

afterEach(() => {
  config.telemetryDir = savedTelemetryDir as string;
  fs.rmSync(telemetryDir, { recursive: true, force: true });
});

/** Every entry in the reference folder's parent, to catch leftover temporary folders. */
function gameFolderEntries(gameID: string): string[] {
  const parent = path.dirname(workspaceReferencePath(gameID));
  return fs.existsSync(parent) ? fs.readdirSync(parent) : [];
}

describe('writeGameReference', () => {
  it('should write Markdown and JSON for every listing with one call per tool', async () => {
    await expect(writeGameReference('G1')).resolves.toBe(true);

    for (const tool of tools) {
      expect(mcp.calls(tool)).toHaveLength(1);
      expect(mcp.calls(tool)[0].args).toEqual({ MaxResults: 5000 });
    }
    const folder = workspaceReferencePath('G1');
    const files = fs.readdirSync(folder).sort();
    expect(files).toHaveLength(8);
    const units = JSON.parse(fs.readFileSync(path.join(folder, 'units.json'), 'utf8'));
    expect(units.map((item: { Type: string }) => item.Type)).toEqual(['get-unit-A', 'get-unit-B']);
    const technologies = fs.readFileSync(path.join(folder, 'technologies.md'), 'utf8');
    expect(technologies).toContain('Alpha');
    expect(technologies).toContain('Beta');
    expect(gameFolderEntries('G1')).toEqual(['reference']);
  });

  it('should render a single detailed item, not only listing rows', async () => {
    mcp.respondWith('get-policy', structuredResult({ Count: 1, Items: [{ Type: 'POLICY_ONLY', Name: 'Only', Branch: 'Tradition', PrereqPolicies: ['Root'] }] }));

    await writeGameReference('G1');

    const policies = fs.readFileSync(path.join(workspaceReferencePath('G1'), 'policies.md'), 'utf8');
    expect(policies).toContain('Only');
    expect(policies).toContain('Tradition');
    expect(policies).toContain('Root');
  });

  it.each([
    ['a returned Error field', structuredResult({ Count: 0, Items: [], Error: 'database not ready' })],
    ['an MCP error result', errorResult('tool failed')],
  ])('should write nothing when a listing returns %s', async (_label, result) => {
    mcp.respondWith('get-building', result);

    await expect(writeGameReference('G1')).rejects.toThrow();

    expect(fs.existsSync(workspaceReferencePath('G1'))).toBe(false);
    expect(gameFolderEntries('G1')).toEqual([]);
  });

  it('should write nothing when a listing call throws', async () => {
    mcp.onTool('get-unit', () => { throw new Error('connection lost'); });

    await expect(writeGameReference('G1')).rejects.toThrow('connection lost');

    expect(fs.existsSync(workspaceReferencePath('G1'))).toBe(false);
  });

  it('should skip every call when the folder already exists', async () => {
    fs.mkdirSync(workspaceReferencePath('G1'), { recursive: true });

    await expect(writeGameReference('G1')).resolves.toBe(false);

    for (const tool of tools) expect(mcp.calls(tool)).toHaveLength(0);
  });
});
