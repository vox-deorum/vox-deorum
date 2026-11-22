/** Paragraph cleanup shared by the Writing Desk and its writer briefs. */

/**
 * Normalize a writer body into one entry per paragraph. Line endings become LF,
 * whitespace-only blank lines split entries, and each paragraph is trimmed.
 * Single newlines and multi-sentence paragraphs inside an entry are preserved.
 */
export function normalizeParagraphs(body: string[]): string[] {
  return body.flatMap(entry =>
    entry
      .replace(/\r\n?/g, '\n')
      .split(/\n[^\S\n]*\n+/)
      .map(paragraph => paragraph.trim())
      .filter(Boolean));
}
