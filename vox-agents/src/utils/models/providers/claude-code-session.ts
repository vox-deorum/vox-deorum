/**
 * @module utils/models/providers/claude-code-session
 *
 * A live Claude Code CLI query that spans one Vox Deorum agent run, so the CLI calls the run's
 * tools natively while the VD step loop keeps executing them.
 *
 * The run's function tools are served to the CLI through a fresh in-process MCP server named
 * `vox`. When the CLI calls one, its handler parks. The session rewrites the CLI's
 * `mcp__vox__<name>` call into an ordinary client tool call named `<name>` and ends the VD step
 * when the assistant message stops. The AI SDK and VD then execute the tools as for any provider.
 * The next step's prompt ends with those tool results; the session hands them to the parked
 * handlers and keeps streaming the same query, so the CLI sees real tool results in its own
 * context. Text the CLI reads names the tools by their CLI names, so the model does not call a
 * bare `bash` that the CLI cannot find.
 *
 * Anything the session cannot continue (a changed model or tool list, a prompt that does not
 * answer the calls handed out, a finished or failed query) closes the live query and starts a
 * fresh one with the full prompt.
 *
 * This relies on CLI behavior verified with Agent SDK 0.3.293 and ai-sdk-provider-claude-code
 * 4.3.2: every MCP call carries `_meta["claudecode/toolUseId"]` equal to the stream's
 * `toolCallId`, the CLI starts a tool as soon as its block ends (before `message_stop`), and it
 * calls MCP handlers one at a time.
 */

