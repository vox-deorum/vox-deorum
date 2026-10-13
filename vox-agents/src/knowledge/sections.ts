/**
 * @module knowledge/sections
 *
 * The section registry. Each section of the game knowledge an agent reads (situation, civilization,
 * options, strategies, victory progress, players, cities, military, events, briefings) is defined
 * once here: its key, title, description, scope, and how a record file could split its report.
 * Prompt builders render sections through {@link renderSection} and keep their own structure,
 * message order, field filtering, and cache breakpoints.
 */

import { isRecord } from "../utils/guards.js";
import { jsonToMarkdown, type JsonToMarkdownConfig } from "../utils/tools/json-to-markdown.js";

/** Keys of the registered sections. */
export type SectionKey =
  | "situation" | "civilization" | "options" | "strategies" | "victory"
  | "players" | "cities" | "military" | "events" | "briefings";

/** How a report's Markdown could be split into several record files. */
export interface SectionSplit {
  /** The top-level grouping of the report: per civilization, per city owner, or per military zone. */
  by: "civilization" | "cityOwner" | "militaryZone";
}

/** One registered section. */
export interface SectionDefinition {
  /** Stable key, also used for record file names. */
  key: SectionKey;
  /** Default heading text. */
  title: string;
  /** Default one-line description rendered under the heading, when the section has one. */
  description?: string;
  /** `game` sections stay the same for the whole game; `turn` sections change every turn. */
  scope: "game" | "turn";
  /** Default Markdown configuration, used instead of the report's own `_markdownConfig` when set. */
  markdown?: Partial<JsonToMarkdownConfig>;
  /** Optional record splitting information. */
  split?: SectionSplit;
}

/** Overrides for one {@link renderSection} call. */
export interface RenderSectionOptions {
  /** Replacement heading text. */
  heading?: string;
  /** Replacement description, or `false` to render the section without one. */
  description?: string | false;
  /** Heading level of the section title (1 for `#`, 2 for `##`). Defaults to 1. */
  headingLevel?: number;
  /** Replacement Markdown configuration. */
  markdown?: Partial<JsonToMarkdownConfig>;
  /** Treat the data as text that is already Markdown (such as a briefing) and insert it as is. */
  rendered?: boolean;
}

/**
 * Sections a file-mode run may read from its records instead of its prompt. The records
 * directions list those the caller does not keep inline, with their files.
 */
export const fileModeOmittedSections: SectionKey[] = ["cities", "military", "events"];

/**
 * Sections every simple strategist variant keeps inline in file mode. The records directions name
 * them so the run does not read the latest turn's copy again.
 */
export const strategistInlineSections: SectionKey[] = ["options", "strategies", "victory", "players"];

/**
 * Sections the plain simple strategist keeps inline in file mode: the shared ones plus Military
 * and our own Cities, which point to the other owners' city files.
 */
export const simpleStrategistInlineSections: SectionKey[] = [...strategistInlineSections, "cities", "military"];

/** The section registry, keyed by section key. */
export const sections: Record<SectionKey, SectionDefinition> = {
  situation: { key: "situation", title: "Situation", scope: "game" },
  civilization: { key: "civilization", title: "Your Civilization", scope: "game" },
  options: {
    key: "options",
    title: "Options",
    description: "Options: available strategic options for you.",
    scope: "turn",
    markdown: { configs: [{}] },
  },
  strategies: {
    key: "strategies",
    title: "Strategies",
    description: "Strategies: existing strategic decisions from you.",
    scope: "turn",
  },
  victory: {
    key: "victory",
    title: "Victory Progress",
    description: "Victory Progress: current progress towards each type of victory.",
    scope: "turn",
  },
  players: {
    key: "players",
    title: "Players",
    description: "Players: summary reports about visible players in the world.",
    scope: "turn",
    split: { by: "civilization" },
  },
  cities: {
    key: "cities",
    title: "Cities",
    description: "Cities: summary reports about discovered cities in the world.",
    scope: "turn",
    split: { by: "cityOwner" },
  },
  military: {
    key: "military",
    title: "Military",
    description: "Military: summary reports about tactical zones and visible units.",
    scope: "turn",
    split: { by: "militaryZone" },
  },
  events: {
    key: "events",
    title: "Events",
    description: "Events: events since you last made a decision.",
    scope: "turn",
  },
  briefings: { key: "briefings", title: "Briefings", scope: "turn" },
};

/**
 * Split a players report into its object entries and a trailing `## Other players` block for its
 * plain-string entries (unmet, defeated, and barbarian players), which would otherwise dangle as
 * stray bullets inside the previous civilization's section. Underscore keys stay with the object
 * entries so the `_markdownConfig` handling is unchanged. The block is empty when there are no
 * string entries, and entries keep their input order.
 */
function splitOtherPlayers(data: Record<string, unknown>): { rest: Record<string, unknown>; other: string } {
  const rest: Record<string, unknown> = {};
  const bullets: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("_") && typeof value === "string") bullets.push(`- ${key}: ${value}`);
    else rest[key] = value;
  }
  const other = bullets.length > 0 ? `## Other players\n${bullets.join("\n")}` : "";
  return { rest, other };
}

/**
 * Render one section as Markdown: a heading, the description (when there is one), a blank line,
 * and the data. Without a description the data follows the heading directly. The data uses the
 * report's own `_markdownConfig` unless the section or the call supplies a configuration.
 * With `rendered`, the data is already text and is inserted unchanged. A `players` object report
 * renders its string entries last, under a separate `## Other players` heading.
 */
export function renderSection(key: SectionKey, data: unknown, options: RenderSectionOptions = {}): string {
  const section = sections[key];
  const heading = `${"#".repeat(options.headingLevel ?? 1)} ${options.heading ?? section.title}`;
  const description = options.description === false ? undefined : options.description ?? section.description;
  const markdown = options.markdown ?? section.markdown;
  let source = data;
  let other = "";
  if (!options.rendered && key === "players" && isRecord(data)) {
    const split = splitOtherPlayers(data);
    if (split.other !== "") {
      source = split.rest;
      other = split.other;
    }
  }
  const body = options.rendered ? String(data) : markdown ? jsonToMarkdown(source, markdown) : jsonToMarkdown(source);
  const content = [body, other].filter(Boolean).join("\n\n");
  return description === undefined ? `${heading}\n${content}` : `${heading}\n${description}\n\n${content}`;
}
