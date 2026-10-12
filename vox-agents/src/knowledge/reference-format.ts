/**
 * @module knowledge/reference-format
 *
 * Renders one cleaned game reference category as Markdown: technologies, policies, buildings, or
 * units, already sorted with Name first and Help last, Type removed, and sort-only fields such as
 * policy Level dropped. The `# title` category heading and each entry's `## Name` heading stay
 * intact so grep and awk entry extraction keeps working; duplicate names get a suffix on every
 * entry of the group. Compact facts come first with bold, humanized
 * labels, rendered through the shared jsonToMarkdown converter. The entry's tooltip
 * follows under `### Help`, normalized so every gameplay statement keeps its words and order:
 * separator dashes become paragraph breaks, `*` and Unicode bullets become Markdown list items,
 * and colon section labels ahead of a bullet list become `####` subheadings. Blank lines go around
 * every block because the game's own text handling strips them. The renderer never changes its
 * input.
 */

import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";

/** One cleaned reference entry. */
type Item = Record<string, unknown>;

/** One tooltip line, classified by how it should render. */
type HelpLine = { kind: "text" | "bullet" | "break"; text: string };

/**
 * Render one category of cleaned, sorted reference entries as a Markdown document ending with a
 * newline. An empty category renders as just its title heading.
 */
export function renderReferenceMarkdown(title: string, items: Item[]): string {
  const headings = assignHeadings(items);
  const sections = items.map((item, index) => renderEntry(item, headings[index]));
  return [`# ${title}`, ...sections].join("\n\n") + "\n";
}

/**
 * Give every entry a unique heading: its Name, or Item N by position when the Name is missing.
 * Every entry of a duplicate group gets a suffix: its human-readable UniqueOf or Branch, or else
 * its position in the group. A suffix that still collides gets a further number.
 */
function assignHeadings(items: Item[]): string[] {
  const bases = items.map((item, index) => headingBase(item, index));
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);
  const taken = new Set(bases.filter((base) => counts.get(base) === 1));
  const seen = new Map<string, number>();
  return bases.map((base, index) => {
    if (counts.get(base) === 1) return base;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const suffix = headingSuffix(items[index]) || String(occurrence);
    let heading = `${base} (${suffix})`;
    for (let number = 2; taken.has(heading); number++) heading = `${base} (${suffix} ${number})`;
    taken.add(heading);
    return heading;
  });
}

/** An entry's heading before disambiguation: its Name, or Item N at its one-based position. */
function headingBase(item: Item, index: number): string {
  const name = item.Name === undefined || item.Name === null ? "" : String(item.Name).trim();
  return name === "" ? `Item ${index + 1}` : name;
}

/** The human-readable qualifier that tells duplicates apart: a unique entry's civilization, or a policy's branch. */
function headingSuffix(item: Item): string {
  for (const key of ["UniqueOf", "Branch"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

/** Render one entry: its heading, the compact facts, then the tooltip under a Help subheading. */
function renderEntry(item: Item, heading: string): string {
  const parts = [`## ${heading}`];
  const facts = Object.fromEntries(Object.entries(item)
    .filter(([key, value]) => key !== "Name" && key !== "Help" && value !== undefined && value !== null)
    .map(([key, value]) => [`**${humanizeLabel(key)}**`, value]));
  const renderedFacts = jsonToMarkdown(facts);
  if (renderedFacts !== "") parts.push(renderedFacts);
  const help = item.Help === undefined || item.Help === null ? "" : String(item.Help);
  const normalized = normalizeHelp(help);
  if (normalized !== "") parts.push(["### Help", normalized].join("\n\n"));
  return parts.join("\n\n");
}

/** Split a PascalCase field name into words for its label, keeping acronym runs whole (AIType, HP). */
function humanizeLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

/**
 * Normalize tooltip text into Markdown blocks joined by blank lines, which the game's own
 * cleanup strips: separator dash lines break blocks (never underlining the text above as a
 * heading), `*` and Unicode bullets become list items, and a colon section label followed by a
 * bullet list becomes a subheading. Statements keep their words and order. Text that is empty
 * normalizes to nothing.
 */
function normalizeHelp(help: string): string {
  const lines = classifyHelpLines(help);
  const blocks: string[] = [];
  const paragraph: string[] = [];
  const bullets: string[] = [];
  /** Finish the current prose block. */
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push(paragraph.join("\n"));
    paragraph.length = 0;
  };
  /** Finish the current list block. */
  const flushBullets = () => {
    if (bullets.length > 0) blocks.push(bullets.join("\n"));
    bullets.length = 0;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.kind === "break") {
      flushParagraph();
      flushBullets();
    } else if (line.kind === "bullet") {
      flushParagraph();
      bullets.push(`- ${line.text}`);
    } else {
      flushBullets();
      if (line.text.endsWith(":") && lines[index + 1]?.kind === "bullet") {
        flushParagraph();
        blocks.push(`#### ${line.text.replace(/:+$/, "").trim()}`);
      } else {
        paragraph.push(line.text);
      }
    }
  }
  flushParagraph();
  flushBullets();
  return blocks.join("\n\n");
}

/** Classify tooltip lines while preserving existing paragraph breaks. */
function classifyHelpLines(help: string): HelpLine[] {
  const lines: HelpLine[] = [];
  for (const raw of help.split(/\r?\n/)) {
    const text = raw.trim();
    if (text === "" || /^(?:-+|=+)$/.test(text)) {
      lines.push({ kind: "break", text });
      continue;
    }
    const bullet = text.replace(/^(?:[-*]\s+|[•‣▪◦⁃]\s*)/, "");
    if (bullet !== "" && bullet !== text) {
      lines.push({ kind: "bullet", text: bullet });
    } else {
      lines.push({ kind: "text", text });
    }
  }
  return lines;
}