import type {
  JSONValue,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4ToolResultPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import type { McpServerConfig, Query, SDKMessage } from 'ai-sdk-provider-claude-code';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { PreserveClaudeCodeUsageLimitError } from './claude-code-response.js';

/** The MCP server name the CLI sees; its tools surface as `mcp__vox__<name>`. */
export const claudeCodeSessionServerName = 'vox';
/** The prefix the CLI gives every tool of the session's MCP server. */
export const claudeCodeSessionToolPrefix = `mcp__${claudeCodeSessionServerName}__`;
// The CLI rejects tool names longer than 64 characters, prefix included.
const maximumToolNameLength = 64 - claudeCodeSessionToolPrefix.length;
// A VD tool can be a long agent handoff, so the CLI must wait for its result.
const mcpToolTimeout = '3600000';
const endedResult: CallToolResult = {
  isError: true,
  content: [{ type: 'text', text: 'The run ended before this call ran.' }],
};

/** Settings fields the session adds to the base Claude Code settings for one query. */
export interface ClaudeCodeSessionPatch {
  mcpServers: Record<string, McpServerConfig>;
  /** The CLI names of the session's tools, to add to `allowedTools`. */
  mcpToolNames: string[];
  env: Record<string, string>;
  persistSession: false;
  /** Receives the query so the session can stop the CLI on close. */
  onQuery: (query: Query) => void;
  /** Receives raw usage-limit errors for whichever step is currently streaming. */
  preserveUsageLimitError: PreserveClaudeCodeUsageLimitError;
}

/** What one step needs to stream through the session. */
export interface ClaudeCodeSessionStreamOptions {
  /** A stable signature of the model configuration; a change starts a fresh query. */
  key: string;
  /** Build the provider model from the base settings merged with the patch. */
  open: (patch: ClaudeCodeSessionPatch) => LanguageModelV4;
  /** The current step's receiver for raw usage-limit errors. */
  preserveUsageLimitError?: PreserveClaudeCodeUsageLimitError;
  /** The CLI built-in tools the configuration grants (host tools); every other built-in is refused. */
  hostTools?: readonly string[];
}

/** Token counts accumulated over one VD step. */
interface StepUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** The state of one live CLI query. */
interface LiveQuery {
  server: Server;
  query?: Query;
  reader?: ReadableStreamDefaultReader<LanguageModelV4StreamPart>;
  /** A read left outstanding when the last step ended; the next step consumes it. */
  pendingRead?: ReturnType<ReadableStreamDefaultReader<LanguageModelV4StreamPart>["read"]>;
  key: string;
  toolNames: string;
  hostTools: readonly string[];
  /** Rewrites tool mentions in text the CLI reads to the CLI tool names. */
  qualify: (text: string) => string;
  /** Set when the CLI exposes tools beyond the session's and the host tools. */
  failure?: Error;
  /** Parked MCP handlers, keyed by tool use id. */
  parked: Map<string, (result: CallToolResult) => void>;
  /** Results delivered before their handler was called. */
  ready: Map<string, CallToolResult>;
  /** The tool call ids handed to VD in the current or last step, in call order. */
  handedOut: string[];
  /** Session tool calls started in the current assistant message. */
  expected: number;
  /** Session tool calls of the current message already passed to VD. */
  emitted: number;
  /** Whether the current assistant message has stopped. */
  stopped: boolean;
  usage: StepUsage;
  /** Usage of the current assistant message, added to the step's usage when it stops. */
  message: StepUsage;
  /** Host tool parts held until their result arrives, keyed by tool call id. */
  hostCalls: Map<string, LanguageModelV4StreamPart[]>;
  /** Set when the CLI query has finished its answer; the next step starts fresh. */
  idle: boolean;
  closed: boolean;
}

/**
 * Return the tools a CLI reports in its init message that the session did not grant: anything
 * other than the session's MCP tools and the configured host tools. The CLI must not offer its
 * own tools, such as Bash or Read, because VD serves the run's tools itself.
 */
export function unexpectedCliTools(reported: readonly string[], hostTools: readonly string[]): string[] {
  return reported.filter((name) => sessionToolName(name) === undefined && !hostTools.includes(name));
}

/** Return the request's function tools, narrowed to the one a tool choice names. */
function functionTools(params: LanguageModelV4CallOptions): LanguageModelV4FunctionTool[] {
  const tools = (params.tools ?? []).filter((tool): tool is LanguageModelV4FunctionTool => tool.type === 'function');
  const choice = params.toolChoice;
  return choice?.type === 'tool' ? tools.filter((tool) => tool.name === choice.toolName) : tools;
}

/** Escape a string for literal use inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a function that rewrites backtick-quoted tool mentions, such as `bash`, into the names the
 * CLI calls them by, such as `mcp__vox__bash`. Prompts name tools without the prefix, and the
 * model sometimes copies that name into a call the CLI cannot find. Fenced code blocks, including
 * an unclosed one, stay untouched.
 */
export function toolNameQualifier(names: readonly string[]): (text: string) => string {
  if (names.length === 0) return (text) => text;
  // A fenced block matches first and is kept whole, so mentions inside it are skipped.
  const pattern = new RegExp(`(\`\`\`[\\s\\S]*?(?:\`\`\`|$))|(?<!\`)\`(${names.map(escapeRegExp).join('|')})\`(?!\`)`, 'g');
  return (text) => text.replace(pattern, (match, fenced: string | undefined, name: string | undefined) =>
    fenced !== undefined ? match : `\`${claudeCodeSessionToolPrefix}${name}\``);
}

/**
 * Return the prompt as the CLI should read it. Tool mentions in system, user, and assistant text
 * use the CLI names, and so do earlier calls and results of session tools, which the provider
 * writes into the prompt as text. Tool outputs stay as they are.
 */
export function qualifyPromptToolNames(prompt: LanguageModelV4Prompt, names: readonly string[]): LanguageModelV4Prompt {
  const qualify = toolNameQualifier(names);
  const sessionNames = new Set(names);
  const cliName = (name: string): string => sessionNames.has(name) ? claudeCodeSessionToolPrefix + name : name;
  return prompt.map((message): LanguageModelV4Prompt[number] => {
    switch (message.role) {
      case 'system':
        return { ...message, content: qualify(message.content) };
      case 'user':
        return {
          ...message,
          content: message.content.map((part) => part.type === 'text' ? { ...part, text: qualify(part.text) } : part),
        };
      case 'assistant':
        return {
          ...message,
          content: message.content.map((part) => {
            if (part.type === 'text') return { ...part, text: qualify(part.text) };
            if (part.type === 'tool-call' || part.type === 'tool-result') return { ...part, toolName: cliName(part.toolName) };
            return part;
          }),
        };
      case 'tool':
        return {
          ...message,
          content: message.content.map((part) => part.type === 'tool-result' ? { ...part, toolName: cliName(part.toolName) } : part),
        };
    }
  });
}

/** Serialize a tool result value as text for the CLI. */
function valueText(value: JSONValue | undefined): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

/** Convert an AI SDK tool result into the MCP result the CLI receives. */
export function toCallToolResult(output: LanguageModelV4ToolResultOutput): CallToolResult {
  switch (output.type) {
    case 'text':
      return { content: [{ type: 'text', text: output.value }] };
    case 'json':
      return { content: [{ type: 'text', text: valueText(output.value) }] };
    case 'content': {
      const text = output.value
        .map((part) => part.type === 'text' ? part.text : undefined)
        .filter((part): part is string => part !== undefined)
        .join('\n');
      return { content: [{ type: 'text', text }] };
    }
    case 'error-text':
      return { isError: true, content: [{ type: 'text', text: output.value }] };
    case 'error-json':
      return { isError: true, content: [{ type: 'text', text: valueText(output.value) }] };
    case 'execution-denied':
      return { isError: true, content: [{ type: 'text', text: output.reason ?? 'The call was denied.' }] };
  }
}

/** The tool results and trailing user text that let a live query continue. */
export interface ClaudeCodeContinuation {
  results: LanguageModelV4ToolResultPart[];
  userText: string[];
}

/**
 * Read what follows the prompt's last assistant message: tool messages answering exactly the
 * handed-out calls, then optional user messages. Returns undefined when the prompt does not have
 * that shape, which means the live query cannot continue.
 */
export function findContinuation(
  prompt: LanguageModelV4Prompt,
  handedOut: readonly string[],
): ClaudeCodeContinuation | undefined {
  if (handedOut.length === 0) return undefined;
  let lastAssistant = -1;
  prompt.forEach((message, index) => { if (message.role === 'assistant') lastAssistant = index; });
  if (lastAssistant < 0) return undefined;

  const results: LanguageModelV4ToolResultPart[] = [];
  const userText: string[] = [];
  let seenUser = false;
  for (const message of prompt.slice(lastAssistant + 1)) {
    if (message.role === 'tool' && !seenUser) {
      for (const part of message.content) if (part.type === 'tool-result') results.push(part);
    } else if (message.role === 'user') {
      seenUser = true;
      for (const part of message.content) if (part.type === 'text') userText.push(part.text);
    } else {
      return undefined;
    }
  }

  const ids = new Set(results.map((result) => result.toolCallId));
  if (ids.size !== results.length || ids.size !== handedOut.length) return undefined;
  if (!handedOut.every((id) => ids.has(id))) return undefined;
  return { results, userText };
}

/** Convert step usage to the AI SDK shape. */
function toUsage(usage: StepUsage): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: usage.input + usage.cacheRead + usage.cacheWrite,
      noCache: usage.input,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
    },
    outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
  };
}

