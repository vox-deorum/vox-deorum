/**
 * @module strategist/pacing/registry
 *
 * Registry for pacing interruption strategies.
 */

import { createLogger } from "../../utils/logger.js";
import { NonePacingInterruption } from "./none.js";
import type { PacingInterruptionStrategy } from "./types.js";
import { WarOrPeacePacingInterruption } from "./war-or-peace.js";

/**
 * In-memory registry mapping interruption names to their strategy objects.
 * Acts as the single source of truth consumed by pacing.ts (decision logic),
 * the web API, and the config UI.
 */
class PacingInterruptionRegistry {
  private logger = createLogger("PacingInterruptionRegistry");
  private strategies: Map<string, PacingInterruptionStrategy> = new Map();
  private defaultsInitialized = false;

  /**
   * Register (or replace) a strategy keyed by its `name`.
   * @returns True if newly added, false if it replaced an existing strategy.
   */
  register(strategy: PacingInterruptionStrategy): boolean {
    const isReplacement = this.strategies.has(strategy.name);
    if (isReplacement) {
      this.logger.warn(`Pacing interruption ${strategy.name} is already registered, replacing existing strategy`);
    }

    this.strategies.set(strategy.name, strategy);
    this.logger.info(`Pacing interruption registered: ${strategy.name} - ${strategy.description ?? strategy.label}`);
    return !isReplacement;
  }

  /**
   * Remove a strategy by name.
   * @returns True if a strategy was removed, false if the name was unknown.
   */
  unregister(name: string): boolean {
    const wasDeleted = this.strategies.delete(name);
    if (wasDeleted) {
      this.logger.info(`Unregistered pacing interruption ${name} (remaining strategies: ${this.strategies.size})`);
    }
    return wasDeleted;
  }

  /** Look up a single strategy by name, or undefined if not registered. */
  get(name: string): PacingInterruptionStrategy | undefined {
    return this.strategies.get(name);
  }

  /** Return all registered strategies (used to populate the config UI). */
  getAll(): PacingInterruptionStrategy[] {
    return Array.from(this.strategies.values());
  }

  /** Return just the registered strategy names. */
  getNames(): string[] {
    return Array.from(this.strategies.keys());
  }

  /** Whether a strategy is registered under the given name. */
  has(name: string): boolean {
    return this.strategies.has(name);
  }

  /**
   * Remove all registered strategies and reset the defaults guard so a later
   * {@link initializeDefaults} call re-registers the built-ins.
   */
  clear(): void {
    this.strategies.clear();
    this.defaultsInitialized = false;
  }

  /**
   * Register built-in interruption strategies. Add future built-ins here so
   * pacing.ts and the UI continue to discover strategies through the registry.
   */
  initializeDefaults(): void {
    if (this.defaultsInitialized) return;

    this.register(new NonePacingInterruption());
    this.register(new WarOrPeacePacingInterruption());

    this.defaultsInitialized = true;
  }
}

export const pacingInterruptionRegistry = new PacingInterruptionRegistry();
export type { PacingInterruptionRegistry };

pacingInterruptionRegistry.initializeDefaults();
