/**
 * @module telepathist/telepathist-tool
 *
 * Abstract base class for Telepathist tools.
 * Wraps createSimpleTool with shared database query helpers for traversing
 * the span hierarchy: turns -> agent spans -> step spans -> tool call spans.
 */

import { Tool as VercelTool } from 'ai';
import { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodType } from 'zod';
import { Kysely } from 'kysely';
import { TelepathistParameters } from './telepathist-parameters.js';
import { createSimpleTool } from '../utils/tools/simple-tools.js';
import { jsonToMarkdown, HeadingConfig } from '../utils/tools/json-to-markdown.js';
import { VoxContext } from '../infra/vox-context.js';
import { buildToolSummaryInstruction, summarizeWithCache } from './summarizer.js';
import { createLogger } from '../utils/logger.js';
import type { TelemetryDatabase, Span, SpanAttributes } from '../utils/telemetry/schema.js';
import type { SummarizerInput } from './summarizer.js';

const logger = createLogger('TelepathistTool');

/** Result from getRootSpans: turn root spans and agent execution spans grouped by name */
export interface RootSpanResult {
  /** The strategist.turn.{N} container spans, keyed by turn number */
  turnRoots: Map<number, Span>;
  /** Agent execution spans grouped by agent name */
  agents: Record<string, Span[]>;
}

/** Minimum result length (in characters) before summarization kicks in */
const summarizeThreshold = 10000;

/** Maximum character size per chunk sent to the summarizer. Sections are grouped respecting this limit. */
const chunkMaxChars = 100_000;

/**
 * Reusable Zod field for the inquiry parameter.
 * Tools that enable summarization should spread this into their inputSchema.
 */
export const inquiryField = {
  Inquiry: z.string().optional().describe(
    'What specific information you want to acquire from this data. Guides the summarizer to focus on factual information.'
  )
};

/**
 * Abstract base class that wraps createSimpleTool with shared database query patterns.
 * Each concrete tool extends this, inheriting DB query helpers and getting
 * automatic simple-tool.{name} telemetry spans.
 */
export abstract class TelepathistTool<TInput = any> {
  /** Tool name used for registration and telemetry */
  abstract readonly name: string;
  /** Human-readable description for the LLM */
  abstract readonly description: string;
  /** Zod schema defining the tool's input */
  abstract readonly inputSchema: ZodType<TInput>;

  /** Whether this tool's results should be summarized via the Summarizer agent. Tools opt in explicitly. */
  protected summarize: boolean = false;

  /** Reference to MCP tool definitions for dynamic markdownConfig lookup */
  protected mcpToolMap?: Map<string, MCPTool>;

