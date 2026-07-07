/**
 * @module telepathist/tools/get-conversation-log
 *
 * Telepathist tool for deep-diving into the full LLM conversation for a turn.
 * Organized per agent: combines all steps into one coherent conversation showing
 * system prompt, messages, and responses as a continuous dialogue.
 */

import { z } from 'zod';
import { TelepathistTool, inquiryField } from '../telepathist-tool.js';
import { TelepathistParameters } from '../telepathist-parameters.js';
import { cleanToolArtifacts, formatToolCallText, formatToolResultText } from '../../utils/models/text-cleaning.js';
import { jsonToMarkdown } from '../../utils/tools/json-to-markdown.js';
import type { Span } from '../../utils/telemetry/schema.js';
import { parseSpanAttributes } from '../../utils/telemetry/attributes.js';

const inputSchema = z.object({
  Turn: z.number().describe('The specific turn to retrieve conversation logs for.'),
  Agent: z.string().describe(
    'Specific agent name to fetch.'
  ),
  ...inquiryField
});

type GetConversationLogInput = z.infer<typeof inputSchema>;

/**
 * Returns the full LLM conversation for a turn, organized per agent.
 * Includes system prompts, messages, and responses as a continuous dialogue.
 */
export class GetConversationLogTool extends TelepathistTool<GetConversationLogInput> {
  readonly name = 'get-conversation-log';
  readonly description = 'Get the full LLM conversation log for a specific turn. Shows system prompts, messages exchanged, tool calls, and responses for a specific agent that ran during the turn.';
  readonly inputSchema = inputSchema;
  protected override summarize = true;

  async execute(input: GetConversationLogInput, params: TelepathistParameters): Promise<string[]> {
    const turn = input.Turn;
    if (!params.availableTurns.includes(turn)) {
      return [`Turn ${turn} not found. Available turns: ${params.availableTurns[0]}-${params.availableTurns[params.availableTurns.length - 1]}`];
    }

    const { agents } = await this.getRootSpans(params.db, [turn]);

    if (Object.keys(agents).length === 0) {
      return [`No agent executions found for turn ${turn}.`];
    }

    // Filter to specific agent if requested
    const agentEntries = Object.entries(agents).filter(([name]) => name === input.Agent);

    if (agentEntries.length === 0) {
      const available = Object.keys(agents).join(', ');
      return [`Agent "${input.Agent}" not found for turn ${turn}. Available agents: ${available}`];
    }

    const sections: string[] = [];

    for (const [agentName, agentSpans] of agentEntries) {
      sections.push(`# ${agentName}, Turn ${turn}`);

      // Get all steps for this agent
      const parentIds = agentSpans.map(s => s.spanId);
      const stepSpans = await params.db
        .selectFrom('spans')
        .selectAll()
        .where('parentSpanId', 'in', parentIds)
        .orderBy('startTime', 'asc')
        .execute();

      if (stepSpans.length === 0) {
        sections.push('*No conversation steps recorded.*');
        continue;
      }

      // Track seen messages across steps to avoid repeating the growing conversation history
      const seenMessages = new Set<string>();
      let stepNumber = 0;

      for (const step of stepSpans) {
        const attrs = parseSpanAttributes(step);

        // Collect step content before deciding whether to include it
        const stepSections: string[] = [];
        let hasTextResponse = false;

        // Messages sent to the LLM (deduplicated across steps)
        const messages = attrs['step.messages'];
        if (messages) {
          const conversation = this.formatMessages(messages, seenMessages);
          if (conversation) {
            stepSections.push(conversation);
          }
        }

        // LLM response
        const responses = attrs['step.responses'];
        if (responses) {
          const responseText = this.formatResponses(responses);
          if (responseText) {
            hasTextResponse = true;
            stepSections.push(responseText);
          }
        }

        // Tool calls made during this step
        const toolCallSpans = await params.db
          .selectFrom('spans')
          .selectAll()
          .where('parentSpanId', '=', step.spanId)
          .orderBy('startTime', 'asc')
          .execute();

        const hasToolCalls = toolCallSpans.length > 0;

        if (hasToolCalls) {
          const toolSection = this.formatToolCalls(toolCallSpans);
          if (toolSection) {
            stepSections.push(toolSection);
          }
        }

        // Skip botched steps (no text response and no tool calls)
        if (!hasTextResponse && !hasToolCalls) continue;

        stepNumber++;
        sections.push(`## Step ${stepNumber}`);
        sections.push(...stepSections);
      }
    }

    return sections;
  }

