/**
 * Tests for the host-capability reminder. Assertions compose against the exported
 * instruction builders and guide-file table rather than the wording itself.
 */

import { describe, expect, it } from 'vitest';
import { wrapLanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import {
  hostCapabilityHeading,
  hostCapabilityInstruction,
  hostCapabilityMiddleware,
} from '../../../../src/utils/models/providers/host-capability-prompt.js';
import { hostWorkspaceGuideFiles } from '../../../../src/utils/models/providers/host-tools.js';
import {
  requiredToolChoiceInstruction,
  requiredToolChoiceMiddleware,
} from '../../../../src/utils/models/providers/required-tool-choice.js';

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
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    } as any),
  });
}

describe('hostCapabilityInstruction', () => {
  it('returns nothing when no capability is enabled', () => {
    expect(hostCapabilityInstruction('codex', { read: false, write: false, web: false })).toBeUndefined();
  });

  it('opens with the shared heading', () => {
    const instruction = hostCapabilityInstruction('codex', { read: true, write: false, web: false })!;
    expect(instruction.startsWith(hostCapabilityHeading)).toBe(true);
  });

  it('describes only Read and the Codex workspace guide', () => {
    const instruction = hostCapabilityInstruction('codex', { read: true, write: false, web: false })!;
    expect(instruction).toContain('Read');
    expect(instruction).toContain(hostWorkspaceGuideFiles.codex);
    expect(instruction).not.toContain(hostWorkspaceGuideFiles['claude-code']);
    expect(instruction).not.toContain('Write');
    expect(instruction).not.toContain('Web');
  });

  it('describes Write with its implied Read capability and editable Claude guide', () => {
    const instruction = hostCapabilityInstruction('claude-code', { read: true, write: true, web: false })!;
    expect(instruction).toContain('Read and Write');
    expect(instruction).toContain(hostWorkspaceGuideFiles['claude-code']);
    expect(instruction).not.toContain(hostWorkspaceGuideFiles.codex);
    expect(instruction).not.toContain('Web');
  });

  it('describes Web without inventing a filesystem workspace', () => {
    const instruction = hostCapabilityInstruction('codex', { read: false, write: false, web: true })!;
    expect(instruction).toContain('Web');
    for (const guide of Object.values(hostWorkspaceGuideFiles)) {
      expect(instruction).not.toContain(guide);
    }
  });

  it('lists each capability when all are enabled', () => {
    const instruction = hostCapabilityInstruction('codex', { read: true, write: true, web: true })!;
    expect(instruction).toContain('Read, Write, and Web');
  });

  it.each([
    ['codex', 'terminal tools'],
    ['claude-code', 'terminal actions'],
  ] as const)('names the real %s %s after the ordering rule', (provider, terminalNoun) => {
    const instruction = hostCapabilityInstruction(
      provider,
      { read: true, write: false, web: false },
      ['found_city', 'send_message'],
    )!;
    expect(instruction).toContain(`before any ${terminalNoun}: \`found_city\` or \`send_message\``);
  });

  it('omits terminal guidance when no terminal tool is active', () => {
    const instruction = hostCapabilityInstruction('codex', { read: true, write: false, web: false })!;
    expect(instruction).not.toContain('terminal');
  });
});

describe('hostCapabilityMiddleware', () => {
  it('leaves the params untouched when no capability is enabled', async () => {
    const params: any = { prompt: [{ role: 'user', content: [] }] };
    const middleware = hostCapabilityMiddleware('codex', { read: false, write: false, web: false });
    const out = await (middleware.transformParams as any)({ params });
    expect(out).toBe(params);
  });

  it('keeps the Codex host reminder ahead of its required-tool instruction', async () => {
    const access = { read: true, write: false, web: false };
    const recorder = recordingModel();
    const model = wrapLanguageModel({
      model: recorder,
      middleware: [
        hostCapabilityMiddleware('codex', access, ['found_city', 'inactive_tool']),
        requiredToolChoiceMiddleware({ completionTools: ['found_city'] }),
      ],
    });

    await model.doGenerate({
      prompt: [
        { role: 'system', content: 'Make sound strategic decisions.' },
        { role: 'user', content: [{ type: 'text', text: 'Take the turn.' }] },
      ],
      tools: [functionTool('found_city'), functionTool('get_briefing')],
      toolChoice: { type: 'required' },
      providerOptions: {},
    } as any);

    const system = (recorder as any).doGenerateCalls.at(-1).prompt[0].content as string;
    const hostInstruction = hostCapabilityInstruction('codex', access, ['found_city'])!;
    const requiredInstruction = requiredToolChoiceInstruction(['found_city', 'get_briefing'], ['found_city'], false)!;
    expect(system).toContain(hostInstruction);
    expect(system).toContain(requiredInstruction);
    expect(system).not.toContain('inactive_tool');
    expect(system.indexOf(hostInstruction)).toBeLessThan(system.indexOf(requiredInstruction));
  });
});
