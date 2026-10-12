import { gameDatabase } from "../../server.js";
import { ToolBase } from "../base.js";
import * as z from "zod";
import { search } from "fast-fuzzy";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "../../utils/logger.js";
import { fetchGameTooltips, type TooltipKind } from "../../utils/database/game-tooltips.js";

const logger = createLogger('DatabaseQueryTool');

/**
 * Base class for database query tools that provides common functionality
 * for searching, filtering, and retrieving game entities
 */
export abstract class DatabaseQueryTool<
  TSummary extends Record<string, any>,
  TFull extends TSummary
> extends ToolBase {
  /**
   * Cached summary data for quick listing and searching
   */
  protected cachedSummaries: TSummary[] | null = null;

  /**
   * Schema for summary information (used for listing)
   */
  protected abstract readonly summarySchema: z.ZodSchema<TSummary>;

  /**
   * Schema for full detailed information (used for single results)
   */
  protected abstract readonly fullSchema: z.ZodSchema<TFull>;

  /**
   * Set by tools whose entries have an in-game tooltip; full reports then carry it as `Help`
   */
  protected readonly tooltipKind?: TooltipKind;

  /**
   * Optional cleanup of one item after localization; returns a copy rather than changing the item
   */
  protected formatItem?(item: TSummary): TSummary;

  /**
   * Optional annotations for database query tools
   */
  readonly annotations: ToolAnnotations = {
    readOnlyHint: true
  };

  /**
   * Optional metadata for database query tools
   */
  readonly metadata = {
    markdownConfig: ["{key}"]
  };

  /**
   * Input schema with common search parameters
   */
  readonly inputSchema = z.object({
    Search: z.string().optional().describe("Fuzzy-matching search term"),
    MaxResults: z.number().optional().default(20).describe("Maximum number to return (default: 20)"),
    Detailed: z.boolean().optional().default(false).describe("Return full details for every result, not only a single match")
  });

  /**
   * Get the actual output schema.
   */
  getOutputSchema() {
    return z.object({
      Count: z.number(),
      Items: z.array(z.union([this.summarySchema, this.fullSchema])),
      Error: z.string().optional(),
    });
  }

  /**
   * Output schema for query results
   */
  readonly outputSchema = z.object({
    Count: z.number(),
    Items: z.array(z.any()),
    Error: z.string().optional(),
  });

  /**
   * Default implementation searches common fields
   */
  protected getSearchFields(): string[] {
    return ['Name', 'Strategy', 'Era', 'Help', this.getIdentifierField() as string];
  }

  /**
   * Get the key selector function for fuzzy search
   * Override this to customize search fields
   */
  protected getSearchKeys(item: TSummary): string[] {
    return this.getSearchFields()
      .map(field => item[field])
      .filter(Boolean);
  }

  /**
   * Get the fuzzy search threshold
   * Override to adjust search sensitivity
   */
  protected getSearchThreshold(): number {
    return 0.6;
  }

  /**
   * Abstract method to fetch summary data from the database
   */
  protected abstract fetchSummaries(): Promise<TSummary[]>;

  /**
   * Abstract method to fetch full detailed information for a single item
   */
  protected abstract fetchFullInfo(identifier: string): Promise<TFull>;

  /**
   * Get the identifier field name for fetching full info
   * Override if your entity uses something other than 'Type'
   */
  protected getIdentifierField(): keyof TSummary {
    return 'Type' as keyof TSummary;
  }

  /**
   * Get cached summaries or fetch new ones
   */
  public async getSummaries(): Promise<TSummary[]> {
    if (this.cachedSummaries) return this.cachedSummaries;
    
    const results = await this.fetchSummaries();
    this.cachedSummaries = await gameDatabase.localizeObjects(results);
    return this.cachedSummaries;
  }

  /**
   * Execute the database query with common search and filtering logic
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    try {
      const summaries = await this.getSummaries();
      
      let results = summaries;
      
      // Apply fuzzy search if search term provided
      if (args.Search) {
        const matches = search(args.Search, summaries, {
          keySelector: (item: TSummary) => this.getSearchKeys(item),
          threshold: this.getSearchThreshold(),
          returnMatchData: true
        });
        if (matches.length > 0 && matches[0].score == 1 && 
          (matches[0].original == matches[0].item.Type || matches[0].original == matches[0].item.Name)) {
          results = [matches[0].item];
        } else {
          results = matches.map(r => r.item);
        }
      }
      
      // Limit results
      results = results.slice(0, args.MaxResults);
      
      // Fetch full information for every result in detailed mode, or for a single result
      const expand = args.Detailed || results.length === 1;
      if (expand) {
        results = await this.expandResults(results, args.Detailed);
      }
      
      // Localize all text fields
      let localized = await gameDatabase.localizeObjects(results);
      if (expand && this.tooltipKind) {
        localized = await this.applyTooltips(localized, this.tooltipKind, args.Detailed);
      }
      if (this.formatItem) {
        localized = localized.map(item => this.formatItem!(item));
      }
      
      return {
        Count: results.length,
        Items: localized,
      };
      
    } catch (error) {
      return {
        Count: 0,
        Items: [],
        Error: error instanceof Error ? error.message : "Unknown query error."
      };
    }
  }

  /**
   * Replace each result with its full information. Detailed listings fail when any fetch fails; a
   * single lookup keeps the summary instead.
   */
  private async expandResults(results: TSummary[], required: boolean): Promise<TSummary[]> {
    const identifierField = this.getIdentifierField();
    const expanded: TSummary[] = [];
    for (const result of results) {
      try {
        const fullInfo = await this.fetchFullInfo(result[identifierField] as string);
        expanded.push((fullInfo ?? result) as TSummary);
      } catch (error) {
        if (required) throw error;
        logger.error("Failed to fetch full info:", error);
        expanded.push(result);
      }
    }
    return expanded;
  }

  /**
   * Copy items with the game's own tooltip as `Help`. Detailed listings fail without the game's
   * tooltips; a single lookup keeps the database text instead.
   */
  private async applyTooltips(items: TSummary[], kind: TooltipKind, required: boolean): Promise<TSummary[]> {
    const identifierField = this.getIdentifierField();
    try {
      const tooltips = await fetchGameTooltips(kind, items.map(item => item[identifierField] as string));
      return items.map(item => {
        const tooltip = tooltips.get(item[identifierField] as string);
        return tooltip ? { ...item, Help: tooltip } : item;
      });
    } catch (error) {
      if (required) throw error;
      logger.warn(`Using database text instead of game tooltips: ${error instanceof Error ? error.message : String(error)}`);
      return items;
    }
  }
}