  /** Format messages array for display, skipping previously seen messages */
  private formatMessages(messages: any, seenMessages: Set<string>): string | null {
    try {
      const parsed = typeof messages === 'string' ? JSON.parse(messages) : messages;
      if (!Array.isArray(parsed) || parsed.length === 0) return null;

      const parts: string[] = [];

      for (const msg of parsed) {
        // Deduplicate across steps
        const msgKey = JSON.stringify(msg);
        if (seenMessages.has(msgKey)) continue;
        seenMessages.add(msgKey);

        const role = msg.role || 'unknown';
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

        if (typeof msg.content === 'string') {
          if (!msg.content.trim()) continue;
          parts.push(`**[${roleLabel}]**\n${msg.content}`);
        } else if (Array.isArray(msg.content)) {
          const textParts: string[] = [];
          for (const part of msg.content) {
            if (part.type === 'text' && part.text?.trim()) {
              textParts.push(part.text);
            } else if (part.type === 'tool-call') {
              textParts.push(formatToolCallText(part.toolName, part.args));
            } else if (part.type === 'tool-result') {
              // Model context — render object results as markdown, never JSON (see json-to-markdown).
              const resultText = typeof part.result === 'string' ? part.result : jsonToMarkdown(part.result);
              textParts.push(formatToolResultText(part.toolName ?? 'unknown', resultText));
            }
          }
          if (textParts.length > 0) {
            parts.push(`**[${roleLabel}]**\n${textParts.join('\n')}`);
          }
        }
      }

      return parts.length > 0 ? parts.join('\n\n') : null;
    } catch {
      return null;
    }
  }

  /** Format response messages for display, filtering through cleanToolArtifacts */
  private formatResponses(responses: any): string | null {
    try {
      const parsed = typeof responses === 'string' ? JSON.parse(responses) : responses;
      if (!Array.isArray(parsed) || parsed.length === 0) return null;

      const parts: string[] = [];

      for (const msg of parsed) {
        if (msg.role === 'assistant') {
          if (typeof msg.content === 'string') {
            const cleaned = cleanToolArtifacts(msg.content);
            if (cleaned) {
              parts.push(`**[Assistant Response]**\n${cleaned}`);
            }
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'text') {
                const cleaned = cleanToolArtifacts(part.text ?? '');
                if (cleaned) {
                  parts.push(`**[Assistant]**\n${cleaned}`);
                }
              } else if (part.type === 'reasoning' && part.text?.trim()) {
                parts.push(`**[Reasoning]**\n*${part.text.trim()}*`);
              } else if (part.type === 'tool-call') {
                parts.push(formatToolCallText(part.toolName, part.args));
              }
            }
          }
        }
      }

      return parts.length > 0 ? parts.join('\n\n') : null;
    } catch {
      return null;
    }
  }

  /** Format tool call spans using shared formatting functions */
  private formatToolCalls(spans: Span[]): string | null {
    const parts: string[] = [];

    for (const span of spans) {
      const toolName = span.name.replace(/^(mcp-tool\.|simple-tool\.)/, '');
      const input = this.getToolInput(span);
      const output = this.getToolOutput(span);

      if (input) {
        parts.push(formatToolCallText(toolName, input));
      }

      if (output) {
        const formattedOutput = this.formatToolOutput(toolName, output);
        parts.push(formatToolResultText(toolName, formattedOutput));
      }
    }

    return parts.length > 0 ? parts.join('\n\n') : null;
  }
}
