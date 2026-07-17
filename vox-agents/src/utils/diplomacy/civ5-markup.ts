/**
 * @module utils/diplomacy/civ5-markup
 *
 * Converts the raw markdown stored in the diplomacy transcript for sinks that cannot render
 * markdown. `markdownToCiv5` belongs only at the game-bound Content edge, while
 * `markdownToPlain` belongs only at the notification edge. The durable transcript stays as raw
 * markdown so the web client can continue to render it with its markdown renderer.
 *
 * Existing Civ 5 markup in transcript content passes through unchanged. This lets callers mix
 * markdown with intentional game tags without the converter treating underscores in tags as
 * emphasis delimiters. The one exception is a bare uppercase tag immediately followed by `(`,
 * which is read as a markdown link label (`[TERMS](url)`) rather than a tag so the URL is
 * stripped; argumented color tags such as `[COLOR:255:0:0:255](warning)` still pass through.
 *
 * Plain mode preserves blank lines verbatim, while Civ mode collapses runs of them so the game
 * label never renders three line-break tags in a row.
 */

/** Civ 5 color used to represent markdown bold text and headings. */
export const civ5BoldColor = "COLOR_YELLOW";

/** Civ 5 color used to represent markdown italic text. */
export const civ5ItalicColor = "COLOR_CYAN";

type OutputMode = "civ5" | "plain";

// An argumented tag (`[COLOR:...]`, `[X=...]`) is always preserved; a bare tag is preserved only
// when it is not immediately followed by `(`, so `[TERMS](url)` falls through to the link pass.
const civ5TagPattern = /\[\/?[A-Z][A-Z0-9_]*[:=][^\]\r\n]*\]|\[\/?[A-Z][A-Z0-9_]*\](?!\()/g;
const inlineTokenPattern = /\u0000(\d+)\u0000/g;

/** Normalize Windows and legacy Mac line endings before scanning markdown blocks. */
function normalizeNewlines(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

/** Store protected inline text and return a placeholder that markdown regexes cannot consume. */
function stashInlineToken(tokens: string[], value: string): string {
  const index = tokens.push(value) - 1;
  return `\u0000${index}\u0000`;
}

/** Resolve protected and generated inline tokens, including tokens nested inside styled text. */
function restoreInlineTokens(value: string, tokens: string[]): string {
  let restored = value;
  for (let pass = 0; pass <= tokens.length; pass++) {
    const next = restored.replace(inlineTokenPattern, (_match, rawIndex: string) => {
      return tokens[Number(rawIndex)] ?? "";
    });
    if (next === restored) return restored;
    restored = next;
  }
  return restored;
}

/** Wrap inline content in the Civ 5 color for its markdown emphasis, or unwrap it for plain text. */
function styleInline(content: string, color: string, mode: OutputMode): string {
  return mode === "civ5" ? `[${color}]${content}[ENDCOLOR]` : content;
}

/** Convert markdown links, code spans, and emphasis while preserving existing Civ 5 tags. */
function emitInline(value: string, mode: OutputMode): string {
  const tokens: string[] = [];

  /** Process one inline fragment without restoring placeholders needed by its parent fragment. */
  function processInline(fragment: string): string {
    let result = fragment.replace(civ5TagPattern, (tag) => stashInlineToken(tokens, tag));

    result = result.replace(/!?\[([^\]\n]+)\]\((?:\\.|[^)\n])*\)/g, (_match, label: string) => label);

    result = result.replace(/(`+)([^`\n]*?)\1/g, (_match, _ticks: string, content: string) => {
      return stashInlineToken(tokens, content);
    });

    result = result.replace(/\*\*(.+?)\*\*/g, (_match, content: string) => {
      const styled = styleInline(processInline(content), civ5BoldColor, mode);
      return stashInlineToken(tokens, styled);
    });
    result = result.replace(/(?<!\w)__(.+?)__(?!\w)/g, (_match, content: string) => {
      const styled = styleInline(processInline(content), civ5BoldColor, mode);
      return stashInlineToken(tokens, styled);
    });

    result = result.replace(/\*([^*\n]+?)\*/g, (_match, content: string) => {
      const styled = styleInline(processInline(content), civ5ItalicColor, mode);
      return stashInlineToken(tokens, styled);
    });
    result = result.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, (_match, content: string) => {
      const styled = styleInline(processInline(content), civ5ItalicColor, mode);
      return stashInlineToken(tokens, styled);
    });

    return result.replace(/`/g, "");
  }

  return restoreInlineTokens(processInline(value), tokens);
}

/** Render one normalized markdown line as Civ 5 markup or unwrapped plain text. */
function renderLine(line: string, mode: OutputMode): string {
  if (line.trim() === "") return "";

  const unquoted = line.replace(/^(?:[ \t]{0,3}>[ \t]?)+/, "");
  const heading = unquoted.match(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/);
  if (heading) {
    const content = emitInline(heading[1]!, mode);
    return mode === "civ5" ? `[${civ5BoldColor}]${content}[ENDCOLOR]` : content;
  }

  const bullet = unquoted.match(/^[ \t]*[-*+][ \t]+(.*)$/);
  if (bullet) {
    const content = emitInline(bullet[1]!, mode);
    if (mode === "plain") return content;
    return content === "" ? "[ICON_BULLET]" : `[ICON_BULLET] ${content}`;
  }

  return emitInline(unquoted, mode);
}

/** Limit generated blank lines to one so Civ output never contains three line-break tags in a row. */
function collapseBlankLines(lines: string[]): string[] {
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === "" && collapsed[collapsed.length - 1] === "") continue;
    collapsed.push(line);
  }
  return collapsed;
}

/** Convert markdown using the shared block scanner and the requested output mode. */
function convertMarkdown(markdown: string, mode: OutputMode): string {
  // Drop the NUL sentinel from input so real text can never collide with a generated token.
  const sanitized = normalizeNewlines(markdown).replace(/\u0000/g, "");
  const lines = sanitized.split("\n").map((line) => renderLine(line, mode));
  if (mode === "plain") return lines.join("\n");
  return collapseBlankLines(lines).join("[NEWLINE]");
}

/** Convert transcript markdown to markup understood by Civilization V UI labels. */
export function markdownToCiv5(markdown: string): string {
  return convertMarkdown(markdown, "civ5");
}

/** Convert transcript markdown to unstyled text suitable for notification summaries. */
export function markdownToPlain(markdown: string): string {
  return convertMarkdown(markdown, "plain");
}
