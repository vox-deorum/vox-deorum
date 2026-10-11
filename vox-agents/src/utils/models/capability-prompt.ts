/**
 * Prompt guidance for optional agent capabilities: the bash workspace on any provider, and
 * native web access on CLI providers.
 */

import type { LanguageModelV4Middleware } from '@ai-sdk/provider';
import type { PromptsSetting, ResolvedFilesConfig } from '../../types/config.js';
import { renderSystemPrompt } from '../prompts/prompt-files.js';
import { bashToolName, formatToolChoiceList } from '../tools/tool-names.js';
import { workspaceOutputLimit } from '../workspace/player-workspace.js';
import { clientFunctionToolNames } from './providers/required-tool-choice.js';
import { appendSystemInstruction } from './providers/system-prompt.js';

/** Heading that opens every capability reminder. */
export const capabilityHeading = '# Extra Capabilities';

/** What the prompt calls a tool: 'actions' under Claude Code's action framing. */
export type TerminalNoun = 'tools' | 'actions';

/** The capabilities a request may describe. */
export interface Capabilities {
  /** The seat's workspace, described only when the request declares the bash tool. */
  files?: ResolvedFilesConfig;
  /** The latest recorded turn, used by the workspace examples; undefined before any is recorded. */
  latestTurn?: number;
  /** Native web search and fetch, executed by a CLI provider. */
  web: boolean;
}

/** Install options for the capability middleware. */
export interface CapabilityMiddlewareOptions {
  /** The calling agent's completion tools, named as what to call after the capabilities. */
  completionTools?: string[];
  terminalNoun?: TerminalNoun;
  /** The run's prompt folder setting; undefined uses the root setting. */
  prompts?: PromptsSetting;
}

/**
 * The workspace section from `prompts/workspace.md`: mounted folders, expectations for using bash,
 * and how to read large files, with examples on the latest recorded turn folder.
 */
function workspaceSection(
  files: ResolvedFilesConfig,
  terminalNoun: TerminalNoun,
  latestTurn: number | undefined,
  prompts: PromptsSetting | undefined,
): string {
  return renderSystemPrompt(prompts === undefined ? undefined : { prompts }, 'workspace', {
    toolName: bashToolName,
    toolNoun: terminalNoun === 'actions' ? 'action' : 'tool',
    terminalNoun,
    game: files.game ? { access: files.game } : false,
    shared: Object.entries(files.shared).map(([name, access]) => ({ name, access })),
    outputLimit: workspaceOutputLimit.toLocaleString('en-US'),
    hasTurn: latestTurn !== undefined,
    turn: latestTurn ?? '<N>',
  });
}

/** The web section for CLI providers with native web access. */
const webSection = `## Web
- You can search the web and fetch current online information.`;

/**
 * Build a brief capability reminder. It contains only working guidance, leaving game facts to
 * the agent's task and game context. Workspace guidance needs `files`, which callers pass only
 * when the request declares bash, so the reminder never describes a tool the call lacks.
 *
 * @param capabilities - The workspace and web access to describe
 * @param terminalNames - Completion tools declared on this request
 * @param terminalNoun - What the prompt calls a tool
 * @param prompts - The prompt folder setting for the workspace template; undefined uses the root
 */
export function capabilityInstruction(
  capabilities: Capabilities,
  terminalNames: string[] = [],
  terminalNoun: TerminalNoun = 'tools',
  prompts?: PromptsSetting,
): string | undefined {
  const { files, latestTurn, web } = capabilities;
  if (!files && !web) return undefined;

  const terminalList = formatToolChoiceList(terminalNames);
  const sections = [
    `${capabilityHeading}
To support your core mission, extra capabilities are enabled.`,
    files ? workspaceSection(files, terminalNoun, latestTurn, prompts) : undefined,
    web ? webSection : undefined,
    terminalList ? `If you plan to use these capabilities, use them before any terminal ${terminalNoun}: ${terminalList}.` : undefined,
  ];
  return sections.filter((section) => section !== undefined).join('\n\n');
}

/**
 * Add the capability reminder as an outer middleware wrapper. Workspace guidance and terminal
 * names follow the tools declared on each request, so the text stays fixed for a run whose
 * declarations do not change. The latest recorded turn in the workspace examples is fixed by the
 * caller for the whole run, so it changes the text only between runs.
 *
 * @param capabilities - The workspace and web access available to the model
 * @param options - Completion tools, terminology, and prompt folder
 */
export function capabilityMiddleware(
  capabilities: Capabilities,
  options: CapabilityMiddlewareOptions = {},
): LanguageModelV4Middleware {
  const completionNames = new Set(options.completionTools ?? []);
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => {
      const declared = clientFunctionToolNames(params);
      const instruction = capabilityInstruction(
        {
          files: declared.includes(bashToolName) ? capabilities.files : undefined,
          latestTurn: capabilities.latestTurn,
          web: capabilities.web,
        },
        declared.filter((name) => completionNames.has(name)),
        options.terminalNoun,
        options.prompts,
      );
      return instruction === undefined
        ? params
        : { ...params, prompt: appendSystemInstruction(params.prompt, instruction) };
    },
  };
}
