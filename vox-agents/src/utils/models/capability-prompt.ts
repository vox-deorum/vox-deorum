/**
 * Prompt guidance for optional agent capabilities: the bash workspace on any provider, and
 * native web access on CLI providers.
 */

import type { LanguageModelV4Middleware } from '@ai-sdk/provider';
import type { ResolvedFilesConfig } from '../../types/config.js';
import { bashToolName, formatToolChoiceList } from '../tools/tool-names.js';
import {
  workspaceCatalogFile,
  workspaceCwd,
  workspaceGuideFile,
  workspaceRecordsPath,
  workspaceReferenceMountPath,
} from '../workspace/player-workspace.js';
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
  /** Native web search and fetch, executed by a CLI provider. */
  web: boolean;
}

/** Install options for the capability middleware. */
export interface CapabilityMiddlewareOptions {
  /** The calling agent's completion tools, named as what to call after the capabilities. */
  completionTools?: string[];
  terminalNoun?: TerminalNoun;
}

/** One bullet per mounted folder, naming its access and purpose. */
function folderBullets(files: ResolvedFilesConfig): string[] {
  const bullets: string[] = [
    `- \`${workspaceRecordsPath}\` (read): reports, events, and briefings recorded for each turn. Read its ${workspaceCatalogFile} to find files.`,
    `- \`${workspaceReferenceMountPath}\` (read): game reference on technologies, policies, buildings, and units.`,
  ];
  if (files.game) {
    bullets.push(`- \`${workspaceCwd}/game\` (${files.game}): shared with the other agents of your civilization in this game. Read its ${workspaceGuideFile} first.`);
  }
  for (const [name, access] of Object.entries(files.shared)) {
    bullets.push(`- \`${workspaceCwd}/shared/${name}\` (${access}): outlives this game and is seen by other games and seats. Keep only general lessons and references here.`);
  }
  return bullets;
}

/** The workspace section: mounted folders, then expectations for using bash. */
function workspaceSection(files: ResolvedFilesConfig, terminalNoun: TerminalNoun): string {
  const toolNoun = terminalNoun === 'actions' ? 'action' : 'tool';
  return `## Workspace
You have a file workspace through the \`${bashToolName}\` ${toolNoun}.
${folderBullets(files).join('\n')}
- Keep notes organized. Current game information from your ${terminalNoun} should take priority over stale notes.
- Each round of \`${bashToolName}\` calls uses one step of your limited step budget.
  - Make independent \`${bashToolName}\` calls in parallel, or combine them in one script.
  - Write files with heredocs.`;
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
 */
export function capabilityInstruction(
  capabilities: Capabilities,
  terminalNames: string[] = [],
  terminalNoun: TerminalNoun = 'tools',
): string | undefined {
  const { files, web } = capabilities;
  if (!files && !web) return undefined;

  const terminalList = formatToolChoiceList(terminalNames);
  const sections = [
    `${capabilityHeading}
To support your core mission, extra capabilities are enabled.`,
    files ? workspaceSection(files, terminalNoun) : undefined,
    web ? webSection : undefined,
    terminalList ? `If you plan to use these capabilities, use them before any terminal ${terminalNoun}: ${terminalList}.` : undefined,
  ];
  return sections.filter((section) => section !== undefined).join('\n\n');
}

/**
 * Add the capability reminder as an outer middleware wrapper. Workspace guidance and terminal
 * names follow the tools declared on each request, so the text stays fixed for a run whose
 * declarations do not change.
 *
 * @param capabilities - The workspace and web access available to the model
 * @param options - Completion tools and terminology
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
      );
      return instruction === undefined
        ? params
        : { ...params, prompt: appendSystemInstruction(params.prompt, instruction) };
    },
  };
}
