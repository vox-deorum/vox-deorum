import { describe, expect, it } from "vitest";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { emitProviderExecutedToolSpans } from "../../../src/utils/telemetry/provider-tool-spans.js";

/** Minimal span recorder standing in for an OTel span. */
class FakeSpan {
  attributes: Record<string, unknown> = {};
  status: { code: SpanStatusCode; message?: string } | undefined;
  ended = false;
  constructor(public name: string, public options: any) {
    Object.assign(this.attributes, options?.attributes ?? {});
  }
  setAttribute(key: string, value: unknown) {
    this.attributes[key] = value;
    return this;
  }
  setStatus(status: { code: SpanStatusCode; message?: string }) {
    this.status = status;
    return this;
  }
  end() {
    this.ended = true;
  }
}

/** Fake tracer capturing every started span. */
function makeTracer() {
  const spans: FakeSpan[] = [];
  const tracer = {
    startSpan(name: string, options: any) {
      const span = new FakeSpan(name, options);
      spans.push(span);
      return span;
    },
  } as any;
  return { tracer, spans };
}

const ATTRS = { contextId: "ctx-1", turn: 7 };

describe("emitProviderExecutedToolSpans", () => {
  it("should emit one span per provider-executed tool-call, ignoring game-tool parts", () => {
    const content = [
      { type: "text", text: "hello" },
      // Prompt-mode game tool (NOT providerExecuted): must be ignored.
      { type: "tool-call", toolCallId: "g1", toolName: "send-message", input: { text: "hi" } },
      { type: "tool-result", toolCallId: "g1", toolName: "send-message", output: { ok: true } },
      // CLI built-in tool call + result.
      {
        type: "tool-call",
        toolCallId: "b1",
        toolName: "Read",
        input: { file_path: "/tmp/x" },
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: "tool-result",
        toolCallId: "b1",
        toolName: "Read",
        output: { content: "file body" },
        providerExecuted: true,
        dynamic: true,
      },
    ];

    const { tracer, spans } = makeTracer();
    const count = emitProviderExecutedToolSpans('claude-code', content, tracer, ATTRS);

    expect(count).toBe(1);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("claude-code-tool.Read");
    expect(span.options.kind).toBe(SpanKind.CLIENT);
    expect(span.attributes).toMatchObject({
      "tool.name": "Read",
      "tool.type": "claude-code-builtin",
      "vox.context.id": "ctx-1",
      "game.turn": "7",
      "tool.input": JSON.stringify({ file_path: "/tmp/x" }),
      "tool.output": JSON.stringify({ content: "file body" }),
    });
    expect(span.status?.code).toBe(SpanStatusCode.OK);
    expect(span.ended).toBe(true);
  });

  it("should mark tool-error pairs as ERROR and record the error payload", () => {
    const content = [
      {
        type: "tool-call",
        toolCallId: "b2",
        toolName: "WebFetch",
        input: { url: "https://example.com" },
        providerExecuted: true,
      },
      {
        type: "tool-error",
        toolCallId: "b2",
        toolName: "WebFetch",
        error: "network down",
        providerExecuted: true,
      },
    ];

    const { tracer, spans } = makeTracer();
    const count = emitProviderExecutedToolSpans('claude-code', content, tracer, ATTRS);

    expect(count).toBe(1);
    const span = spans[0];
    expect(span.name).toBe("claude-code-tool.WebFetch");
    // The provider already stringifies errors; we store as-is (single encoding).
    expect(span.attributes["tool.output"]).toBe("network down");
    expect(span.status?.code).toBe(SpanStatusCode.ERROR);
    expect(span.ended).toBe(true);
  });

  it("should JSON-serialize a structured (object) tool-error payload", () => {
    const content = [
      {
        type: "tool-call",
        toolCallId: "b3",
        toolName: "WebFetch",
        input: { url: "https://example.com" },
        providerExecuted: true,
      },
      {
        type: "tool-error",
        toolCallId: "b3",
        toolName: "WebFetch",
        // Raw tool_result + is_error can surface an object rather than a string.
        error: { code: "ENOTFOUND", host: "example.com" },
        providerExecuted: true,
      },
    ];

    const { tracer, spans } = makeTracer();
    emitProviderExecutedToolSpans('claude-code', content, tracer, ATTRS);

    // Structured payloads must be JSON-serialized, never collapsed to "[object Object]".
    expect(spans[0].attributes["tool.output"]).toBe(
      JSON.stringify({ code: "ENOTFOUND", host: "example.com" })
    );
    expect(spans[0].status?.code).toBe(SpanStatusCode.ERROR);
  });

  it("should mark a provider-executed call with no terminal result as an error", () => {
    const content = [
      {
        type: "tool-call",
        toolCallId: "b4",
        toolName: "Glob",
        input: { pattern: "**/*" },
        providerExecuted: true,
      },
    ];

    const { tracer, spans } = makeTracer();
    const count = emitProviderExecutedToolSpans('claude-code', content, tracer, ATTRS);

    expect(count).toBe(1);
    expect(spans[0].attributes["tool.output"]).toBeUndefined();
    expect(spans[0].status?.code).toBe(SpanStatusCode.ERROR);
  });

  it("should ignore preliminary results and use the later Codex failure", () => {
    const content = [
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "command",
        input: { command: "false" },
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "command",
        output: { status: "in_progress", progress: "running" },
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "command",
        output: { status: "failed", exitCode: 1, error: { message: "failed" } },
        providerExecuted: true,
        dynamic: true,
      },
    ];

    const { tracer, spans } = makeTracer();
    const count = emitProviderExecutedToolSpans('codex', content, tracer, ATTRS);

    expect(count).toBe(1);
    expect(spans[0].name).toBe("codex-tool.command");
    expect(spans[0].attributes["tool.type"]).toBe("codex-builtin");
    expect(spans[0].attributes["tool.output"]).toBe(JSON.stringify(content[2]!.output));
    expect(spans[0].status?.code).toBe(SpanStatusCode.ERROR);
  });

  it("should not treat a preliminary-only outcome as success", () => {
    const content = [
      {
        type: "tool-call",
        toolCallId: "c2",
        toolName: "web-search",
        input: {},
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "c2",
        toolName: "web-search",
        output: { status: "in_progress" },
        providerExecuted: true,
      },
    ];

    const { tracer, spans } = makeTracer();
    emitProviderExecutedToolSpans('codex', content, tracer, ATTRS);
    expect(spans[0].status?.code).toBe(SpanStatusCode.ERROR);
  });

  it.each(["failed", "error", "cancelled", "canceled", "interrupted"])(
    "should mark structured Codex %s results as errors",
    (status) => {
      const content = [
        {
          type: "tool-call",
          toolCallId: "c3",
          toolName: "command",
          input: {},
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "c3",
          toolName: "command",
          output: { status, error: { message: "stopped" } },
          providerExecuted: true,
        },
      ];

      const { tracer, spans } = makeTracer();
      emitProviderExecutedToolSpans('codex', content, tracer, ATTRS);
      expect(spans[0].status?.code).toBe(SpanStatusCode.ERROR);
    },
  );

  it("should return 0 for non-array content or content without provider-executed parts", () => {
    const { tracer, spans } = makeTracer();
    expect(emitProviderExecutedToolSpans('claude-code', undefined, tracer, ATTRS)).toBe(0);
    expect(
      emitProviderExecutedToolSpans(
        'claude-code',
        [{ type: "tool-call", toolCallId: "g", toolName: "send-message", input: {} }],
        tracer,
        ATTRS
      )
    ).toBe(0);
    expect(spans).toHaveLength(0);
  });
});
