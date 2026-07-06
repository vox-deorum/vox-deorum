/**
 * @module oracle/utils/prompt-extractor
 *
 * Extracts original prompts from telemetry databases.
 * Traverses the span hierarchy (root → agent → step) to recover
 * system prompts, messages, tools, responses, and model information.
 */

import type { Kysely } from 'kysely';
import type { ModelMessage } from 'ai';
import { fuzzy } from 'fast-fuzzy';
import { createLogger } from '../../utils/logger.js';
import { cleanToolArtifacts } from '../../utils/models/text-cleaning.js';
import type { TelemetryDatabase, Span, SpanAttributes } from '../../utils/telemetry/schema.js';
import type { ExtractedPrompt } from '../types.js';

const logger = createLogger('OraclePromptExtractor');

/**
 * Parse JSON attributes from a span record.
 */
function parseAttributes(span: Span): SpanAttributes {
  if (!span.attributes) return {};
  try {
    return typeof span.attributes === 'string'
      ? JSON.parse(span.attributes)
      : span.attributes as SpanAttributes;
  } catch {
    return {};
  }
}

/**
 * Extract the original prompt data for a specific turn from a telemetry database.
 * Traverses: root span (strategist.turn.{N}) → agent span (agent.{name}) → step span
 *
 * @param db - Kysely instance for the telemetry database (read-only)
 * @param turn - The turn number to extract
 * @param targetAgent - Optional specific agent name to target. If not provided, auto-detects strategist.
 * @returns Extracted prompt data, or null if the turn/agent is not found
 */
export async function extractPrompt(
  db: Kysely<TelemetryDatabase>,
  turn: number,
  targetAgent?: string
): Promise<ExtractedPrompt | null> {
  // Find root spans for this turn
  const rootSpans = await db
    .selectFrom('spans')
    .selectAll()
    .where('turn', '=', turn)
    .where('parentSpanId', 'is', null)
    .orderBy('startTime', 'asc')
    .execute();

  if (rootSpans.length === 0) {
    logger.warn(`No root spans found for turn ${turn}`);
    return null;
  }

  // Use the last valid root span (earlier ones are botched retries)
  const turnRootPattern = /^strategist\.turn\.\d+$/;
  const turnRoots = rootSpans.filter(s => turnRootPattern.test(s.name));
  const validRoot = turnRoots.length > 0 ? turnRoots[turnRoots.length - 1] : null;

  if (!validRoot) {
    logger.warn(`No strategist.turn root span found for turn ${turn}`);
    return null;
  }

  // Find agent spans within this trace
  const agentPattern = /^agent\.([a-z][-a-z]*)$/;
  const traceSpans = await db
    .selectFrom('spans')
    .selectAll()
    .where('traceId', '=', validRoot.traceId)
    .where('parentSpanId', 'is not', null)
    .orderBy('startTime', 'asc')
    .execute();

  // Group agent spans by name
  const agentSpans = new Map<string, Span[]>();
  for (const span of traceSpans) {
    const match = span.name.match(agentPattern);
    if (match) {
      const name = match[1];
      if (!agentSpans.has(name)) agentSpans.set(name, []);
      agentSpans.get(name)!.push(span);
    }
  }

  // Select the target agent
  let agentName: string;
  let selectedAgentSpans: Span[];

  if (targetAgent) {
    if (!agentSpans.has(targetAgent)) {
      const available = Array.from(agentSpans.keys()).join(', ');
      logger.warn(`Agent "${targetAgent}" not found for turn ${turn}. Available: ${available}`);
      return null;
    }
    agentName = targetAgent;
    selectedAgentSpans = agentSpans.get(targetAgent)!;
  } else {
    // Auto-detect: prefer strategist agents
    const strategistKey = Array.from(agentSpans.keys()).find(name =>
      name.includes('strategist')
    );
    if (strategistKey) {
      agentName = strategistKey;
      selectedAgentSpans = agentSpans.get(strategistKey)!;
    } else if (agentSpans.size > 0) {
      // Fall back to first agent
      const [firstKey, firstSpans] = agentSpans.entries().next().value!;
      agentName = firstKey;
      selectedAgentSpans = firstSpans;
    } else {
      logger.warn(`No agent spans found for turn ${turn}`);
      return null;
    }
  }

  // Get the agent's model from its span attributes
  const agentAttrs = parseAttributes(selectedAgentSpans[0]);
  const modelString = agentAttrs['model'] as string || '';

  // Find step spans (children of agent spans)
  const agentSpanIds = selectedAgentSpans.map(s => s.spanId);
  const stepSpans = await db
    .selectFrom('spans')
    .selectAll()
    .where('parentSpanId', 'in', agentSpanIds)
    .orderBy('startTime', 'asc')
    .execute();

  if (stepSpans.length === 0) {
    logger.warn(`No step spans found for agent ${agentName} at turn ${turn}`);
    return null;
  }

  // Extract from the first step span (we only replay the initial prompt)
  const firstStep = stepSpans[0];
  const stepAttrs = parseAttributes(firstStep);

  // Parse messages
  const rawMessages = parseJson(stepAttrs['step.messages']);
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    logger.warn(`No messages found in first step for agent ${agentName} at turn ${turn}`);
    return null;
  }

  // Split system prompt parts from conversation messages
  const system: string[] = [];
  const messages: ModelMessage[] = [];

  for (const msg of rawMessages) {
    if (msg.role === 'system') {
      system.push(extractTextContent(msg.content));
    } else {
      messages.push(msg as ModelMessage);
    }
  }

  // Parse tools
  const rawTools = parseJson(stepAttrs['step.tools']);
  const activeTools: string[] = Array.isArray(rawTools) ? rawTools : [];
  if (activeTools.length == 0) {
    logger.warn(`Failed to parse active tools for agent ${agentName} at turn ${turn}`);
  }

  // Use model from step span if not on agent span
  const stepModel = stepAttrs['model'] as string || '';
  const finalModelString = modelString || stepModel;

  // Framing is recorded explicitly (step.tool_framing). Read the explicit value.
  const rawFraming = stepAttrs['step.tool_framing'];
  const framing = rawFraming === 'action' || rawFraming === 'tool' ? rawFraming : undefined;

  return {
    system,
    messages,
    activeTools,
    modelString: finalModelString,
    agentName,
    framing,
  };
}

