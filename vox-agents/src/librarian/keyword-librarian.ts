/**
 * @module librarian/keyword-librarian
 *
 * Keyword-based librarian agent that uses keyword search.
 * LLM generates keywords as JSON text, then programmatically calls search-database tool to find results.
 */

import { ModelMessage } from "ai";
import { z } from "zod";
import { Librarian } from "./librarian.js";
import { VoxContext } from "../infra/vox-context.js";
import { StrategistParameters } from "../strategist/strategy-parameters.js";

/**
 * Keyword output schema for LLM JSON generation
 */
const KeywordOutputSchema = z.object({
  contexts: z.array(z.object({
    contextNumber: z.number().describe("Context number (1-indexed)"),
    keywords: z.array(z.string()).describe("Search keywords for this context (3-5 keywords max)")
  }))
});

type KeywordOutput = z.infer<typeof KeywordOutputSchema>;

/**
 * Keyword-based librarian that generates keywords and searches the game database.
 * Uses a two-phase approach:
 * 1. LLM generates search keywords as JSON text (not structured output)
 * 2. Programmatically calls search-database tool and formats results
 *
 * @class
 */
export class KeywordLibrarian extends Librarian {
  /**
   * The name identifier for this agent
   */
  readonly name = "keyword-librarian";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "Analyzes contexts and generates search keywords for game database lookup";

  /**
   * Gets the system prompt for the librarian
   */
  public async getSystem(
    _parameters: StrategistParameters,
    _input: string[],
    _context: VoxContext<StrategistParameters>
  ): Promise<string> {
    return `
You are a research librarian for Civilization V with the Vox Populi mod.
Your task is to analyze briefing contexts and generate search keywords.

# Task
For each provided context, identify 3-5 relevant search keywords for:
- Technologies (e.g., "Writing", "Bronze Working", "Archery")
- Buildings (e.g., "Library", "Barracks", "Granary")
- Units (e.g., "Archer", "Warrior", "Composite Bowman")
- Policies (e.g., "Tradition", "Honor", "Liberty")
- Civilizations (e.g., "Rome", "Babylon", "Arabia")

# Guidelines
- Extract keywords from explicit mentions in the context
- Infer related game concepts based on strategic themes
- Keep keywords specific and concrete (not vague terms like "military")
- Limit to 3-5 most relevant keywords per context
- If context is empty or irrelevant, return empty keywords array

# Output Format
Return JSON following this exact schema:
{
  "contexts": [
    {
      "contextNumber": 1,
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}`.trim();
  }

  /**
   * Gets the initial messages for the conversation
   */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: string[],
    context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    // Format contexts as numbered list
    const formattedContexts = input
      .map((ctx, idx) => {
        if (!ctx || ctx.trim().length === 0) {
          return `## Context ${idx + 1}\n(Empty - skip)`;
        }
        return `## Context ${idx + 1}\n${ctx}`;
      })
      .join("\n\n");

    return [
      {
        role: "user",
        content: `Analyze these contexts and generate search keywords:\n\n${formattedContexts}`
      }
    ];
  }

  /**
   * Gets the list of active tools for this agent.
   * Returns empty array because LLM only generates JSON, doesn't call tools.
   */
  public getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return []; // LLM doesn't call tools - just generates keywords
  }

  /**
   * Async getOutput that parses keywords and performs searches.
   *
   * Phase 1: Parse LLM JSON output to extract keywords
   * Phase 2: Call search-database tool for each context
   * Phase 3: Format results as markdown
   */
  public async getOutput(
    parameters: StrategistParameters,
    input: string[],
    finalText: string,
    context: VoxContext<StrategistParameters>
  ): Promise<string[] | undefined> {
    if (!finalText || finalText.trim().length === 0) {
      this.logger.warn("No keywords generated, returning empty results");
      return input.map(() => "");
    }

    // Parse keywords from LLM JSON output
    let keywordData: KeywordOutput;
    try {
      keywordData = KeywordOutputSchema.parse(JSON.parse(finalText));
      this.logger.info("Parsed keyword data", {
        contextsCount: keywordData.contexts.length
      });
    } catch (error) {
      this.logger.error("Failed to parse keyword JSON", error);
      return input.map(() => "");
    }

    // For each context, search and format results
    const results: string[] = [];

    for (let i = 0; i < input.length; i++) {
      const ctx = keywordData.contexts.find(c => c.contextNumber === i + 1);

      if (!ctx || ctx.keywords.length === 0) {
        this.logger.debug(`No keywords for context ${i + 1}, skipping search`);
        results.push("");
        continue;
      }

      this.logger.info(`Searching for context ${i + 1}`, {
        keywords: ctx.keywords
      });

      // Programmatically call search-database tool
      const searchResults = await context.callTool<Record<string, Record<string, unknown>>>("search-database", {
        Keywords: ctx.keywords,
        MaxResults: 10
      }, parameters);

      // Format results as markdown
      const formatted = this.formatSearchResults(searchResults, i + 1);
      results.push(formatted);
    }

    return results;
  }

  /**
   * Format search results as markdown.
   *
   * @param searchResults - Results from search-database tool
   * @param contextNum - Context number for logging
   * @returns Formatted markdown string
   */
  private formatSearchResults(searchResults: Record<string, Record<string, unknown>> | undefined, contextNum: number): string {
    if (!searchResults || Object.keys(searchResults).length === 0) {
      this.logger.debug(`No search results for context ${contextNum}`);
      return "";
    }

    let formatted = "";

    for (const [name, data] of Object.entries(searchResults)) {
      const relevance = (data.Relevance as number) ?? 0;
      formatted += `**${name}** (Relevance: ${relevance.toFixed(2)})\n`;

      // Add other relevant fields
      for (const [key, value] of Object.entries(data)) {
        if (key !== 'Relevance' && key !== 'Name') {
          formatted += `  - ${key}: ${value}\n`;
        }
      }
      formatted += `\n`;
    }

    this.logger.info(`Formatted ${Object.keys(searchResults).length} results for context ${contextNum}`);
    return formatted.trim();
  }

  /** Keyword extraction runs at the low reasoning tier. */
  protected reasoningTier = "low" as const;
}
