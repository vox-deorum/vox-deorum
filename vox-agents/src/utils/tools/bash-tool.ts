/**
 * @module utils/tools/bash-tool
 *
 * The `bash` tool: runs a script in the calling player's workspace (see
 * utils/workspace/player-workspace.ts). Registered only on contexts whose seat turns files on.
 */

import { z } from 'zod';
import type { AgentParameters } from '../../infra/vox-agent.js';
import type { VoxContext } from '../../infra/vox-context.js';
import { workspaceCwd, type WorkspaceExecResult } from '../workspace/player-workspace.js';
import { createSimpleTool } from './simple-tools.js';
import { bashToolName } from './tool-names.js';
import { errorMessage } from '../errors.js';

export { bashToolName } from './tool-names.js';

/** A failed command result carrying only an error message. */
function failure(message: string): WorkspaceExecResult {
  return { stdout: '', stderr: message, exitCode: 1 };
}

/**
 * Render a command result as the model reads it: stdout as is, then stderr and the exit code
 * only when they carry something.
 */
export function bashResultText({ stdout, stderr, exitCode }: WorkspaceExecResult): string {
  const parts = [stdout.trimEnd()];
  if (stderr) parts.push(`[stderr]\n${stderr.trimEnd()}`);
  if (exitCode !== 0) parts.push(`[exit code ${exitCode}]`);
  return parts.filter((part) => part).join('\n') || '[completed with no output]';
}

/**
 * Create the bash tool for a context. The description covers only shell mechanics and leaves the
 * folders to the records directions, so it is the same for every seat, turn, and call. Each call
 * runs in the workspace of the player and game in the active parameters, stops with the active
 * run, and commits its note changes under the parameters' turn and the running agent's name. A run
 * that brings its own workspace, such as an oracle replay, uses that one instead.
 *
 * @param context - A context whose `files` setting is on
 */
export function createBashTool<TParameters extends AgentParameters>(context: VoxContext<TParameters>) {
  if (!context.files) throw new Error('The bash tool needs a context with files turned on.');

  return createSimpleTool<TParameters, { Command: string }, WorkspaceExecResult>({
    name: bashToolName,
    description: [
      `Run a bash script in a simulated shell with file access. Each call starts in ${workspaceCwd} with a fresh shell state. The \`# Records\` message lists the mounted folders and which ones you can write.`,
      'There is no network or Python. Available commands include ls, cat, head, tail, grep, rg, sed, awk, find, sort, jq, sqlite3, tee, and js-exec. Write files with heredocs.',
      'For calculations, run JavaScript with `js-exec -c \'...\'` or a script file; it can read and write workspace files through the `fs` module. `$(( ))` is integer-only.',
      'Returns stdout as text, followed by stderr and the exit code when they are present; long output is truncated.',
    ].join('\n'),
    inputSchema: z.object({
      Command: z.string().describe('The bash script to run. Combine related reads and writes into one script.'),
    }),
    execute: async (input, parameters) => {
      let workspace;
      try {
        workspace = context.currentWorkspace ?? context.workspace(parameters.gameID, parameters.playerID);
      } catch (error) {
        return failure(`Could not open the workspace: ${errorMessage(error)}`);
      }
      if (!workspace) return failure('No workspace is available for this player.');
      return workspace.exec(input.Command, context.currentSignal(), {
        turn: parameters.turn ?? null,
        author: context.currentAgentName ?? 'host',
      });
    },
    toModelText: bashResultText,
  }, context);
}
