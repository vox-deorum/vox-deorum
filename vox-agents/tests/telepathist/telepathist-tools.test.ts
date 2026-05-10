/**
 * Tests for telepathist tools using real telemetry database records.
 * Validates the data extraction pipeline against actual game session data.
 * Skips gracefully if the telemetry database is not available.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Mock agent-registry to break circular dependency chain:
// telepathist-tool → VoxContext → agent-registry → strategist → VoxAgent → VoxContext
vi.mock('../../src/infra/agent-registry.js', () => ({
  agentRegistry: {
    get: () => undefined,
    register: () => true,
    has: () => false,
    initializeDefaults: () => {},
    getAll: () => [],
    getNames: () => [],
    size: () => 0,
  }
}));
import {
  createTelepathistParameters,
  type TelepathistParameters
} from '../../src/telepathist/telepathist-parameters.js';
import { parseDatabaseIdentifier } from '../../src/utils/telemetry/identifier-parser.js';
import { TelepathistTool } from '../../src/telepathist/telepathist-tool.js';
import { GetSituationTool } from '../../src/telepathist/tools/get-situation.js';
import { GetDecisionTool } from '../../src/telepathist/tools/get-decision.js';
import { GetConversationLogTool } from '../../src/telepathist/tools/get-conversation-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../../telemetry/upload');

/** Find the first telemetry .db file in upload/, excluding .telepathist.db companion files */
function findTelemetryDb(): string | undefined {
  if (!fs.existsSync(uploadDir)) return undefined;
  const files = fs.readdirSync(uploadDir);
  const dbFile = files.find(f => f.endsWith('.db') && !f.includes('.telepathist.'));
  return dbFile ? path.join(uploadDir, dbFile) : undefined;
}

const telemetryDbPath = findTelemetryDb();
const dbExists = !!telemetryDbPath;

let params: TelepathistParameters;

beforeAll(async () => {
  if (!dbExists || !telemetryDbPath) return;
  const parsedId = parseDatabaseIdentifier(telemetryDbPath);
  params = await createTelepathistParameters(telemetryDbPath, parsedId);
});

afterAll(async () => {
  if (params?.close) {
    await params.close();
  }
});

// --- parseTurns helper tests (via test subclass) ---

/** Minimal concrete subclass to expose protected parseTurns for testing */
class TestTool extends TelepathistTool<{ Turns: string }> {
  readonly name = 'test-tool';
  readonly description = 'Test tool';
  readonly inputSchema = z.object({ Turns: z.string() });
  async execute() { return []; }

  public testParseTurns(turns: string, available: number[], maxLength?: number) {
    return this.parseTurns(turns, available, maxLength);
  }
}

describe('TelepathistTool.parseTurns', () => {
  const tool = new TestTool();
  const available = [0, 5, 10, 15, 20, 25, 30];

  it('should parse a single turn', () => {
    expect(tool.testParseTurns('10', available)).toEqual([10]);
  });

  it('should parse comma-separated turns', () => {
    expect(tool.testParseTurns('5,15,25', available)).toEqual([5, 15, 25]);
  });

  it('should parse a range', () => {
    expect(tool.testParseTurns('10-25', available)).toEqual([10, 15, 20, 25]);
  });

  it('should filter to available turns only', () => {
    expect(tool.testParseTurns('7', available)).toEqual([]);
    expect(tool.testParseTurns('5,7,10', available)).toEqual([5, 10]);
  });

  it('should respect maxLength', () => {
    const result = tool.testParseTurns('0-30', available, 3);
    expect(result).toHaveLength(3);
    expect(result).toEqual([0, 5, 10]);
  });

  it('should handle non-numeric input', () => {
    expect(tool.testParseTurns('abc', available)).toEqual([]);
  });
});

// --- Tests requiring the telemetry database ---

describe.skipIf(!dbExists)('createTelepathistParameters', () => {
  it('should extract game metadata from the database', () => {
    expect(params.availableTurns.length).toBeGreaterThan(0);
    expect(params.civilizationName).not.toBe('Unknown');
    expect(params.leaderName).not.toBe('Unknown');
    expect(params.playerID).toBeGreaterThanOrEqual(0);
    expect(params.gameID).toBeTruthy();
  });

  it('should set turn to the last available turn', () => {
    const lastTurn = params.availableTurns[params.availableTurns.length - 1];
    expect(params.turn).toBe(lastTurn);
  });

  it('should have sorted available turns', () => {
    for (let i = 1; i < params.availableTurns.length; i++) {
      expect(params.availableTurns[i]).toBeGreaterThan(params.availableTurns[i - 1]);
    }
  });

  it('should provide working database connections', async () => {
    const result = await params.db
      .selectFrom('spans')
      .select(params.db.fn.count<number>('id').as('count'))
      .executeTakeFirstOrThrow();
    expect(result.count).toBeGreaterThan(0);
  });
});

