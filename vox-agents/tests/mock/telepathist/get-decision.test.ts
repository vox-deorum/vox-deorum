/**
 * Tests for GetDecisionTool detailed mode (src/telepathist/tools/get-decision.ts) against
 * an in-memory telemetry fixture. The fixture models legacy recordings where a rejected
 * decision call (an isError tool.output) is still stored with an OK span status, and checks
 * that the tool leaves such calls out of the decisions section. Kept separate from
 * telepathist-tools.test.ts because that file's agent-registry mock reports every agent as
 * unknown, while this flow needs the strategist to resolve.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Kysely } from 'kysely';

// Mock agent-registry to break circular dependency chain:
// telepathist-tool → VoxContext → agent-registry → strategist → VoxAgent → VoxContext
// (same seam as telepathist-tools.test.ts, but resolving simple-strategist so the
// detailed-mode agent sections render).
vi.mock('../../../src/infra/agent-registry.js', () => ({
  agentRegistry: {
    get: (name: string) => (name === 'simple-strategist' ? { description: 'Test strategist' } : undefined),
    register: () => true,
    has: (name: string) => name === 'simple-strategist',
    initializeDefaults: () => {},
    getAll: () => [],
  }
}));

import { GetDecisionTool } from '../../../src/telepathist/tools/get-decision.js';
import type { TelepathistParameters } from '../../../src/telepathist/telepathist-parameters.js';
import type { TelemetryDatabase } from '../../../src/utils/telemetry/schema.js';
import { createTelemetryDb, type SpanSeed } from '../../helpers/telemetry-db.js';

const TURN = 12;
const controlledDatabases: Kysely<TelemetryDatabase>[] = [];

/** Build the span seeds for one turn: root, agent span, step span, and two set-strategy calls. */
function decisionSpans(): SpanSeed[] {
  const traceId = `trace-${TURN}`;
  return [
    { turn: TURN, traceId, spanId: 'root', name: `strategist.turn.${TURN}` },
    { turn: TURN, traceId, spanId: 'agent', parentSpanId: 'root', name: 'agent.simple-strategist' },
    { turn: TURN, traceId, spanId: 'step', parentSpanId: 'agent', name: `simple-strategist.turn.${TURN}.step.1` },
    {
      turn: TURN, traceId, spanId: 'call-accepted', parentSpanId: 'step', name: 'mcp-tool.set-strategy',
      attributes: {
        'tool.input': JSON.stringify({ GrandStrategy: 'ACCEPTED_MARKER', Rationale: 'r1' }),
        'tool.output': JSON.stringify(true),
      },
    },
    {
      turn: TURN, traceId, spanId: 'call-rejected', parentSpanId: 'step', name: 'mcp-tool.set-strategy',
      attributes: {
        'tool.input': JSON.stringify({ GrandStrategy: 'REJECTED_MARKER', Rationale: 'r2' }),
        'tool.output': JSON.stringify({ isError: true, content: [{ type: 'text', text: 'bad' }] }),
      },
    },
  ];
}

/** Create TelepathistParameters over an in-memory telemetry DB seeded with the decision spans. */
function createDecisionTelemetryParams(): TelepathistParameters {
  const { db } = createTelemetryDb(decisionSpans());
  controlledDatabases.push(db);

  return {
    playerID: 1,
    gameID: 'controlled-game',
    turn: TURN,
    databasePath: '/tmp/controlled-telemetry.db',
    db,
    telepathistDb: {} as any,
    civilizationName: 'Rome',
    leaderName: 'Augustus Caesar',
    availableTurns: [TURN],
  } as TelepathistParameters;
}

afterEach(async () => {
  await Promise.all(controlledDatabases.splice(0).map((db) => db.destroy()));
});

describe('GetDecisionTool (detailed mode, legacy telemetry)', () => {
  it('should include a decision whose output succeeded and skip one whose recorded output is an error result', async () => {
    const params = createDecisionTelemetryParams();

    const sections = await new GetDecisionTool().execute({ Turns: String(TURN), Detailed: true }, params);
    const combined = sections.join('\n');

    expect(combined).toContain('ACCEPTED_MARKER');
    expect(combined).not.toContain('REJECTED_MARKER');
  });
});
