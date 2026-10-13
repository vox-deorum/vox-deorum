/**
 * @module knowledge/reference-format
 *
 * Renders one cleaned game reference category as Markdown: technologies, policies, buildings, or
 * units, already sorted with Name first and Help last, Type removed, and sort-only fields such as
 * policy Level dropped. The `# title` category heading and each entry's `## Name` heading stay
 * intact so grep and awk entry extraction keeps working; duplicate names get a suffix on every
 * entry of the group. Each entry body is one Markdown list in a single format: the compact facts
 * first, as plain humanized labels rendered through the shared jsonToMarkdown converter (a category
 * can limit them to the facts its tooltips lack), then the entry's tooltip. Every tooltip line keeps
 * its words and order and becomes a list item; a colon section label ahead of a bullet list becomes
 * an item with the list nested under it, and a few long labels get short names. Separator dashes
 * and blank lines are dropped, so blank lines appear only around headings. The renderer never
 * changes its input.
 */

import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";

/** One cleaned reference entry. */
type Item = Record<string, unknown>;

/** One tooltip line, classified by how it should render. */
type HelpLine = { kind: "text" | "bullet" | "break"; text: string };

/** Tooltip section labels too long to read at a glance, and their short names. */
const shortLabels = new Map([
  ["List of possible boosts to this Building", "Possible Boosts"],
]);

/**
 * Render one category of cleaned, sorted reference entries as a Markdown document ending with a
 * newline. An empty category renders as just its title heading. With `facts`, an entry that has a
 * tooltip lists only those fields as facts; an entry without one lists every fact.
 */
export function renderReferenceMarkdown(title: string, items: Item[], facts?: readonly string[]): string {
  const headings = assignHeadings(items);
  const sections = items.map((item, index) => renderEntry(item, headings[index], facts));
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

/**
 * Render one entry: its heading, a blank line, then one list holding the compact facts (only
 * `shown` when it has a tooltip) followed by the tooltip.
 */
function renderEntry(item: Item, heading: string, shown?: readonly string[]): string {
  const help = item.Help === undefined || item.Help === null ? "" : String(item.Help);
  const normalized = normalizeHelp(help);
  const facts = Object.fromEntries(Object.entries(item)
    .filter(([key, value]) => key !== "Name" && key !== "Help" && value !== undefined && value !== null)
    .filter(([key]) => !shown || normalized === "" || shown.includes(key))
    .map(([key, value]) => [humanizeLabel(key), value]));
  const body = [jsonToMarkdown(facts), normalized].filter((part) => part !== "").join("\n");
  return body === "" ? `## ${heading}` : `## ${heading}\n\n${body}`;
}

/** Split a PascalCase field name into words for its label, keeping acronym runs whole (AIType, HP). */
function humanizeLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

/**
 * Normalize tooltip text into one Markdown list: every text line and bullet becomes a list item,
 * and a colon section label followed by bullets becomes an item with those bullets nested under it
 * until the next text line or separator. Separator dash lines and blank lines end a section and are
 * dropped. Long section labels get their short names. Statements keep their words and order. Text
 * that is empty normalizes to nothing.
 */
function normalizeHelp(help: string): string {
  const lines = classifyHelpLines(help);
  const items: string[] = [];
  let indent = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.kind === "break") {
      indent = "";
    } else if (line.kind === "bullet") {
      items.push(`${indent}- ${line.text}`);
    } else if (line.text.endsWith(":") && lines[index + 1]?.kind === "bullet") {
      const label = line.text.replace(/:+$/, "").trim();
      items.push(`- ${shortLabels.get(label) ?? label}:`);
      indent = "  ";
    } else {
      items.push(`- ${line.text}`);
      indent = "";
    }
  }
  return items.join("\n");
}

/** Classify tooltip lines as text, bullets, or breaks (blank and separator lines). */
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
