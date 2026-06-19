/**
 * @module utils/tools/json-to-markdown
 *
 * Utility for transforming JSON objects into markdown format with configurable heading levels.
 * Supports custom formatters, heading levels, and nested list generation for complex data structures.
 *
 * CONVENTION: this is the one converter for rendering structured data into MODEL CONTEXT.
 * Never feed `JSON.stringify` output to a model (system prompts, user turns, tool-result text,
 * briefings) — models read markdown far better than brace-and-quote JSON, and we have an
 * automatic converter for it. Reserve `JSON.stringify` for machine-facing sinks only:
 * telemetry/span attributes, log lines, file/cache persistence, SSE frames, request bodies,
 * and the literal JSON tool-call format taught to models without native tool calling.
 */

/**
 * Configuration for formatting a specific heading level.
 */
export interface HeadingConfig {
  /** Format string with {key} or {0} placeholder, e.g., "Player {0}" */
  format?: string;
  /** Whether to skip this level and proceed to nested content */
  skip?: boolean;
  /** Custom transformer function for values at this level */
  transformer?: (value: any, key: string) => string;
}

/**
 * Complete configuration for JSON to Markdown transformation
 */
export interface JsonToMarkdownConfig {
  /** Array of configs for each depth level */
  configs: HeadingConfig[];
  /** Starting heading level (1-6) */
  startingLevel: number;
  /** Maximum heading level to use before switching to lists */
  maxLevel: number;
  /** Indentation string for nested lists */
  indentString: string;
}

/**
 * Transforms a JSON object into markdown format
 * @param jsonObject - The JSON object to transform
 * @param options - Configuration options for the transformation
 * @returns Markdown formatted string
 */
export function jsonToMarkdown(
  jsonObject: any,
  options?: Partial<JsonToMarkdownConfig>
): string {
  const actual = options ?? (jsonObject?._markdownConfig as Partial<JsonToMarkdownConfig> ?? {})

  const config: JsonToMarkdownConfig = {
    configs: actual.configs ?? [],
    startingLevel: actual.startingLevel ?? 2,
    maxLevel: actual.maxLevel ?? 6,
    indentString: actual.indentString ?? "  "
  };

  return transformValue(jsonObject, 0, config, "").trim();
}

/**
 * Transforms a value based on its type and depth
 */
function transformValue(
  value: any,
  depth: number,
  config: JsonToMarkdownConfig,
  parentIndent: string,
  key?: string
): string {
  const headingConfig = config.configs[depth];

  // Apply custom transformer if available
  if (headingConfig?.transformer && key !== undefined) {
    return headingConfig.transformer(value, key);
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return key ? `${key}: null` : "null";
  }

  if (typeof value !== "object") {
    // Handle primitives
    return `${parentIndent}- ${(key ? `${key}: ` : '')}${formatPrimitive(value, parentIndent)}`;
  } else {
    // Handle objects
    return transformObject(value, depth, config, parentIndent, Array.isArray(value));
  }
}

/**
 * Formats primitive values for markdown
 */
function formatPrimitive(value: any, indent: string = ""): string {
  if (typeof value === "string") {
    // Handle multiline strings by indenting subsequent lines
    if (value.includes("\n")) {
      const lines = value.split("\n");
      return lines.map((line, i) => i === 0 ? line : indent + line).join("\n");
    }
    return value;
  }
  return String(value);
}

/**
 * Transforms an object into markdown format
 */
function transformObject(
  obj: Record<string, any>,
  depth: number,
  config: JsonToMarkdownConfig,
  parentIndent: string,
  isArray: boolean
): string {
  const currentLevel = config.startingLevel + depth;
  const headingConfig = config.configs[depth];
  const results: string[] = [];

  // Process each key-value pair
  for (const [key, value] of Object.entries(obj)) {
    // Ignore keys starting with `_` for internal configs
    if (key.startsWith("_")) continue;

    // Check if there's a transformer for this value at the next depth
    const nextHeadingConfig = config.configs[depth + 1];
    if (nextHeadingConfig?.transformer) {
      results.push(nextHeadingConfig.transformer(value, key));
      continue;
    }

    if (headingConfig?.skip) {
      // Skip this level and process nested content directly
      results.push(transformValue(
        value,
        depth + 1,
        config,
        parentIndent,
        key
      ));
    } else if (key && headingConfig && currentLevel <= config.maxLevel && typeof(value) === "object") {
      // Use heading format
      const formatString = headingConfig.format ?? "{key}";
      const heading = "\n" + "#".repeat(currentLevel) + " " +
        formatString.replace(/\{(key|0)\}/g, key);
      const exported = transformValue(
        value,
        depth + 1,
        config,
        "",
        undefined
      );
      // Ignore headings with an empty object/array - avoid confusion
      if (exported !== "") {
        results.push(heading);
        results.push(exported);
      }
    } else {
      // Use nested lists when heading level exceeded
      if (typeof value === "object" && value !== null) {
        var transformed = transformValue(
          value,
          depth + 1,
          config,
          parentIndent + config.indentString,
          undefined
        );
        // Ignore list items with an empty object/array - also avoid confusion
        if (transformed !== "") {
          results.push(`${parentIndent}- ${isArray ? "#" : ""}${key}:`);
          results.push(transformed);
        }
      } else {
        results.push(`${parentIndent}- ${isArray ? "" : key + ": "}${formatPrimitive(value, parentIndent + config.indentString)}`);
      }
    }
  }

  return results.filter(r => r !== "").join("\n");
}