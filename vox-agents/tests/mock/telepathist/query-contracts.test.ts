/**
 * Deterministic public query-tool contracts over in-memory telemetry SQLite databases.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';

vi.mock('../../../src/infra/agent-registry.js', () => ({
  agentRegistry: {
    get: () => undefined,
    register: () => true,
    has: () => false,
    initializeDefaults: () => {},
    getAll: () => [],
  },
}));

import { GetConversationLogTool } from '../../../src/telepathist/tools/get-conversation-log.js';
import type { TelepathistParameters, TelepathistDatabase } from '../../../src/telepathist/telepathist-parameters.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';
import { createTelemetryDb, type SpanSeed } from '../../helpers/telemetry-db.js';

interface QueryFixture {
  params: TelepathistParameters;
}

const databases: Array<Kysely<any>> = [];

/** Create real SQLite telemetry and analysis databases for public query-tool calls. */
function createQueryFixture(spans: SpanSeed[], availableTurns = [10]): QueryFixture {
  const { db } = createTelemetryDb(spans);

  const analysisSqlite = new Database(':memory:');
  analysisSqlite.exec(`
    CREATE TABLE summary_cache (
      cacheKey TEXT PRIMARY KEY,
      result TEXT NOT NULL,
      model TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);

  const telepathistDb = new Kysely<TelepathistDatabase>({ dialect: new SqliteDialect({ database: analysisSqlite }) });
  databases.push(db, telepathistDb);

  const params = {
    playerID: 0,
    gameID: 'query-fixture',
    turn: availableTurns[availableTurns.length - 1] ?? 0,
    databasePath: '/tmp/query-fixture.db',
    db,
    telepathistDb,
    civilizationName: 'Rome',
    leaderName: 'Augustus',
    availableTurns,
  } as TelepathistParameters;

  return { params };
}

/** Return root, nested agent, and response rows for one agent execution. */
function makeAgentSpans(options: {
  rootName: string;
  rootSpanId: string;
  traceId: string;
  agentName: string;
  agentSpanId: string;
  stepSpanId: string;
  startTime: number;
  response: string;
  turn?: number;
}): SpanSeed[] {
  const turn = options.turn ?? 10;
  return [
    {
      turn,
      traceId: options.traceId,
      spanId: options.rootSpanId,
      parentSpanId: null,
      name: options.rootName,
      startTime: options.startTime,
    },
    {
      turn,
      traceId: options.traceId,
      spanId: options.agentSpanId,
      parentSpanId: options.rootSpanId,
      name: `agent.${options.agentName}`,
      startTime: options.startTime + 1,
    },
    {
      turn,
      traceId: options.traceId,
      spanId: options.stepSpanId,
      parentSpanId: options.agentSpanId,
      name: `agent.${options.agentName}.step.1`,
      startTime: options.startTime + 2,
      attributes: {
        'step.responses': JSON.stringify([{ role: 'assistant', content: options.response }]),
      },
    },
  ];
}

/** Return one detached agent root and its response step in a separate trace. */
function makeDetachedAgentSpans(options: {
  agentName: string;
  spanId: string;
  stepSpanId: string;
  traceId: string;
  startTime: number;
  response: string;
}): SpanSeed[] {
  return [
    {
      turn: 10,
      traceId: options.traceId,
      spanId: options.spanId,
      parentSpanId: null,
      name: `agent.${options.agentName}`,
      startTime: options.startTime,
    },
    {
      turn: 10,
      traceId: options.traceId,
      spanId: options.stepSpanId,
      parentSpanId: options.spanId,
      name: `agent.${options.agentName}.step.1`,
      startTime: options.startTime + 1,
      attributes: {
        'step.responses': JSON.stringify([{ role: 'assistant', content: options.response }]),
      },
    },
  ];
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe('telepathist public query contracts', () => {
  it('should use the latest turn root and include requested detached agent traffic', async () => {
    const spans = [
      ...makeAgentSpans({
        rootName: 'strategist.turn.10', rootSpanId: 'root-old', traceId: 'trace-old',
        agentName: 'strategist', agentSpanId: 'agent-old', stepSpanId: 'step-old',
        startTime: 10, response: 'OLD_ROOT_RESPONSE_SENTINEL',
      }),
      ...makeAgentSpans({
        rootName: 'strategist.turn.10', rootSpanId: 'root-new', traceId: 'trace-new',
        agentName: 'strategist', agentSpanId: 'agent-new', stepSpanId: 'step-new',
        startTime: 20, response: 'LATEST_ROOT_RESPONSE_SENTINEL',
      }),
      ...makeAgentSpans({
        rootName: 'strategist.turn.11', rootSpanId: 'root-other-turn', traceId: 'trace-other-turn',
        agentName: 'strategist', agentSpanId: 'agent-other-turn', stepSpanId: 'step-other-turn',
        startTime: 40, response: 'OTHER_TURN_RESPONSE_SENTINEL', turn: 11,
      }),
      ...makeDetachedAgentSpans({
        agentName: 'diplomatic-analyst', spanId: 'detached-agent', traceId: 'trace-detached',
        stepSpanId: 'detached-step', startTime: 30, response: 'DETACHED_AGENT_RESPONSE_SENTINEL',
      }),
    ];
    const { params } = createQueryFixture(spans);
    const tool = new GetConversationLogTool();

    const strategistResult = (await tool.execute({ Turn: 10, Agent: 'strategist' }, params)).join('\n');
    const detachedResult = (await tool.execute({ Turn: 10, Agent: 'diplomatic-analyst' }, params)).join('\n');

    expect(strategistResult).toContain('LATEST_ROOT_RESPONSE_SENTINEL');
    expect(strategistResult).not.toContain('OLD_ROOT_RESPONSE_SENTINEL');
    expect(strategistResult).not.toContain('OTHER_TURN_RESPONSE_SENTINEL');
    expect(detachedResult).toContain('DETACHED_AGENT_RESPONSE_SENTINEL');
    expect(detachedResult).not.toContain('LATEST_ROOT_RESPONSE_SENTINEL');
  });

  it('should summarize an oversized public conversation result', async () => {
    const { params } = createQueryFixture(makeDetachedAgentSpans({
      agentName: 'diplomatic-analyst', spanId: 'agent-large', traceId: 'trace-large',
      stepSpanId: 'step-large', startTime: 10, response: 'OVERSIZED_CALLER_DATA_SENTINEL '.repeat(500),
    }));
    const context = createFakeVoxContext();
    context.setBaseParameters(params);
    context.modelOverrides = { small: { provider: 'openai', name: 'controlled-model' } as any };
    context.callAgent.mockResolvedValue('CONTROLLED_SUMMARY_SENTINEL');

    const queryTool = new GetConversationLogTool().createTool(context.asContext()) as any;
    const result = await queryTool.execute({ Turn: 10, Agent: 'diplomatic-analyst' }, {} as any);

    expect(result).toBe('CONTROLLED_SUMMARY_SENTINEL');
  });
});
