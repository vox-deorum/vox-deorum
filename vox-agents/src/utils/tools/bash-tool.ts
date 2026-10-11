/**
 * @module utils/tools/bash-tool
 *
 * The `bash` tool: runs a script in the calling player's workspace (see
 * utils/workspace/player-workspace.ts). Registered only on contexts whose seat turns files on.
 */

import { z } from 'zod';
import type { AgentParameters } from '../../infra/vox-agent.js';
import type { VoxContext } from '../../infra/vox-context.js';
import type { ResolvedFilesConfig } from '../../types/config.js';
import {
  workspaceCatalogFile,
  workspaceCwd,
  workspaceRecordsPath,
  workspaceReferenceMountPath,
  workspaceScratchPath,
  type WorkspaceExecResult,
} from '../workspace/player-workspace.js';
import { createSimpleTool } from './simple-tools.js';
import { bashToolName } from './tool-names.js';
import { errorMessage } from '../errors.js';

export { bashToolName } from './tool-names.js';

/** One line per mount, naming its virtual path and access, for the tool description. */
function describeMounts(files: ResolvedFilesConfig): string[] {
  const lines: string[] = [
    `- ${workspaceRecordsPath} (read): reports, events, and briefings the game recorded for each turn. ${workspaceCatalogFile} indexes sections, gaps, briefings, and file sizes`,
    `- ${workspaceReferenceMountPath} (read): game reference on technologies, policies, buildings, and units`,
  ];
  if (files.game) lines.push(`- ${workspaceCwd}/game (${files.game}): notes for your civilization in this game`);
  for (const [name, access] of Object.entries(files.shared)) {
    lines.push(`- ${workspaceCwd}/shared/${name} (${access}): shared across games and seats`);
  }
  lines.push(`- ${workspaceScratchPath} (write): scratch space shared by your civilization's agents, kept for this game`);
  return lines;
}

/** A failed command result carrying only an error message. */
function failure(message: string): WorkspaceExecResult {
  return { stdout: '', stderr: message, exitCode: 1 };
}

/**
 * Create the bash tool for a context. The description is fixed by the context's files setting,
 * so it stays the same for every call. Each call runs in the workspace of the player and game in
 * the active parameters, stops with the active run, and commits its note changes under the
 * parameters' turn and the running agent's name.
 *
 * @param context - A context whose `files` setting is on
 */
export function createBashTool<TParameters extends AgentParameters>(context: VoxContext<TParameters>) {
  const files = context.files;
  if (!files) throw new Error('The bash tool needs a context with files turned on.');

  return createSimpleTool<TParameters, { Command: string }, WorkspaceExecResult>({
    name: bashToolName,
    description: [
      `Run a bash script in a simulated shell with file access. Each call starts in ${workspaceCwd} with a fresh shell state. Mounted folders:`,
      ...describeMounts(files),
      'Files written anywhere else disappear after the call. There is no network, Python, or JavaScript.',
      'Available commands include ls, cat, head, tail, grep, rg, sed, awk, find, sort, jq, sqlite3, and tee. Write files with heredocs.',
      'Each round of bash calls uses one step of your limited step budget, so make independent calls together in the same round or combine them in one script.',
      'Returns stdout, stderr, and exitCode; long output is truncated.',
    ].join('\n'),
    inputSchema: z.object({
      Command: z.string().describe('The bash script to run. Combine related reads and writes into one script.'),
    }),
    execute: async (input, parameters) => {
      let workspace;
      try {
        workspace = context.workspace(parameters.gameID, parameters.playerID);
      } catch (error) {
        return failure(`Could not open the workspace: ${errorMessage(error)}`);
      }
      if (!workspace) return failure('No workspace is available for this player.');
      return workspace.exec(input.Command, context.currentSignal(), {
        turn: parameters.turn ?? null,
        author: context.currentAgentName ?? 'host',
      });
    },
  }, context);
}
