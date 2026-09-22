/**
 * Contract tests for the single-call evaluation path (src/infra/vox-evaluate.ts). The evaluate
 * call is declared but unimplemented: VoxContext.evaluate() and evaluateOn() must both fail
 * loudly for any input, and must not require an active run to report that.
 */

import { describe, it, expect } from 'vitest';
import { VoxContext } from '../../../src/infra/vox-context.js';
import { evaluateOn } from '../../../src/infra/vox-evaluate.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import type { Model } from '../../../src/types/index.js';

const testModel = { provider: 'test', name: 'test' } as Model;

describe('VoxContext.evaluate', () => {
  it('should reject with the not-implemented error without needing an active run', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'evaluate-stub');

    await expect(ctx.evaluate(testModel, {}, undefined))
      .rejects.toThrow(/not implemented; see docs\/plans\/evaluation-models\.md/);
  });
});

describe('evaluateOn', () => {
  it('should reject the same way when called directly on the module', async () => {
    const host = {} as any;

    await expect(evaluateOn(host, testModel, { any: 'state' }))
      .rejects.toThrow(/not implemented; see docs\/plans\/evaluation-models\.md/);
  });
});