  /**
   * Create the AI SDK tool. Captures mcpToolMap from context for dynamic
   * markdownConfig access, then delegates to createSimpleTool for telemetry tracing.
   * Assembles string[] sections into a single result, with chunked summarization
   * when content exceeds chunkMaxChars.
   */
  createTool(context: VoxContext<TelepathistParameters>): VercelTool {
    const separator = '\n\n';

    return createSimpleTool({
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      execute: async (input, params) => {
        // This tool instance is a process-wide singleton shared across every chat, so
        // per-call state (mcpToolMap, the summarize flag toggled by execute/
        // executeDefaultFromSummaries) must not live on `this` — concurrent chats would
        // clobber each other across awaits. Run the call against a per-invocation view
        // whose writes shadow the shared prototype and vanish when it's collected.
        const call = Object.create(this) as this;
        call.mcpToolMap = context.mcpToolMap;

        const sections = await call.execute(input, params);
        const assembled = sections.join(separator);

        if (!call.summarize || assembled.length < summarizeThreshold) {
          return assembled;
        }

        const inquiry = (input as any)?.Inquiry as string | undefined;
        const instruction = buildToolSummaryInstruction(this.name, inquiry);

        if (assembled.length <= chunkMaxChars) {
          // Single-chunk summarization
          logger.info(`Summarizing ${this.name} result (${assembled.length} chars)`, { inquiry });
          const summarizerInput: SummarizerInput = { text: assembled, instruction };
          const summary = await summarizeWithCache(summarizerInput, params, context);
          return summary ?? assembled;
        }

        // Multi-chunk summarization
        const chunks = call.chunkSections(sections, separator);
        logger.info(`Summarizing ${this.name} result in ${chunks.length} chunks (${assembled.length} total chars)`, { inquiry });

        const chunkSummaries: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const summarizerInput: SummarizerInput = { text: chunks[i], instruction: instruction };
          const summary = await summarizeWithCache(summarizerInput, params, context);
          chunkSummaries.push(`# Chunk ${i + 1}/${chunks.length}\n${summary ?? chunks[i]}`);
        }

        return chunkSummaries.join(separator);
      }
    }, context);
  }

  /** Execute the tool with the given input and parameters. Returns sections to be assembled by createTool. */
  abstract execute(input: TInput, params: TelepathistParameters): Promise<string[]>;

  /**
   * Groups adjacent sections into chunks, each no larger than chunkMaxChars.
   * Respects section boundaries: never splits a single section across chunks.
   * If a single section exceeds chunkMaxChars, it becomes its own chunk.
   */
  private chunkSections(sections: string[], separator: string): string[] {
    if (sections.length === 0) return [];

    const chunks: string[] = [];
    let currentParts: string[] = [];
    let currentLength = 0;

    for (const section of sections) {
      const addedLength = currentParts.length > 0
        ? separator.length + section.length
        : section.length;

      if (currentLength + addedLength > chunkMaxChars && currentParts.length > 0) {
        chunks.push(currentParts.join(separator));
        currentParts = [section];
        currentLength = section.length;
      } else {
        currentParts.push(section);
        currentLength += addedLength;
      }
    }

    if (currentParts.length > 0) {
      chunks.push(currentParts.join(separator));
    }

    return chunks;
  }

  // --- Default/detailed mode helper ---

  /**
   * Shared implementation for default mode: read pre-generated summaries from turn_summaries,
   * falling back to detailed mode for missing turns.
   *
   * @param turns - Raw turn string from user input
   * @param availableTurns - Available turns in the telemetry DB
   * @param params - Telepathist parameters with DB connections
   * @param column - Which column to read from turn_summaries
   * @param detailedFallback - Callback to execute detailed mode for missing turns
   * @param buildFallbackInput - Builds the input for the detailed fallback from missing turn numbers
   * @param maxTurns - Maximum number of turns to process
   */
  protected async executeDefaultFromSummaries(
    turns: string,
    availableTurns: number[],
    params: TelepathistParameters,
    column: 'decisions' | 'situation' | 'conversation',
    detailedFallback: (input: any, params: TelepathistParameters) => Promise<string[]>,
    buildFallbackInput: (missingTurns: number[]) => any,
    maxTurns = 20
  ): Promise<string[]> {
    const parsed = this.parseTurns(turns, availableTurns, maxTurns);
    if (parsed.length === 0) return ['No turns found in the requested range.'];

    const summaries = await params.telepathistDb
      .selectFrom('turn_summaries')
      .selectAll()
      .where('turn', 'in', parsed)
      .orderBy('turn', 'asc')
      .execute();

    const sections: string[] = [];
    for (const s of summaries) {
      const value = s[column as keyof typeof s];
      if (value) sections.push(`## Turn ${s.turn}\n${value}`);
    }

    const summarizedTurns = new Set(
      summaries.filter(s => s[column as keyof typeof s]).map(s => s.turn)
    );
    const missing = parsed.filter(t => !summarizedTurns.has(t));
    if (missing.length > 0) {
      logger.info(`Missing ${column} summaries for turns: ${missing.join(', ')}; falling back to detailed mode`);
      this.summarize = true;
      sections.push(...await detailedFallback(buildFallbackInput(missing), params));
    }

    return sections;
  }

  // --- Shared query helpers ---

  /**
   * Parse flexible turn input into number[].
   * Supports single turn ("30"), comma-separated ("10,20,30"), or range ("30-50").
   */
  protected parseTurns(turns: string, available: number[], maxLength = 10): number[] {
    const trimmed = turns.trim();
    let result: number[] = [];

    // Range format: "30-50"
    if (trimmed.includes('-') && !trimmed.includes(',')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        result = available.filter(t => t >= start && t <= end);
      }
    }
    // Comma-separated: "10,20,30"
    else if (trimmed.includes(',')) {
      const requested = trimmed.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      result = available.filter(t => requested.includes(t));
    }
    // Single turn: "30"
    else {
      const single = parseInt(trimmed, 10);
      if (!isNaN(single)) {
        result = available.filter(t => t === single);
      }
    }

    // Trim down to maxLength
    if (result.length > maxLength) result = result.slice(0, maxLength);
    return result;
  }

  /**
   * Get agent spans for given turns, grouped by agent type.
   * Finds the turn root span (strategist.turn.{N}), discovers in-trace agent spans,
   * and also finds fire-and-forget agents with separate traces.
   *
   * @returns RootSpanResult with turn root spans and agent spans grouped by name
   */
  protected async getRootSpans(
    db: Kysely<TelemetryDatabase>,
    turns: number[]
  ): Promise<RootSpanResult> {
    const empty: RootSpanResult = { turnRoots: new Map(), agents: {} };
    if (turns.length === 0) return empty;

    const result: RootSpanResult = { turnRoots: new Map(), agents: {} };
    const turnRootPattern = /^strategist\.turn\.\d+$/;
    // Matches agent.{agentName} spans, excluding step spans (agent.{name}.step.{N})
    const agentPattern = /^agent\.([a-z][-a-z]*)$/;

    for (const turn of turns) {
      // Find all root spans for this turn (parentSpanId is null)
      const rootSpans = await db
        .selectFrom('spans')
        .selectAll()
        .where('turn', '=', turn)
        .where('parentSpanId', 'is', null)
        .orderBy('startTime', 'asc')
        .execute();

      // Find the last turn root span (strategist.turn.{N}) — earlier ones are botched
      const turnRoots = rootSpans.filter(s => turnRootPattern.test(s.name));
      const validRoot = turnRoots.length > 0
        ? turnRoots[turnRoots.length - 1]
        : null;

      if (validRoot) {
        result.turnRoots.set(turn, validRoot);

        // Find all agent spans within this trace (child spans matching agent pattern)
        const traceSpans = await db
          .selectFrom('spans')
          .selectAll()
          .where('traceId', '=', validRoot.traceId)
          .where('parentSpanId', 'is not', null)
          .execute();

        for (const span of traceSpans) {
          const match = span.name.match(agentPattern);
          if (match) {
            const name = match[1];
            if (!result.agents[name]) result.agents[name] = [];
            result.agents[name].push(span);
          }
        }
      }

      // Find fire-and-forget agents (separate traceIds, same turn)
      const detachedRoots = rootSpans.filter(s =>
        !turnRootPattern.test(s.name) &&
        agentPattern.test(s.name)
      );
      for (const span of detachedRoots) {
        const match = span.name.match(agentPattern);
        const agentName = match ? match[1] : span.name.split('.')[1];
        if (!result.agents[agentName]) result.agents[agentName] = [];
        result.agents[agentName].push(span);
      }
    }

    return result;
  }

  /**
   * Get step spans for a specific agent type across the given turns.
   * Steps follow the pattern: {agentName}.turn.{turn}.step.{N}
   */
  protected async getAgentSteps(
    db: Kysely<TelemetryDatabase>,
    turns: number[],
    agentType: string
  ): Promise<Span[]> {
    if (turns.length === 0) return [];

    const { agents } = await this.getRootSpans(db, turns);
    const agentSpans = agents[agentType] || [];
    if (agentSpans.length === 0) return [];

    const parentSpanIds = agentSpans.map((s: Span) => s.spanId);
    return db
      .selectFrom('spans')
      .selectAll()
      .where('parentSpanId', 'in', parentSpanIds)
      .orderBy('startTime', 'asc')
      .execute();
  }

  /**
   * Get MCP tool call spans from step spans.
   * Avoids re-filtering by turn/traceId since steps already have the right scope.
   * Optional toolNames filter for specific tools.
   */
  protected async getToolCallSpans(
    db: Kysely<TelemetryDatabase>,
    stepSpans: Span[],
    toolNames?: string[]
  ): Promise<Span[]> {
    if (stepSpans.length === 0) return [];

    const parentIds = stepSpans.map(s => s.spanId);
    let query = db
      .selectFrom('spans')
      .selectAll()
      .where('parentSpanId', 'in', parentIds)
      .where('name', 'like', 'mcp-tool.%')
      .orderBy('startTime', 'asc');

    if (toolNames && toolNames.length > 0) {
      const prefixedNames = toolNames.map(n => `mcp-tool.${n}`);
      query = query.where('name', 'in', prefixedNames);
    }

    return query.execute();
  }

  /**
   * Extract tool.input from a tool call span (parsed JSON from attributes)
   */
  protected getToolInput(span: Span): any {
    const attrs = this.parseAttributes(span);
    if (!attrs['tool.input']) return undefined;
    try {
      return typeof attrs['tool.input'] === 'string'
        ? JSON.parse(attrs['tool.input'])
        : attrs['tool.input'];
    } catch {
      return attrs['tool.input'];
    }
  }

  /**
   * Extract tool.output from a tool call span (parsed JSON from attributes)
   */
  protected getToolOutput(span: Span): any {
    const attrs = this.parseAttributes(span);
    if (!attrs['tool.output']) return undefined;
    try {
      return typeof attrs['tool.output'] === 'string'
        ? JSON.parse(attrs['tool.output'])
        : attrs['tool.output'];
    } catch {
      return attrs['tool.output'];
    }
  }

  /**
   * Format a tool output using jsonToMarkdown with dynamically looked-up markdownConfig.
   * Reads markdownConfig from mcpToolMap via tool._meta?.markdownConfig.
   */
  protected formatToolOutput(toolName: string, output: any): string {
    if (!output || typeof output !== 'object') return String(output ?? '');

    const mcpTool = this.mcpToolMap?.get(toolName);
    const config = (mcpTool?._meta as any)?.markdownConfig;

    if (Array.isArray(config)) {
      return jsonToMarkdown(output, {
        configs: config.map(level => ({ format: level } as HeadingConfig))
      });
    }

    return jsonToMarkdown(output);
  }

  /**
   * Safely parse JSON attributes from a span
   */
  protected parseAttributes(span: Span): SpanAttributes {
    if (!span.attributes) return {};
    try {
      return typeof span.attributes === 'string'
        ? JSON.parse(span.attributes)
        : span.attributes as SpanAttributes;
    } catch {
      return {};
    }
  }
}
