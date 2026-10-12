/**
 * Prompt guidance for optional agent capabilities: the bash workspace on any provider, and
 * native web access on CLI providers.
 */

import type { LanguageModelV4Middleware } from '@ai-sdk/provider';
import type { PromptsSetting, ResolvedFilesConfig } from '../../types/config.js';
import { renderSystemPrompt } from '../prompts/prompt-files.js';
import { bashToolName, formatToolChoiceList } from '../tools/tool-names.js';
import { workspaceOutputLimit, workspaceWritable } from '../workspace/player-workspace.js';
import { clientFunctionToolNames } from './providers/required-tool-choice.js';
import { appendSystemInstruction } from './providers/system-prompt.js';

/** Heading that opens every capability reminder. */
export const capabilityHeading = '# Extra Capabilities';

/** What the prompt calls a tool: 'actions' under Claude Code's action framing. */
export type TerminalNoun = 'tools' | 'actions';

/** The singular of a {@link TerminalNoun}. */
function singular(noun: TerminalNoun): string {
  return noun === 'actions' ? 'action' : 'tool';
}

/** The capabilities a request may describe. */
export interface Capabilities {
  /** The seat's workspace, described only when the request declares the bash tool. */
  files?: ResolvedFilesConfig;
  /** Native web search and fetch, executed by a CLI provider. */
  web: boolean;
}

/** Install options for the capability middleware. */
export interface CapabilityMiddlewareOptions {
  /** The calling agent's completion tools, named as the calls that end the run. */
  completionTools?: string[];
  terminalNoun?: TerminalNoun;
  /** The run's prompt folder setting; undefined uses the root setting. */
  prompts?: PromptsSetting;
}

/**
 * The workspace section from `prompts/workspace.md`: working rules for bash, the write rule when a
 * folder is writable, and how to read large files. Folders and recorded turns live in the records
 * directions, so this text depends only on the seat's settings and stays the same across turns.
 */
function workspaceSection(
  files: ResolvedFilesConfig,
  terminalNoun: TerminalNoun,
  hasTerminals: boolean,
  prompts: PromptsSetting | undefined,
): string {
  return renderSystemPrompt(prompts === undefined ? undefined : { prompts }, 'workspace', {
    toolName: bashToolName,
    toolNoun: singular(terminalNoun),
    terminalNoun,
    writable: workspaceWritable(files),
    terminals: hasTerminals,
    outputLimit: workspaceOutputLimit.toLocaleString('en-US'),
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
  const { files, web } = capabilities;
  if (!files && !web) return undefined;

  const terminalList = formatToolChoiceList(terminalNames);
  const terminalRule = terminalList
    ? ` Calling a terminal ${singular(terminalNoun)} (${terminalList}) ends the run after that response, so make your other calls in the same response.`
    : '';
  const sections = [
    `${capabilityHeading}
To support your core mission, extra capabilities are enabled.${terminalRule}`,
    files ? workspaceSection(files, terminalNoun, terminalList !== undefined, prompts) : undefined,
    web ? webSection : undefined,
  ];
  return sections.filter((section) => section !== undefined).join('\n\n');
}

/**
 * Add the capability reminder as an outer middleware wrapper. Workspace guidance and terminal
 * names follow the tools declared on each request, so the text stays fixed for a run whose
 * declarations do not change.
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
