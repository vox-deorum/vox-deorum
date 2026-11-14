/**
 * Formatting utilities for database content
 */

/**
 * Format policy help text by cleaning up newlines and removing redundant policy names
 * @param help The raw help text from the database
 * @param name The policy name to filter out from the help text
 * @returns Formatted help text as a string or array of strings
 */
export function formatPolicyHelp(help: string | null | undefined, name: string): string[] {
  if (!help) return [""];

  const lines = help
    .split(/\n+/g)
    .map(line => line.trim())
    .filter(line => line !== "" && line !== name);

  if (lines.length === 0) return [""];
  return lines;
}