/**
 * Check whether a turn's telemetry contains a tool call whose Rationale arg
 * fuzzy-matches the given CSV rationale string.
 *
 * Traverses: root span → agent spans → step spans → step.responses → tool calls.
 *
 * @returns true if any tool call's Rationale arg matches above the threshold
 */
export async function findTurnByRationale(
  db: Kysely<TelemetryDatabase>,
  turn: number,
  csvRationale: string,
  threshold = 0.75
): Promise<boolean> {
  // Find root spans for this turn (same pattern as extractPrompt)
  const rootSpans = await db
    .selectFrom('spans')
    .selectAll()
    .where('turn', '=', turn)
    .where('parentSpanId', 'is', null)
    .orderBy('startTime', 'asc')
    .execute();

  const turnRootPattern = /^strategist\.turn\.\d+$/;
  const turnRoots = rootSpans.filter(s => turnRootPattern.test(s.name));
  const validRoot = turnRoots.length > 0 ? turnRoots[turnRoots.length - 1] : null;
  if (!validRoot) return false;

  // Get all child spans in this trace
  const traceSpans = await db
    .selectFrom('spans')
    .selectAll()
    .where('traceId', '=', validRoot.traceId)
    .where('parentSpanId', 'is not', null)
    .execute();

  // Collect agent span IDs
  const agentPattern = /^agent\.([a-z][-a-z]*)$/;
  const agentSpanIds = traceSpans
    .filter(s => agentPattern.test(s.name))
    .map(s => s.spanId);

  if (agentSpanIds.length === 0) return false;

  // Get all step spans (children of agent spans)
  const stepSpans = traceSpans.filter(s => s.parentSpanId && agentSpanIds.includes(s.parentSpanId));

  // Query tool call spans (children of step spans) for Rationale in tool.input
  const stepSpanIds = stepSpans.map(s => s.spanId);
  if (stepSpanIds.length === 0) return false;

  const toolCallSpans = await db
    .selectFrom('spans')
    .selectAll()
    .where('parentSpanId', 'in', stepSpanIds)
    .execute();

  let foundAnyRationale = false;
  for (const span of toolCallSpans) {
    const attrs = parseAttributes(span);
    if (!attrs['tool.input']) continue;

    const input = parseJson(attrs['tool.input']) as Record<string, unknown> | undefined;
    if (!input?.Rationale) continue;

    foundAnyRationale = true;
    const score = fuzzy(csvRationale, input.Rationale as string);
    if (score >= threshold) return true;
  }

  if (!foundAnyRationale) {
    logger.warn(`No tool calls with Rationale found in turn ${turn}`);
  }

  return false;
}

/** Safely parse JSON, returning the value as-is if already parsed */
function parseJson(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/** Extract text content from a message content field */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part: Record<string, unknown>) => part.type === 'text')
      .map((part: Record<string, unknown>) => part.text)
      .join('\n');
  }
  return '';
}