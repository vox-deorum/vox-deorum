/**
 * @module strategist/seat-config
 *
 * Reads a seat's agent roles and resolves its triage, files, and prompts settings. Shared by session
 * preflight, player assignments, and the seat context so the defaults live in one place.
 */

import type { FilesConfig, FilesSetting, PlayerConfig, PromptsSetting, ResolvedFilesConfig, TriageSetting } from "../types/config.js";
import { config } from "../utils/config.js";
import { checkPromptsSetting } from "../utils/prompts/prompt-files.js";

/** Agent that voices a seat's diplomacy when the seat doesn't name one. */
export const defaultDiplomat = "diplomat";

/** Minimum step limit of one agent execution with files on, when the files setting doesn't name a quota. */
export const defaultFilesQuota = 20;

/** The agent names filling a seat's roles, with the diplomat defaulted. */
export interface SeatAgents {
  strategist: string;
  diplomat: string;
  negotiator?: string;
}

/**
 * Read a seat's role agents, rejecting any role that isn't an agent name. Options such as
 * triage have their own fields, so an object here is a misconfiguration worth failing on.
 *
 * @param playerConfig - The seat's configuration
 * @param slot - The seat's config slot, used in the error message
 * @throws if strategist, diplomat, or negotiator is set to something other than a string
 */
export function seatAgents(playerConfig: PlayerConfig, slot: string | number): SeatAgents {
  for (const role of ["strategist", "diplomat", "negotiator"] as const) {
    const value = playerConfig[role];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`llmPlayers.${slot}.${role} must be an agent name; use \`triage\` to turn triage on.`);
    }
  }
  return {
    strategist: playerConfig.strategist,
    diplomat: playerConfig.diplomat ?? defaultDiplomat,
    negotiator: playerConfig.negotiator,
  };
}

/**
 * Resolve the triage setting for one seat: the seat's own value, else the session's, else the
 * root config's, else off. A list gains the seat's agent for each role it names, so
 * `["diplomat"]` also covers a seat whose diplomat is a custom agent.
 *
 * @param playerConfig - The seat's configuration
 * @param sessionTriage - The session config's top-level triage setting
 * @param slot - The seat's config slot, used to identify an invalid seat setting
 */
export function resolveSeatTriage(playerConfig: PlayerConfig, sessionTriage?: TriageSetting, slot?: string | number): TriageSetting {
  let setting: unknown = config.triage === undefined ? false : config.triage;
  let source = "config.triage";
  if (sessionTriage !== undefined) {
    setting = sessionTriage;
    source = "session.triage";
  }
  if (playerConfig.triage !== undefined) {
    setting = playerConfig.triage;
    source = slot === undefined ? "seat triage" : `llmPlayers.${slot}.triage`;
  }

  if (typeof setting === "boolean") return setting;
  if (!Array.isArray(setting) || !setting.every((name: unknown) => typeof name === "string" && name.trim().length > 0)) {
    throw new Error(`${source} must be a boolean or a list of non-empty agent names.`);
  }

  const names = new Set<string>(setting);
  if (names.has("strategist")) names.add(playerConfig.strategist);
  if (names.has("diplomat")) names.add(playerConfig.diplomat ?? defaultDiplomat);
  return [...names];
}

/**
 * Resolve the files setting for one seat: the seat's own value, else the session's, else the
 * root config's, else off. The highest level that sets a value replaces lower levels whole.
 * The `"read"` / `"write"` shorthand expands to game access; an object is validated and
 * normalized so the quota always has a value. Returns undefined when nothing would be mounted.
 *
 * @param playerConfig - The seat's configuration
 * @param sessionFiles - The session config's top-level files setting
 * @param slot - The seat's config slot, used to identify an invalid seat setting
 * @throws if the winning value is not a valid files setting; the message names the config path
 */
export function resolveSeatFiles(playerConfig: PlayerConfig, sessionFiles?: FilesSetting, slot?: string | number): ResolvedFilesConfig | undefined {
  let setting: unknown = config.files === undefined ? false : config.files;
  let source = "config.files";
  if (sessionFiles !== undefined) {
    setting = sessionFiles;
    source = "session.files";
  }
  if (playerConfig.files !== undefined) {
    setting = playerConfig.files;
    source = slot === undefined ? "seat files" : `llmPlayers.${slot}.files`;
  }

  if (setting === false) return undefined;
  if (setting === "read" || setting === "write") setting = { game: setting };
  if (typeof setting !== "object" || setting === null || Array.isArray(setting)) {
    throw new Error(`${source} must be false, "read", "write", or an object with game, shared and quota.`);
  }

  const files = setting as Record<string, unknown>;
  for (const key of Object.keys(files)) {
    if (key !== "game" && key !== "shared" && key !== "quota") {
      throw new Error(`${source}.${key} is not a files option; allowed keys are game, shared and quota.`);
    }
  }
  const { game, shared, quota } = files;
  if (game !== undefined && game !== false && game !== "read" && game !== "write") {
    throw new Error(`${source}.game must be false, "read" or "write".`);
  }
  if (shared !== undefined && (typeof shared !== "object" || shared === null || Array.isArray(shared))) {
    throw new Error(`${source}.shared must be an object of folder names to "read" or "write".`);
  }
  if (shared !== undefined) {
    for (const [name, access] of Object.entries(shared)) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
        throw new Error(`${source}.shared.${name} must be a folder name of lowercase letters, digits, "_" and "-", starting with a letter or digit.`);
      }
      if (access !== "read" && access !== "write") {
        throw new Error(`${source}.shared.${name} must be "read" or "write".`);
      }
    }
  }
  if (quota !== undefined && (!Number.isInteger(quota) || (quota as number) <= 0)) {
    throw new Error(`${source}.quota must be a positive integer.`);
  }

  const resolved = files as FilesConfig;
  if ((game !== "read" && game !== "write") && Object.keys(resolved.shared ?? {}).length === 0) {
    return undefined;
  }
  return {
    game: resolved.game ?? false,
    shared: { ...resolved.shared },
    quota: resolved.quota ?? defaultFilesQuota,
  };
}

/**
 * Resolve the custom prompt folder for one seat: the seat's own value, else the session's, else
 * the root config's, else the built-ins (false). Only the setting is checked here; the folder's
 * templates are validated when the session loads them.
 *
 * @param playerConfig - The seat's configuration
 * @param sessionPrompts - The session config's top-level prompts setting
 * @param slot - The seat's config slot, used to identify an invalid seat setting
 * @throws if the winning value is neither false nor a folder path
 */
export function resolveSeatPrompts(playerConfig: PlayerConfig, sessionPrompts: PromptsSetting | undefined, slot: string | number): PromptsSetting {
  if (playerConfig.prompts !== undefined) return checkPromptsSetting(playerConfig.prompts, `llmPlayers.${slot}.prompts`);
  if (sessionPrompts !== undefined) return checkPromptsSetting(sessionPrompts, "session.prompts");
  return checkPromptsSetting(config.prompts ?? false, "config.prompts");
}
