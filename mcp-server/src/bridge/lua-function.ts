/**
 * LuaFunction encapsulates a Lua function with lazy registration
 * Handles automatic registration and retry on errors
 */

import { createLogger } from '../utils/logger.js';
import { MCPServer } from '../server.js';
import type { LuaResponse } from './manager.js';
import { readFileSync } from 'fs';
import { basename } from 'path';

const logger = createLogger('LuaFunction');

/**
 * Represents a Lua function that can be registered and executed
 */
export class LuaFunction {
  public readonly name: string;
  public readonly arguments: string[];
  public readonly script: string;
  private _registered: boolean = false;
  private _registrationPromise: Promise<boolean> | null = null;

  /**
   * Create a new LuaFunction
   */
  constructor(name: string, args: string[], script: string) {
    this.name = name;
    this.arguments = args;
    this.script = script;
  }

  /**
   * Create a LuaFunction instance from a Lua file
   * @param filepath Path to the Lua script file
   * @param functionName Name for the function (defaults to filename without extension)
   * @param args Array of argument names for the function
   * @param replacements Optional replacements to apply to the script (e.g., template variables)
   * @returns New LuaFunction instance
   */
  public static fromFile(
    filepath: string,
    functionName?: string,
    args: string[] = [],
    replacements?: Record<string, string>
  ): LuaFunction {
    // Read the Lua script from file
    let script = readFileSync(`lua/${filepath}`, 'utf-8');

    // Apply replacements if provided
    if (replacements) {
      for (const [placeholder, value] of Object.entries(replacements)) {
        const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        script = script.replace(regex, value);
      }
    }

    // Use filename without extension as default function name
    const name = functionName || basename(filepath, '.lua');

    return new LuaFunction(name, args, script);
  }

  /**
   * Check if the function is registered
   */
  public get registered(): boolean {
    return this._registered;
  }

  /**
   * Register the function with the Bridge Service
   */
  public async register(): Promise<boolean> {
    // If already registered, return success
    if (this._registered) {
      return true;
    }

    // If registration is already in progress, wait for it
    if (this._registrationPromise)
      return this._registrationPromise;

    // Start new registration
    this._registrationPromise = this.performRegistration();
    
    try {
      const result = await this._registrationPromise;
      return result;
    } finally {
      // Clear the promise after completion
      this._registrationPromise = null;
    }
  }

  /**
   * Perform the actual registration
   */
  private async performRegistration(): Promise<boolean> {
    logger.info(`Registering function: ${this.name}`);
    
    // Create registration script that defines the function
    const registrationScript = (this.script.indexOf("Game.RegisterFunction") === -1 ? `
      Game.RegisterFunction("${this.name}", function(${this.arguments.join(", ")}) ${this.script}
      end)
      return true
    ` : this.script.replace("${Name}", this.name).replace("${Arguments}", this.arguments.join(", "))).trim();

    await MCPServer.getInstance().getBridgeManager().addFunction(this);
    const response = await MCPServer.getInstance().getBridgeManager().executeLuaScript(registrationScript);
    
    if (response.success) {
      this._registered = true;
      logger.info(`Successfully registered function: ${this.name}`);
      return true;
    } else {
      logger.error(`Failed to register function ${this.name}:`, response.error);
      return false;
    }
  }

  /**
   * Execute the function with given arguments
   */
  public async execute(...args: any[]): Promise<LuaResponse> {
    const bridgeManager = MCPServer.getInstance().getBridgeManager();
    // Try to register with the manager if not already done
    if (!this._registered) await this.register();

    // Try to execute the function
    let response = await bridgeManager.callLuaFunction(this.name, args);

    // If failed due to unregistered function, try to register and retry
    if (!response.success && response.error?.code === 'INVALID_FUNCTION') {
      logger.debug(`Function ${this.name} not registered, attempting registration`);
      
      // Try to register
      this._registered = false;
      const registered = await this.register();
      
      if (registered) {
        // Retry the execution
        logger.debug(`Retrying execution of ${this.name} after registration`);
        response = await bridgeManager.callLuaFunction(this.name, args);
      } else {
        return {
          success: false,
          error: {
            code: 'REGISTRATION_FAILED',
            message: `Failed to register function ${this.name}`,
          },
        };
      }
    }

    // Log failed calls here so every getter and tool surfaces the real Lua error.
    // DLL_DISCONNECTED is expected while the game reloads.
    if (!response.success && response.error?.code !== 'DLL_DISCONNECTED') {
      logger.warn(`Lua function ${this.name} failed: ${response.error?.code ?? 'UNKNOWN'} ${response.error?.message ?? ''}`.trim());
    }

    return response;
  }

  /**
   * Reset the registration state
   */
  public resetRegistration(): void {
    this._registered = false;
    this._registrationPromise = null;
    logger.debug(`Reset registration for function: ${this.name}`);
  }
}