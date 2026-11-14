/**
 * @module librarian/librarian
 *
 * Base librarian agent implementation.
 * Librarians research game database information based on provided contexts.
 * Subclasses implement specific search strategies (keyword-based, embedding-based, etc.)
 */

import { VoxAgent } from "../agents/runtime/vox-agent.js";
import { StrategistParameters } from "../strategist/strategy-parameters.js";

/**
 * Base librarian agent that researches game database information.
 * Takes an array of context strings and returns an array of formatted search results.
 *
 * This is a minimal base class - subclasses implement all search logic.
 *
 * @abstract
 * @class
 */
export abstract class Librarian extends VoxAgent<StrategistParameters, string[], string[]> {
  /** Librarians extract and retrieve information using the routine model. */
  public modelSize = 'small' as const;

  // Minimal base class - just defines the type structure
  // Subclasses handle all implementation details
}
