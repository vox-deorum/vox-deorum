/**
 * Tests for the capability reminder. Assertions compose against the exported instruction
 * builders and controlled config values rather than the wording itself.
 */

import { describe, expect, it } from 'vitest';
import { wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
  capabilityInstruction,
  capabilityMiddleware,
} from '../../../src/utils/models/capability-prompt.js';
import {
  completionToolsInstruction,
  requiredToolChoiceMiddleware,
} from '../../../src/utils/models/providers/required-tool-choice.js';
import { bashToolName } from '../../../src/utils/tools/tool-names.js';
import { workspaceGuideFile } from '../../../src/utils/workspace/player-workspace.js';
import type { ResolvedFilesConfig } from '../../../src/types/index.js';

/** One declared client function tool. */
function functionTool(name: string): any {
  return {
    type: 'function',
    name,
    description: `Do ${name}.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  };
}

/** A recording model whose doGenerate succeeds with a plain text response. */
function recordingModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    } as any),
  });
}

/** The system text that reached the recording model on its last call. */
function lastSystem(recorder: ReturnType<typeof recordingModel>): string {
  const prompt = (recorder as any).doGenerateCalls.at(-1).prompt;
  return prompt.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
}

const gameWrite: ResolvedFilesConfig = { game: 'write', shared: {}, quota: 17 };

describe('capabilityInstruction', () => {
  it('returns nothing when no capability is enabled', () => {
    expect(capabilityInstruction({ web: false })).toBeUndefined();
  });

  it('describes the game folder and its guide', () => {
    const instruction = capabilityInstruction({ files: gameWrite, web: false })!;
    expect(instruction).toContain('/workspace/game');
    expect(instruction).toContain(workspaceGuideFile);
    expect(instruction).toContain(bashToolName);
  });

  it('describes a read-only game folder differently from a writable one', () => {
    const write = capabilityInstruction({ files: gameWrite, web: false })!;
    const read = capabilityInstruction({ files: { ...gameWrite, game: 'read' }, web: false })!;
    expect(read).not.toBe(write);
  });

  it('names each shared folder and leaves out an unmounted game folder', () => {
    const instruction = capabilityInstruction({
      files: { game: false, shared: { lessons: 'write', reference: 'read' }, quota: 20 },
      web: false,
    })!;
    expect(instruction).toContain('/workspace/shared/lessons');
    expect(instruction).toContain('/workspace/shared/reference');
    expect(instruction).not.toContain('/workspace/game');
  });

  it('describes web access without inventing a workspace', () => {
    const web = capabilityInstruction({ web: true })!;
    expect(web).not.toContain('/workspace');
    expect(web).not.toContain(bashToolName);
    const both = capabilityInstruction({ files: gameWrite, web: true })!;
    expect(both.length).toBeGreaterThan(capabilityInstruction({ files: gameWrite, web: false })!.length);
  });

  it('names each declared terminal tool', () => {
    const instruction = capabilityInstruction({ web: true }, ['found_city', 'send_message'])!;
    expect(instruction).toContain('found_city');
    expect(instruction).toContain('send_message');
    expect(instruction.length).toBeGreaterThan(capabilityInstruction({ web: true })!.length);
  });

  it('follows the requested terminology', () => {
    const tools = capabilityInstruction({ files: gameWrite, web: true }, ['found_city'], 'tools')!;
    const actions = capabilityInstruction({ files: gameWrite, web: true }, ['found_city'], 'actions')!;
    expect(actions).not.toBe(tools);
    expect(actions).toContain('actions');
    expect(tools).not.toContain('actions');
  });

  it('omits terminal guidance when no terminal tool is declared', () => {
    expect(capabilityInstruction({ files: gameWrite, web: true })).not.toContain('terminal');
  });
});

describe('capabilityMiddleware', () => {
  it('leaves the params untouched when no capability is enabled', async () => {
    const params: any = { prompt: [{ role: 'user', content: [] }] };
    const out = await (capabilityMiddleware({ web: false }).transformParams as any)({ params });
    expect(out).toBe(params);
  });

  it('describes the workspace only when the request declares bash', async () => {
    const middleware = capabilityMiddleware({ files: gameWrite, web: false }, { completionTools: ['found_city'] });
    const prompt = [{ role: 'user', content: [{ type: 'text', text: 'Take the turn.' }] }];

    const without: any = await (middleware.transformParams as any)({
      params: { prompt, tools: [functionTool('found_city')] },
    });
    expect(without.prompt).toBe(prompt);

    const withBash: any = await (middleware.transformParams as any)({
      params: { prompt, tools: [functionTool('found_city'), functionTool(bashToolName)] },
    });
    const system = withBash.prompt.filter((m: any) => m.role === 'system').map((m: any) => m.content).join('\n');
    expect(system).toContain(capabilityInstruction({ files: gameWrite, web: false }, ['found_city'])!);
  });

  it('keeps web guidance on a request without bash', async () => {
    const recorder = recordingModel();
    const model = wrapLanguageModel({
      model: recorder,
      middleware: capabilityMiddleware({ files: gameWrite, web: true }),
    });
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Take the turn.' }] }],
      tools: [functionTool('found_city')],
      providerOptions: {},
    } as any);
    expect(lastSystem(recorder)).toContain(capabilityInstruction({ web: true })!);
  });

  it('keeps the capability reminder ahead of the completion-tool instruction', async () => {
    const recorder = recordingModel();
    const model = wrapLanguageModel({
      model: recorder,
      middleware: [
        capabilityMiddleware({ files: gameWrite, web: false }, { completionTools: ['found_city', 'inactive_tool'] }),
        requiredToolChoiceMiddleware({ completionTools: ['found_city'] }),
      ],
    });

    await model.doGenerate({
      prompt: [
        { role: 'system', content: 'Make sound strategic decisions.' },
        { role: 'user', content: [{ type: 'text', text: 'Take the turn.' }] },
      ],
      tools: [functionTool('found_city'), functionTool(bashToolName)],
      toolChoice: { type: 'required' },
      providerOptions: {},
    } as any);

    const system = lastSystem(recorder);
    const instruction = capabilityInstruction({ files: gameWrite, web: false }, ['found_city'])!;
    const completion = completionToolsInstruction(['found_city', bashToolName], ['found_city'], false)!;
    expect(system).toContain(instruction);
    expect(system).toContain(completion);
    expect(system).not.toContain('inactive_tool');
    expect(system.indexOf(instruction)).toBeLessThan(system.indexOf(completion));
  });
});
