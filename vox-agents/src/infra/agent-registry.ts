/**
 * @module infra/agent-registry
 *
 * Global agent registry for Vox Agents.
 * Provides centralized registration and discovery of all available agents,
 * eliminating the need to register agents for each VoxContext instance.
 */

import { VoxAgent, AgentParameters } from "./vox-agent.js";
import { createLogger } from "../utils/logger.js";
import { SimpleStrategist } from "../strategist/agents/simple-strategist.js";
import { SimpleStrategistBriefed } from "../strategist/agents/simple-strategist-briefed.js";
import { SimpleBriefer } from "../briefer/simple-briefer.js";
import { SpecializedBriefer } from "../briefer/specialized-briefer.js";
import { NoneStrategist } from "../strategist/agents/none-strategist.js";
import { NullStrategist } from "../strategist/agents/null-strategist.js";
import { Spokesperson } from "../envoy/spokesperson.js";
import { Diplomat } from "../envoy/diplomat.js";
import { DiplomaticAnalyst } from "../analyst/diplomatic-analyst.js";
import { SimpleStrategistStaffed } from "../strategist/agents/simple-strategist-staffed.js";
import { SimpleStrategistLearned } from "../strategist/agents/simple-strategist-learned.js";
import { KeywordLibrarian } from "../librarian/keyword-librarian.js";
import { TalkativeTelepathist } from "../telepathist/talkative-telepathist.js";
import { Summarizer } from "../telepathist/summarizer.js";
import { EpisodeRetriever } from "../telepathist/episode-retriever.js";
import { OracleAgent } from "../oracle/oracle-agent.js";

/**
 * Registry for managing available Vox agents.
 * Provides centralized registration, discovery, and management of all agents.
 */
class AgentRegistry {
  private logger = createLogger('AgentRegistry');

  /**
   * Map of registered agents indexed by their names
   */
  private agents: Map<string, VoxAgent<any>> = new Map();

  /**
   * Flag to track if default agents have been initialized
   */
  private defaultsInitialized: boolean = false;

  /**
   * Register an agent in the registry.
   *
   * @param agent - The agent to register
   * @returns true if the agent was newly registered, false if it replaced an existing one
   */
  public register<T extends AgentParameters>(agent: VoxAgent<T>): boolean {
    const isReplacement = this.agents.has(agent.name);

    if (isReplacement) {
      this.logger.warn(`Agent ${agent.name} is already registered, replacing existing agent`);
    }

    this.agents.set(agent.name, agent);
    this.logger.info(`Agent registered: ${agent.name} - ${agent.description}`);

    return !isReplacement;
  }

  /**
   * Get an agent from the registry by name.
   *
   * @param name - The name of the agent to retrieve
   * @returns The agent if found, undefined otherwise
   */
  public get<T extends AgentParameters>(name: string): VoxAgent<T> | undefined {
    return this.agents.get(name) as VoxAgent<T> | undefined;
  }

  /**
   * Get all registered agents.
   *
   * @returns Array of all registered agents
   */
  public getAll(): VoxAgent<any>[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get all registered agents as a record/object.
   * Maintains backward compatibility with existing code.
   *
   * @returns Record of all registered agents indexed by name
   */
  public getAllAsRecord(): Record<string, VoxAgent<any>> {
    const record: Record<string, VoxAgent<any>> = {};
    for (const [name, agent] of this.agents) {
      record[name] = agent;
    }
    return record;
  }

  /**
   * Check if an agent is currently registered.
   *
   * @param name - The name of the agent to check
   * @returns true if the agent is registered, false otherwise
   */
  public has(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * Initialize the default agents in the registry.
   * This function registers all the built-in agents that ship with vox-agents.
   * Safe to call multiple times - will only initialize once.
   */
  public initializeDefaults(): void {
    if (this.defaultsInitialized) {
      this.logger.debug('Default agents already initialized, skipping');
      return;
    }

    this.logger.info('Initializing default agents');

    // Register strategist agents
    this.register(new SimpleStrategist());
    this.register(new SimpleStrategistBriefed());
    this.register(new SimpleStrategistStaffed());
    this.register(new SimpleStrategistLearned());
    this.register(new NoneStrategist());
    this.register(new NullStrategist());

    // Register briefer agents
    this.register(new SimpleBriefer());
    this.register(new SpecializedBriefer());

    // Register librarian agents
    this.register(new KeywordLibrarian());

    // Register envoy agents
    this.register(new Spokesperson());
    this.register(new Diplomat());
    this.register(new DiplomaticAnalyst());

    // Register telepathist agents
    this.register(new TalkativeTelepathist());
    this.register(new Summarizer());
    this.register(new EpisodeRetriever());

    // Register oracle agent
    this.register(new OracleAgent());

    this.defaultsInitialized = true;
    this.logger.info(`Default agents initialized: ${this.agents.size} agents registered`);
  }
}

// Export singleton instance
export const agentRegistry = new AgentRegistry();

// Export type for testing or extension
export type { AgentRegistry };

// Auto-initialize default agents on module load
agentRegistry.initializeDefaults();