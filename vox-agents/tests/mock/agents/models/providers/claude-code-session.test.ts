/**
 * Behavior of the live Claude Code session: one CLI query per run, with the run's tools served
 * through the session's MCP server and handed back to the VD step loop at each message stop.
 *
 * A scripted fake CLI stands in for the provider model. It connects a real MCP client to the
 * session's server over an in-memory transport, calls tools with the tool use id in `_meta` the way
 * the CLI does, and sends raw SDK messages in order with the content, as the provider does when
 * raw chunks are requested.
 */

import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ClaudeCodeSession,
  findContinuation,
  toCallToolResult,
  unexpectedCliTools,
  type ClaudeCodeSessionPatch,
} from '../../../../../src/agents/models/providers/claude-code-session.js';

const prefix = 'mcp__vox__';
const tools: any[] = [
  { type: 'function', name: 'bash', description: 'Run a script', inputSchema: { type: 'object', properties: { Command: { type: 'string' } } } },
  { type: 'function', name: 'act', description: 'Act', inputSchema: { type: 'object', properties: {} } },
];
const usage = { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 };

/** One opened fake CLI query. */
interface FakeQuery {
  patch: ClaudeCodeSessionPatch;
  params: any;
  client: Client;
  controller: ReadableStreamDefaultController<any>;
  query: { close: ReturnType<typeof vi.fn> };
  cancelled: boolean;
}

/** Build a fake CLI whose `open` records each query the session starts. */
function fakeCli() {
  const queries: FakeQuery[] = [];
  const open = (patch: ClaudeCodeSessionPatch): any => ({
    specificationVersion: 'v4',
    provider: 'fake',
    modelId: 'fake',
    supportedUrls: {},
    doGenerate: async () => { throw new Error('stream only'); },
    doStream: async (params: any) => {
      let controller!: ReadableStreamDefaultController<any>;
      const entry = {} as FakeQuery;
      const stream = new ReadableStream({
        start: (c) => { controller = c; },
        cancel: () => { entry.cancelled = true; },
      });
      const client = new Client({ name: 'fake-cli', version: '1.0.0' });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await (patch.mcpServers.vox as any).instance.connect(serverSide);
      await client.connect(clientSide);
      const query = { close: vi.fn() };
      patch.onQuery(query as any);
      Object.assign(entry, { patch, params, client, controller, query, cancelled: false });
      queries.push(entry);
      return { stream };
    },
  });
  return { queries, open };
}

/** Send a raw SDK message in order with the content, the way the provider forwards it. */
function sdk(q: FakeQuery, rawValue: any): void {
  q.controller.enqueue({ type: 'raw', rawValue });
}

/** Send a raw stream event. */
function event(q: FakeQuery, body: any): void {
  sdk(q, { type: 'stream_event', event: body });
}

/** Emit one assistant message whose tool_use blocks call the given CLI tool names. */
function message(q: FakeQuery, calls: Array<{ id: string; name: string; input?: any }>, outputTokens = 7): void {
  event(q, { type: 'message_start', message: { usage } });
  for (const call of calls) {
    event(q, { type: 'content_block_start', content_block: { type: 'tool_use', id: call.id, name: call.name } });
    q.controller.enqueue({
      type: 'tool-call', toolCallId: call.id, toolName: call.name,
      input: JSON.stringify(call.input ?? {}), providerExecuted: true, dynamic: true,
    });
  }
  event(q, { type: 'message_delta', usage: { output_tokens: outputTokens } });
  event(q, { type: 'message_stop' });
}

/** Call a session tool from the fake CLI, as the CLI does once a tool_use block ends. */
function callTool(q: FakeQuery, id: string, name: string): Promise<any> {
  return q.client.callTool({ name, arguments: {}, _meta: { 'claudecode/toolUseId': id } });
}

/** Read a stream to its end. */
async function drain(stream: ReadableStream<any>): Promise<any[]> {
  const parts: any[] = [];
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) parts.push(read.value);
  return parts;
}

/** Wait until a condition holds, yielding to the event loop between checks. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(condition()).toBe(true);
}

const first = { tools, prompt: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] } as any;

/** The next step's prompt: the first prompt, the handed-out calls, their results, and user text. */
function next(calls: Array<{ id: string; name: string }>, outputs: any[], userText?: string): any {
  return {
    tools,
    prompt: [
      ...first.prompt,
      { role: 'assistant', content: calls.map((call) => ({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: {} })) },
      { role: 'tool', content: calls.map((call, i) => ({ type: 'tool-result', toolCallId: call.id, toolName: call.name, output: outputs[i] })) },
      ...(userText ? [{ role: 'user', content: [{ type: 'text', text: userText }] }] : []),
    ],
  };
}