describe.skipIf(!dbExists)('GetSituationTool (default mode)', () => {
  const tool = new GetSituationTool();

  it('should return summaries for a single turn', async () => {
    const turn = params.availableTurns[0];
    const sections = await tool.execute({ Turns: String(turn) }, params);
    expect(sections.length).toBeGreaterThan(0);
    const combined = sections.join('\n');
    expect(combined.length).toBeGreaterThan(0);
  });

  it('should return summaries for a range of turns', async () => {
    const first = params.availableTurns[0];
    const last = params.availableTurns[Math.min(5, params.availableTurns.length - 1)];
    const sections = await tool.execute({ Turns: `${first}-${last}` }, params);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('should return "No turns found" for out-of-range turn', async () => {
    const sections = await tool.execute({ Turns: '99999' }, params);
    expect(sections).toEqual(['No turns found in the requested range.']);
  });
});

describe.skipIf(!dbExists)('GetSituationTool (detailed mode)', () => {
  const tool = new GetSituationTool();

  it('should reconstruct game state for a valid turn', async () => {
    const turn = params.availableTurns[0];
    const sections = await tool.execute({ Turns: String(turn), Detailed: true }, params);
    expect(sections.length).toBeGreaterThan(0);
    const combined = sections.join('\n');
    expect(combined).toContain(`# Turn ${turn}`);
  });

  it('should filter by specific categories', async () => {
    const turn = params.availableTurns[0];
    const sections = await tool.execute({ Turns: String(turn), Detailed: true, Categories: ['players'] }, params);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('should reject invalid categories', async () => {
    const turn = params.availableTurns[0];
    const sections = await tool.execute({ Turns: String(turn), Detailed: true, Categories: ['nonexistent'] }, params);
    expect(sections[0]).toContain('Invalid categories');
  });

  it('should handle multiple turns', async () => {
    if (params.availableTurns.length < 2) return;
    const turns = params.availableTurns.slice(0, 2);
    const sections = await tool.execute({ Turns: turns.join(','), Detailed: true }, params);
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it('should return "No turns found" for out-of-range turn', async () => {
    const sections = await tool.execute({ Turns: '99999', Detailed: true }, params);
    expect(sections).toEqual(['No turns found in the requested range.']);
  });
});

describe.skipIf(!dbExists)('GetDecisionTool (default mode)', () => {
  const tool = new GetDecisionTool();

  it('should return summaries for a valid turn', async () => {
    const turn = params.availableTurns[0];
    const sections = await tool.execute({ Turns: String(turn) }, params);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('should return "No turns found" for out-of-range turn', async () => {
    const sections = await tool.execute({ Turns: '99999' }, params);
    expect(sections).toEqual(['No turns found in the requested range.']);
  });
});

describe.skipIf(!dbExists)('GetDecisionTool (detailed mode)', () => {
  const tool = new GetDecisionTool();

  it('should extract decisions for a valid turn', async () => {
    const turn = params.availableTurns[0];
    const sections = await tool.execute({ Turns: String(turn), Detailed: true }, params);
    expect(sections.length).toBeGreaterThan(0);
    const combined = sections.join('\n');
    expect(combined).toContain(`# Turn ${turn}`);
  });

  it('should include agents involved section when agents ran', async () => {
    const turn = params.availableTurns[0];
    const sections = await tool.execute({ Turns: String(turn), Detailed: true }, params);
    const combined = sections.join('\n');
    if (!combined.includes('No agent executions found')) {
      expect(combined).toContain('Agents Involved');
    }
  });

  it('should return "No turns found" for out-of-range turn', async () => {
    const sections = await tool.execute({ Turns: '99999', Detailed: true }, params);
    expect(sections).toEqual(['No turns found in the requested range.']);
  });
});

describe.skipIf(!dbExists)('GetConversationLogTool', () => {
  const tool = new GetConversationLogTool();

  it('should report available agents when requested agent not found', async () => {
    const turn = params.availableTurns[0];
    const sections = await tool.execute({ Turn: turn, Agent: 'nonexistent-agent' }, params);
    const combined = sections.join('\n');
    expect(combined).toContain('not found');
    expect(combined).toContain('Available agents');
  });

  it('should report available turns for invalid turn number', async () => {
    const sections = await tool.execute({ Turn: 99999, Agent: 'any-agent' }, params);
    const combined = sections.join('\n');
    expect(combined).toContain('not found');
    expect(combined).toContain('Available turns');
  });

  it('should return conversation data for a valid turn and agent', async () => {
    // Discover available agents dynamically from the first turn
    const turn = params.availableTurns[0];
    const discoverSections = await tool.execute({ Turn: turn, Agent: 'nonexistent' }, params);
    const discoverText = discoverSections.join('\n');

    // Extract agent names from "Available agents: x, y, z" message
    const agentMatch = discoverText.match(/Available agents: (.+)/);
    if (!agentMatch) return; // No agents available for this turn

    const agentNames = agentMatch[1].split(', ').map(s => s.trim());
    if (agentNames.length === 0) return;

    const sections = await tool.execute({ Turn: turn, Agent: agentNames[0] }, params);
    const combined = sections.join('\n');
    expect(combined).toContain(agentNames[0]);
    expect(combined).toContain(`Turn ${turn}`);
  });
});