/** Return a fresh, empty step usage. */
function emptyUsage(): StepUsage {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

/**
 * Read Anthropic message usage over a previous reading. Each count the event reports replaces the
 * previous one, since message_start and message_delta both report totals for the message so far.
 */
function readUsage(usage: any, previous: StepUsage): StepUsage {
  return {
    input: usage?.input_tokens ?? previous.input,
    cacheRead: usage?.cache_read_input_tokens ?? previous.cacheRead,
    cacheWrite: usage?.cache_creation_input_tokens ?? previous.cacheWrite,
    output: usage?.output_tokens ?? previous.output,
  };
}

/** Strip the session prefix from a CLI tool name, or return undefined for other tools. */
function sessionToolName(name: unknown): string | undefined {
  return typeof name === 'string' && name.startsWith(claudeCodeSessionToolPrefix)
    ? name.slice(claudeCodeSessionToolPrefix.length)
    : undefined;
}

/**
 * One live Claude Code query per VD agent run. It is inert until a claude-code step with tools
 * streams through it, and `close()` stops the CLI. Each run owns its session, because an MCP
 * server instance can serve only one query.
 */
export class ClaudeCodeSession {
  private live?: LiveQuery;
  private preserveUsageLimitError?: PreserveClaudeCodeUsageLimitError;

  /** Stream one VD step: continue the live query when the prompt allows it, or start a fresh one. */
  async stream(
    params: LanguageModelV4CallOptions,
    options: ClaudeCodeSessionStreamOptions,
  ): Promise<LanguageModelV4StreamResult> {
    params.abortSignal?.throwIfAborted();
    this.preserveUsageLimitError = options.preserveUsageLimitError;
    const tools = functionTools(params);
    const toolNames = tools.map((tool) => tool.name).sort().join('\n');

    const current = this.live;
    const continuation = current && !current.idle && !current.closed
      && current.key === options.key && current.toolNames === toolNames
      ? findContinuation(params.prompt, current.handedOut)
      : undefined;

    let live: LiveQuery;
    let response: Omit<LanguageModelV4StreamResult, 'stream'> = {};
    let ownStart = true;
    if (current && continuation) {
      live = current;
      this.deliver(live, continuation);
      live.handedOut = [];
      live.usage = emptyUsage();
    } else {
      await this.close();
      ({ live, response } = await this.start(params, options, tools, toolNames));
      // The first step forwards the provider's own stream-start, with its warnings.
      ownStart = false;
      // An abort during setup had no listener yet, so check again before streaming.
      if (params.abortSignal?.aborted) {
        await this.closeLive(live);
        params.abortSignal.throwIfAborted();
      }
    }
    const forwardRaw = params.includeRawChunks === true;

    let detach = (): void => {};
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start: (controller) => {
        if (ownStart) controller.enqueue({ type: 'stream-start', warnings: [] });
        const signal = params.abortSignal;
        if (signal) {
          const onAbort = (): void => {
            void this.closeLive(live);
            try { controller.error(signal.reason); } catch { /* already closed */ }
          };
          signal.addEventListener('abort', onAbort, { once: true });
          detach = () => signal.removeEventListener('abort', onAbort);
        }
        void this.pump(live, controller, !ownStart, forwardRaw).finally(() => detach());
      },
      cancel: async () => {
        detach();
        await this.closeLive(live);
      },
    });
    return { ...response, stream };
  }

  /** Stop the live CLI query, if any. Parked calls get an error result. Safe to call repeatedly. */
  async close(): Promise<void> {
    if (this.live) await this.closeLive(this.live);
  }

  /** Start a fresh CLI query whose MCP server lists the request's function tools. */
  private async start(
    params: LanguageModelV4CallOptions,
    options: ClaudeCodeSessionStreamOptions,
    tools: LanguageModelV4FunctionTool[],
    toolNames: string,
  ): Promise<{ live: LiveQuery; response: Omit<LanguageModelV4StreamResult, 'stream'> }> {
    for (const tool of tools) {
      if (tool.name.length > maximumToolNameLength) {
        throw new Error(`Tool name '${tool.name}' is longer than ${maximumToolNameLength} characters, which Claude Code cannot call.`);
      }
    }

    const server = new Server({ name: claudeCodeSessionServerName, version: '1.0.0' }, { capabilities: { tools: {} } });
    const live: LiveQuery = {
      server,
      key: options.key,
      toolNames,
      hostTools: options.hostTools ?? [],
      qualify: toolNameQualifier(tools.map((tool) => tool.name)),
      parked: new Map(),
      ready: new Map(),
      handedOut: [],
      expected: 0,
      emitted: 0,
      stopped: false,
      usage: emptyUsage(),
      message: emptyUsage(),
      hostCalls: new Map(),
      idle: false,
      closed: false,
    };

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description === undefined ? undefined : live.qualify(tool.description),
        inputSchema: tool.inputSchema as { type: 'object' },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const id = request.params._meta?.['claudecode/toolUseId'];
      if (typeof id !== 'string') {
        return { isError: true, content: [{ type: 'text', text: 'The call carried no tool use id.' }] };
      }
      if (live.closed) return endedResult;
      const ready = live.ready.get(id);
      if (ready) {
        live.ready.delete(id);
        return ready;
      }
      return new Promise<CallToolResult>((resolve) => { live.parked.set(id, resolve); });
    });

    const patch: ClaudeCodeSessionPatch = {
      mcpServers: {
        [claudeCodeSessionServerName]: {
          type: 'sdk',
          name: claudeCodeSessionServerName,
          // The CLI only connects a transport, which the low-level server supports.
          instance: server as any,
        },
      },
      mcpToolNames: tools.map((tool) => claudeCodeSessionToolPrefix + tool.name),
      env: { MCP_TOOL_TIMEOUT: mcpToolTimeout },
      persistSession: false,
      onQuery: (query) => { live.query = query; },
      preserveUsageLimitError: (error) => this.preserveUsageLimitError?.(error),
    };

    this.live = live;
    try {
      const { stream, ...response } = await options.open(patch).doStream({
        ...params,
        prompt: qualifyPromptToolNames(params.prompt, tools.map((tool) => tool.name)),
        tools: undefined,
        toolChoice: undefined,
        // The session handles aborts itself, so one step's signal never ends the query.
        abortSignal: undefined,
        // Raw SDK messages arrive in order with the content, so message boundaries line up with it.
        includeRawChunks: true,
      });
      live.reader = stream.getReader();
      return { live, response };
    } catch (error) {
      await this.closeLive(live);
      throw error;
    }
  }

  /**
   * Check the CLI's tool list, and track message boundaries and usage from its raw SDK messages.
   */
  private observe(live: LiveQuery, message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      const unexpected = unexpectedCliTools(message.tools ?? [], live.hostTools);
      if (unexpected.length > 0) {
        live.failure = new Error(`Claude Code exposed tools the run did not grant: ${unexpected.join(', ')}.`);
      }
      return;
    }
    if (message.type !== 'stream_event') return;
    const event = (message as any).event;
    switch (event?.type) {
      case 'message_start':
        live.message = readUsage(event.message?.usage, emptyUsage());
        live.expected = 0;
        live.emitted = 0;
        live.stopped = false;
        break;
      case 'content_block_start':
        if (event.content_block?.type === 'tool_use' && sessionToolName(event.content_block.name) !== undefined) {
          live.expected++;
        }
        break;
      case 'message_delta':
        // message_delta reports the message's counts so far, not increments.
        live.message = readUsage(event.usage, live.message);
        break;
      case 'message_stop':
        live.usage.input += live.message.input;
        live.usage.cacheRead += live.message.cacheRead;
        live.usage.cacheWrite += live.message.cacheWrite;
        live.usage.output += live.message.output;
        live.message = emptyUsage();
        live.stopped = true;
        break;
    }
  }

  /** Hand the step's tool results to the parked handlers, or keep them for late handlers. */
  private deliver(live: LiveQuery, continuation: ClaudeCodeContinuation): void {
    const byId = new Map(continuation.results.map((result) => [result.toolCallId, result]));
    live.handedOut.forEach((id, index) => {
      const result = toCallToolResult(byId.get(id)!.output);
      // Trailing user text, such as the closing reminder, rides on the last result.
      if (index === live.handedOut.length - 1 && continuation.userText.length > 0) {
        result.content = [...result.content, { type: 'text', text: live.qualify(continuation.userText.join('\n\n')) }];
      }
      const resolve = live.parked.get(id);
      if (resolve) {
        live.parked.delete(id);
        resolve(result);
      } else {
        live.ready.set(id, result);
      }
    });
  }

  /**
   * Forward the CLI's output for one VD step. Session tool calls become client calls, and the
   * step ends once the message that made them has stopped and every one has been passed on.
   */
  private async pump(
    live: LiveQuery,
    controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
    forwardStart: boolean,
    forwardRaw: boolean,
  ): Promise<void> {
    try {
      while (!live.closed) {
        if (live.failure) throw live.failure;
        if (live.stopped && live.expected > 0 && live.emitted >= live.expected) {
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_use' },
            usage: toUsage(live.usage),
          });
          controller.close();
          // The next step waits for the next message that calls session tools.
          live.expected = 0;
          live.emitted = 0;
          live.stopped = false;
          return;
        }

        live.pendingRead ??= live.reader!.read();
        const read = await live.pendingRead;
        live.pendingRead = undefined;
        if (live.closed) break;

        if (read.done) {
          live.idle = true;
          this.flushHostCalls(live, controller);
          controller.close();
          await this.closeLive(live);
          return;
        }

        const part = read.value;
        if (part.type === 'raw') {
          this.observe(live, part.rawValue as SDKMessage);
          if (forwardRaw) controller.enqueue(part);
          continue;
        }
        if (part.type === 'stream-start' && !forwardStart) continue;
        if (part.type === 'finish') {
          // The provider reports usage for the whole query; the step reports its own.
          live.idle = true;
          this.flushHostCalls(live, controller);
          controller.enqueue({ ...part, usage: toUsage(live.usage) });
          controller.close();
          await this.closeLive(live);
          return;
        }
        if (part.type === 'error') {
          controller.enqueue(part);
          controller.close();
          await this.closeLive(live);
          return;
        }

        for (const out of this.pairHostCall(live, part)) {
          const rewritten = this.rewrite(live, out);
          if (rewritten) controller.enqueue(rewritten);
        }
      }
      // Closed from outside, such as by an abort or the run ending.
      try { controller.close(); } catch { /* already errored */ }
    } catch (error) {
      await this.closeLive(live);
      try { controller.error(error); } catch { /* already closed */ }
    }
  }

  /**
   * Hold a host tool's parts, such as a WebSearch, until its result arrives, then release them
   * together. The step can end while a host call in the same message is still running, and
   * provider tool spans pair each call with its result within one step. Returns the parts to
   * forward now.
   */
  private pairHostCall(live: LiveQuery, part: LanguageModelV4StreamPart): LanguageModelV4StreamPart[] {
    switch (part.type) {
      case 'tool-input-start':
      case 'tool-call': {
        if (!part.providerExecuted || sessionToolName(part.toolName) !== undefined) return [part];
        const id = part.type === 'tool-call' ? part.toolCallId : part.id;
        live.hostCalls.set(id, [...(live.hostCalls.get(id) ?? []), part]);
        return [];
      }
      case 'tool-input-delta':
      case 'tool-input-end': {
        const held = live.hostCalls.get(part.id);
        if (!held) return [part];
        held.push(part);
        return [];
      }
      default: {
        const id = (part as { toolCallId?: unknown }).toolCallId;
        const isResult = part.type === 'tool-result' || (part as { type: string }).type === 'tool-error';
        const held = isResult && typeof id === 'string' ? live.hostCalls.get(id) : undefined;
        if (!held) return [part];
        live.hostCalls.delete(id as string);
        return [...held, part];
      }
    }
  }

  /** Release host calls still waiting for a result when the query's answer ends. */
  private flushHostCalls(live: LiveQuery, controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>): void {
    for (const held of live.hostCalls.values()) for (const part of held) controller.enqueue(part);
    live.hostCalls.clear();
  }

  /** Rename session tool parts for VD, drop the CLI's echo of their results, and pass the rest. */
  private rewrite(live: LiveQuery, part: LanguageModelV4StreamPart): LanguageModelV4StreamPart | undefined {
    switch (part.type) {
      case 'tool-call': {
        const name = sessionToolName(part.toolName);
        if (name === undefined) return part;
        const { providerExecuted: _executed, dynamic: _dynamic, ...call } = part as typeof part & { dynamic?: boolean };
        live.handedOut.push(part.toolCallId);
        live.emitted++;
        return { ...call, toolName: name };
      }
      case 'tool-input-start': {
        const name = sessionToolName(part.toolName);
        if (name === undefined) return part;
        const { providerExecuted: _executed, dynamic: _dynamic, ...start } = part as typeof part & { dynamic?: boolean };
        return { ...start, toolName: name };
      }
      case 'tool-result':
        return sessionToolName(part.toolName) === undefined ? part : undefined;
      default:
        if ((part as { type: string }).type === 'tool-error'
          && sessionToolName((part as { toolName?: unknown }).toolName) !== undefined) {
          return undefined;
        }
        return part;
    }
  }

  /** Stop a live query: answer parked calls, stop the CLI, and release the stream. */
  private async closeLive(live: LiveQuery): Promise<void> {
    if (this.live === live) this.live = undefined;
    if (live.closed) return;
    live.closed = true;
    for (const resolve of live.parked.values()) resolve(endedResult);
    live.parked.clear();
    try { live.query?.close(); } catch { /* already stopped */ }
    try { await live.reader?.cancel(); } catch { /* already released */ }
    // Let the answered calls' responses go out before the server disconnects.
    await new Promise((resolve) => setImmediate(resolve));
    try { await live.server.close(); } catch { /* never connected */ }
  }
}