describe('ClaudeCodeSession', () => {
  it('serves the declared tools to the CLI and hands their calls to VD under the plain name', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const result = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];

    const listed = await q.client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['bash', 'act']);
    expect(q.patch.mcpToolNames).toEqual([`${prefix}bash`, `${prefix}act`]);
    expect(q.params.tools).toBeUndefined();
    expect(q.params.includeRawChunks).toBe(true);

    message(q, [{ id: 't1', name: `${prefix}bash`, input: { Command: 'ls' } }]);
    const parts = await drain(result.stream);
    const calls = parts.filter((part) => part.type === 'tool-call');
    expect(calls).toEqual([{ type: 'tool-call', toolCallId: 't1', toolName: 'bash', input: '{"Command":"ls"}' }]);
    expect(parts.at(-1)).toMatchObject({ type: 'finish', finishReason: { unified: 'tool-calls' } });
    // Raw SDK messages stay internal unless the caller asked for them.
    expect(parts.some((part) => part.type === 'raw')).toBe(false);
    await session.close();
  });

  it('keeps content that follows a call in the same message within that step', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream({ ...first, includeRawChunks: true }, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    event(q, { type: 'message_start', message: { usage } });
    event(q, { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: `${prefix}act` } });
    q.controller.enqueue({ type: 'tool-call', toolCallId: 't1', toolName: `${prefix}act`, input: '{}', providerExecuted: true });
    q.controller.enqueue({ type: 'text-start', id: 'x' });
    q.controller.enqueue({ type: 'text-delta', id: 'x', delta: 'after the call' });
    q.controller.enqueue({ type: 'text-end', id: 'x' });
    event(q, { type: 'message_stop' });

    const parts = await drain(step1.stream);
    expect(parts.map((part) => part.type).filter((type) => type !== 'raw'))
      .toEqual(['tool-call', 'text-start', 'text-delta', 'text-end', 'finish']);
    // Requested raw chunks pass through.
    expect(parts.some((part) => part.type === 'raw')).toBe(true);
    await session.close();
  });

  it('names the session tools by their CLI names in everything the CLI reads', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const prompt = [
      { role: 'system', content: 'Call `act` each turn. Use `other` never.' },
      { role: 'user', content: [{ type: 'text', text: 'Read with `bash`:\n```bash\nls\n```\n```js\nrun(`act`)\n```\n```\nunclosed `bash`' }] },
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: 'old', toolName: 'bash', input: {} },
        { type: 'tool-call', toolCallId: 'web', toolName: 'WebSearch', input: {}, providerExecuted: true },
      ] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'old', toolName: 'bash', output: { type: 'text', value: '`act`' } }] },
    ];
    const step1 = await session.stream({ tools, prompt } as any, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    const sent = q.params.prompt;
    expect(sent[0].content).toContain(`\`${prefix}act\``);
    expect(sent[0].content).toContain('`other`');
    expect(sent[1].content[0].text).toContain(`\`${prefix}bash\``);
    expect(sent[1].content[0].text).toContain('```bash\n');
    // Fenced code, closed or not, keeps its contents.
    expect(sent[1].content[0].text).toContain('run(`act`)');
    expect(sent[1].content[0].text).toContain('unclosed `bash`');
    expect(sent[2].content.map((part: any) => part.toolName)).toEqual([`${prefix}bash`, 'WebSearch']);
    expect(sent[3].content[0]).toMatchObject({ toolName: `${prefix}bash`, output: { value: '`act`' } });
    // VD's own prompt keeps the plain names.
    expect(prompt[2].content[0]).toMatchObject({ toolName: 'bash' });

    // Trailing user text delivered to a live query is rewritten too.
    message(q, [{ id: 't1', name: `${prefix}act` }]);
    const pending = callTool(q, 't1', 'act');
    await drain(step1.stream);
    await session.stream(next([{ id: 't1', name: 'act' }], [{ type: 'text', value: 'ok' }], 'Now call `bash`.'), { key: 'k', open: cli.open });
    expect((await pending).content.at(-1).text).toContain(`\`${prefix}bash\``);
    await session.close();
  });

  it('serves only the tool a tool choice names', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    await session.stream({ ...first, toolChoice: { type: 'tool', toolName: 'act' } }, { key: 'k', open: cli.open });
    const listed = await cli.queries[0].client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['act']);
    await session.close();
  });

  it('keeps parallel calls in one step and answers both the parked and the late handler', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    const pair = [{ id: 't1', name: 'bash' }, { id: 't2', name: 'act' }];
    message(q, pair.map((call) => ({ ...call, name: prefix + call.name })));
    // The CLI runs the first tool as soon as its block ends, and the second only after the first returns.
    const firstResult = callTool(q, 't1', 'bash');
    const parts = await drain(step1.stream);
    expect(parts.filter((part) => part.type === 'tool-call').map((part) => part.toolName)).toEqual(['bash', 'act']);

    const step2 = await session.stream(
      next(pair, [{ type: 'text', value: 'listing' }, { type: 'json', value: { ok: true } }], 'Reminder text'),
      { key: 'k', open: cli.open },
    );
    expect((await firstResult).content).toEqual([{ type: 'text', text: 'listing' }]);
    const late = await callTool(q, 't2', 'act');
    // The trailing user text rides on the last result.
    expect(late.content.map((item: any) => item.text)).toEqual(['{"ok":true}', 'Reminder text']);
    expect(cli.queries).toHaveLength(1);

    q.controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: {} });
    await drain(step2.stream);
    await session.close();
  });

  it('reports usage for each step on its own, including cache reads and writes', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    message(q, [{ id: 't1', name: `${prefix}bash` }], 7);
    const usage1 = (await drain(step1.stream)).at(-1).usage;
    expect(usage1.inputTokens).toEqual({ total: 115, noCache: 10, cacheRead: 100, cacheWrite: 5 });
    expect(usage1.outputTokens.total).toBe(7);

    const step2 = await session.stream(next([{ id: 't1', name: 'bash' }], [{ type: 'text', value: 'x' }]), { key: 'k', open: cli.open });
    // Two messages in one step: a text-only one, then the call that ends the step.
    event(q, { type: 'message_start', message: { usage } });
    event(q, { type: 'message_delta', usage: { output_tokens: 3 } });
    event(q, { type: 'message_stop' });
    message(q, [{ id: 't2', name: `${prefix}act` }], 4);
    const usage2 = (await drain(step2.stream)).at(-1).usage;
    expect(usage2.inputTokens.total).toBe(230);
    expect(usage2.outputTokens.total).toBe(7);
    await session.close();
  });

  it('takes the final usage a message reports when it stops', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    event(q, { type: 'message_start', message: { usage } });
    event(q, { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: `${prefix}act` } });
    q.controller.enqueue({ type: 'tool-call', toolCallId: 't1', toolName: `${prefix}act`, input: '{}', providerExecuted: true });
    event(q, { type: 'message_delta', usage: { input_tokens: 12, cache_read_input_tokens: 120, output_tokens: 9 } });
    event(q, { type: 'message_stop' });
    const reported = (await drain(step1.stream)).at(-1).usage;
    expect(reported.inputTokens).toEqual({ total: 137, noCache: 12, cacheRead: 120, cacheWrite: 5 });
    expect(reported.outputTokens.total).toBe(9);
    await session.close();
  });

  it('keeps a CLI tool call with its result when the result arrives in the next step', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    // One message calls WebSearch and a session tool; the search is still running when it stops.
    event(q, { type: 'message_start', message: { usage } });
    q.controller.enqueue({ type: 'tool-input-start', id: 'w1', toolName: 'WebSearch', providerExecuted: true });
    q.controller.enqueue({ type: 'tool-input-end', id: 'w1' });
    q.controller.enqueue({ type: 'tool-call', toolCallId: 'w1', toolName: 'WebSearch', input: '{}', providerExecuted: true });
    event(q, { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: `${prefix}act` } });
    q.controller.enqueue({ type: 'tool-call', toolCallId: 't1', toolName: `${prefix}act`, input: '{}', providerExecuted: true });
    event(q, { type: 'message_stop' });
    const parts1 = await drain(step1.stream);
    expect(parts1.filter((part) => part.type.startsWith('tool-')).map((part) => part.toolCallId ?? part.id)).toEqual(['t1']);

    const step2 = await session.stream(next([{ id: 't1', name: 'act' }], [{ type: 'text', value: 'done' }]), { key: 'k', open: cli.open });
    q.controller.enqueue({ type: 'tool-result', toolCallId: 'w1', toolName: 'WebSearch', result: 'found' });
    q.controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: {} });
    const parts2 = await drain(step2.stream);
    expect(parts2.map((part) => part.type).filter((type) => type !== 'stream-start'))
      .toEqual(['tool-input-start', 'tool-input-end', 'tool-call', 'tool-result', 'finish']);
    await session.close();
  });

  it('marks failed tools as errors for the CLI', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    message(q, [{ id: 't1', name: `${prefix}act` }]);
    const pending = callTool(q, 't1', 'act');
    await drain(step1.stream);
    await session.stream(next([{ id: 't1', name: 'act' }], [{ type: 'error-text', value: 'Tool removed' }]), { key: 'k', open: cli.open });
    expect(await pending).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Tool removed' }] });
    await session.close();
  });

  it('passes the CLI’s own tool parts through, and a message with only those does not end the step', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    event(q, { type: 'message_start', message: { usage } });
    event(q, { type: 'content_block_start', content_block: { type: 'server_tool_use', id: 'w1', name: 'WebSearch' } });
    q.controller.enqueue({ type: 'tool-call', toolCallId: 'w1', toolName: 'WebSearch', input: '{}', providerExecuted: true });
    q.controller.enqueue({ type: 'tool-result', toolCallId: 'w1', toolName: 'WebSearch', result: 'found' });
    event(q, { type: 'message_stop' });
    message(q, [{ id: 't1', name: `${prefix}act` }]);
    q.controller.enqueue({ type: 'tool-result', toolCallId: 't1', toolName: `${prefix}act`, result: 'echo' });

    const parts = await drain(step1.stream);
    expect(parts.filter((part) => part.type === 'tool-call').map((part) => part.toolName)).toEqual(['WebSearch', 'act']);
    expect(parts.filter((part) => part.type === 'tool-result').map((part) => part.toolName)).toEqual(['WebSearch']);
    expect(parts.filter((part) => part.type === 'finish')).toHaveLength(1);
    await session.close();
  });

  it('starts a fresh query when the prompt does not answer the calls it handed out', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    message(q, [{ id: 't1', name: `${prefix}act` }]);
    const pending = callTool(q, 't1', 'act');
    await drain(step1.stream);

    // A retry of the same step resends a prompt that answers none of the calls.
    await session.stream(first, { key: 'k', open: cli.open });
    expect(cli.queries).toHaveLength(2);
    expect(q.query.close).toHaveBeenCalled();
    expect((await pending).isError).toBe(true);
    // The fresh query receives the full prompt.
    expect(cli.queries[1].params.prompt).toEqual(first.prompt);
    await session.close();
  });

  it('starts a fresh query when the model configuration changes', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'a', open: cli.open });
    message(cli.queries[0], [{ id: 't1', name: `${prefix}act` }]);
    await drain(step1.stream);
    await session.stream(next([{ id: 't1', name: 'act' }], [{ type: 'text', value: 'x' }]), { key: 'b', open: cli.open });
    expect(cli.queries).toHaveLength(2);
    await session.close();
  });

  it('ends the query after a final answer and starts fresh on the next request', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step1 = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    event(q, { type: 'message_start', message: { usage } });
    q.controller.enqueue({ type: 'text-delta', id: 'x', delta: 'done' });
    event(q, { type: 'message_delta', usage: { output_tokens: 2 } });
    event(q, { type: 'message_stop' });
    // The provider's usage covers the whole query; the step reports its own.
    q.controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: { inputTokens: { total: 9999 }, outputTokens: { total: 9999 } } });
    const parts = await drain(step1.stream);
    expect(parts.at(-1)).toMatchObject({ type: 'finish', finishReason: { unified: 'stop' }, usage: { inputTokens: { total: 115 }, outputTokens: { total: 2 } } });
    expect(q.query.close).toHaveBeenCalled();

    await session.stream(first, { key: 'k', open: cli.open });
    expect(cli.queries).toHaveLength(2);
    await session.close();
  });

  it('closes the query on an abort, and the next request starts fresh', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const controller = new AbortController();
    const step1 = await session.stream({ ...first, abortSignal: controller.signal }, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    controller.abort(new Error('stopped'));
    await expect(drain(step1.stream)).rejects.toThrow('stopped');
    expect(q.query.close).toHaveBeenCalled();

    const step2 = await session.stream(first, { key: 'k', open: cli.open });
    message(cli.queries[1], [{ id: 't1', name: `${prefix}act` }]);
    expect((await drain(step2.stream)).at(-1).type).toBe('finish');
    await session.close();
  });

  it('stops the query when the step is aborted while the query starts', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const controller = new AbortController();
    const open = (patch: ClaudeCodeSessionPatch): any => {
      const model = cli.open(patch);
      return {
        ...model,
        doStream: async (params: any) => {
          const result = await model.doStream(params);
          controller.abort(new Error('stopped during setup'));
          return result;
        },
      };
    };
    await expect(session.stream({ ...first, abortSignal: controller.signal }, { key: 'k', open })).rejects.toThrow('stopped during setup');
    expect(cli.queries[0].query.close).toHaveBeenCalled();
    expect(cli.queries[0].cancelled).toBe(true);
  });

  it('fails the query when the CLI offers tools the run did not grant', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step = await session.stream(first, { key: 'k', open: cli.open, hostTools: ['WebSearch'] });
    const q = cli.queries[0];
    sdk(q, { type: 'system', subtype: 'init', tools: [`${prefix}act`, 'WebSearch', 'Bash'] });
    await expect(drain(step.stream)).rejects.toThrow('Bash');
    expect(q.query.close).toHaveBeenCalled();
  });

  it('close answers parked calls, stops the CLI, and releases its stream', async () => {
    const cli = fakeCli();
    const session = new ClaudeCodeSession();
    const step = await session.stream(first, { key: 'k', open: cli.open });
    const q = cli.queries[0];
    message(q, [{ id: 't1', name: `${prefix}act` }]);
    const pending = callTool(q, 't1', 'act');
    await drain(step.stream);

    await session.close();
    expect((await pending).isError).toBe(true);
    expect(q.query.close).toHaveBeenCalled();
    expect(q.cancelled).toBe(true);
    await session.close();
  });

  it('rejects a tool name the CLI cannot call', async () => {
    const session = new ClaudeCodeSession();
    const long = { ...tools[1], name: 'x'.repeat(60) };
    await expect(session.stream({ ...first, tools: [long] }, { key: 'k', open: fakeCli().open })).rejects.toThrow();
  });
});

