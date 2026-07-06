/**
 * @module oracle/oracle
 *
 * Public API for Oracle experiments.
 * Two composable phases: retrieve (raw telemetry extraction) and replay (LLM execution).
 *
 * See docs/oracle.md for full documentation.
 */

export { runRetrieve } from './retriever.js';
export { runReplay } from './replayer.js';

// The shared 'tool' -> 'action' prose transform, so experiments can apply it manually
// to `ctx.system` when reproducing the original model's action view.
export { reframeToolWording } from '../utils/models/tool-rescue/prompt.js';
