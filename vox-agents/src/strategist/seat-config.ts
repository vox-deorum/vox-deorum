/**
 * @module strategist/seat-config
 *
 * Reads a seat's agent roles and resolves its triage setting. Shared by session preflight,
 * player assignments, and the seat context so the defaults live in one place.
 */

import type { PlayerConfig, TriageSetting } from "../types/config.js";
import { config } from "../utils/config.js";

/** Agent that voices a seat's diplomacy when the seat doesn't name one. */
export const defaultDiplomat = "diplomat";

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