describe('findContinuation', () => {
  it('accepts results for exactly the handed-out calls, with trailing user text', () => {
    const prompt = next([{ id: 'a', name: 'bash' }, { id: 'b', name: 'act' }], [{ type: 'text', value: '1' }, { type: 'text', value: '2' }], 'note').prompt;
    const found = findContinuation(prompt, ['a', 'b']);
    expect(found?.results.map((result) => result.toolCallId)).toEqual(['a', 'b']);
    expect(found?.userText).toEqual(['note']);
  });

  it('rejects missing, extra, or unrelated results', () => {
    const prompt = next([{ id: 'a', name: 'bash' }], [{ type: 'text', value: '1' }]).prompt;
    expect(findContinuation(prompt, ['a', 'b'])).toBeUndefined();
    expect(findContinuation(prompt, ['z'])).toBeUndefined();
    expect(findContinuation(prompt, [])).toBeUndefined();
    expect(findContinuation(first.prompt, ['a'])).toBeUndefined();
  });
});

describe('toCallToolResult', () => {
  it('converts each AI SDK output type, marking failures as errors', () => {
    expect(toCallToolResult({ type: 'text', value: 'hi' })).toEqual({ content: [{ type: 'text', text: 'hi' }] });
    expect(toCallToolResult({ type: 'json', value: { a: 1 } }).content[0]).toEqual({ type: 'text', text: '{"a":1}' });
    expect(toCallToolResult({ type: 'content', value: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }).content[0]).toEqual({ type: 'text', text: 'a\nb' });
    expect(toCallToolResult({ type: 'error-text', value: 'bad' }).isError).toBe(true);
    expect(toCallToolResult({ type: 'error-json', value: { e: 1 } }).isError).toBe(true);
    expect(toCallToolResult({ type: 'execution-denied' }).isError).toBe(true);
  });
});

describe('unexpectedCliTools', () => {
  it('flags every reported tool beyond the session tools and the granted host tools', () => {
    expect(unexpectedCliTools([`${prefix}act`, 'WebFetch'], ['WebFetch'])).toEqual([]);
    expect(unexpectedCliTools([`${prefix}act`, 'Bash', 'Read', 'mcp__other__x'], [])).toEqual(['Bash', 'Read', 'mcp__other__x']);
  });
});
