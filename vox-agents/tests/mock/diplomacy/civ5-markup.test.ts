/** Tests for the game-bound diplomacy markdown converter. */

import { describe, expect, it } from "vitest";
import {
  civ5BoldColor,
  civ5ItalicColor,
  markdownToCiv5,
  markdownToPlain,
} from "../../../src/utils/diplomacy/civ5-markup.js";

describe("markdownToCiv5", () => {
  it("should convert headings and all bullet markers", () => {
    expect(markdownToCiv5("# Terms")).toBe(`[${civ5BoldColor}]Terms[ENDCOLOR]`);
    expect(markdownToCiv5("- Gold\n* Borders\n+ Peace")).toBe(
      "[ICON_BULLET] Gold[NEWLINE][ICON_BULLET] Borders[NEWLINE][ICON_BULLET] Peace",
    );
  });

  it("should convert both bold and italic forms", () => {
    expect(markdownToCiv5("**Gold** __Peace__ *now* _later_")).toBe(
      `[${civ5BoldColor}]Gold[ENDCOLOR] [${civ5BoldColor}]Peace[ENDCOLOR] ` +
        `[${civ5ItalicColor}]now[ENDCOLOR] [${civ5ItalicColor}]later[ENDCOLOR]`,
    );
  });

  it("should strip links, code ticks, and quote markers", () => {
    expect(markdownToCiv5("> See [terms](https://example.test) and `gold`")).toBe(
      "See terms and gold",
    );
  });

  it("should convert bold content inside a bullet", () => {
    expect(markdownToCiv5("- **120 Gold** now")).toBe(
      `[ICON_BULLET] [${civ5BoldColor}]120 Gold[ENDCOLOR] now`,
    );
  });

  it("should normalize line endings and collapse excess blank lines", () => {
    expect(markdownToCiv5("first\r\n\r\n\r\nsecond\rthird")).toBe(
      "first[NEWLINE][NEWLINE]second[NEWLINE]third",
    );
  });

  it("should preserve existing Civ 5 tags through inline parsing", () => {
    const tagged = "[COLOR_YELLOW]Terms[ENDCOLOR][NEWLINE][ICON_BULLET] 120 [ICON_GOLD]";
    expect(markdownToCiv5(tagged)).toBe(tagged);
    expect(markdownToCiv5("[COLOR_YELLOW]")).toBe("[COLOR_YELLOW]");
    const rgbaTagged = "[COLOR:255:0:0:255](warning)[/COLOR]";
    expect(markdownToCiv5(rgbaTagged)).toBe(rgbaTagged);
  });

  it("should strip links whose label looks like an all-caps tag", () => {
    expect(markdownToCiv5("See [FAQ](https://example.test/f) now")).toBe("See FAQ now");
    expect(markdownToCiv5("[TERMS](https://example.test)")).toBe("TERMS");
    expect(markdownToPlain("[TERMS](https://example.test)")).toBe("TERMS");
  });

  it("should drop image markup down to its alt text", () => {
    expect(markdownToCiv5("![alt](https://example.test/i.png)")).toBe("alt");
    expect(markdownToCiv5("![ALT](https://example.test/i.png)")).toBe("ALT");
  });

  it("should strip the NUL sentinel from input so tokens cannot collide", () => {
    const nul = String.fromCharCode(0);
    expect(markdownToCiv5(`${nul}0${nul} and **bold**`)).toBe(
      `0 and [${civ5BoldColor}]bold[ENDCOLOR]`,
    );
  });

  it("should preserve nested emphasis and unmatched markers", () => {
    expect(markdownToCiv5("**Gold and _favor_**")).toBe(
      `[${civ5BoldColor}]Gold and [${civ5ItalicColor}]favor[ENDCOLOR][ENDCOLOR]`,
    );
    expect(markdownToCiv5("An *unmatched marker\n*italic*")).toBe(
      `An *unmatched marker[NEWLINE][${civ5ItalicColor}]italic[ENDCOLOR]`,
    );
  });

  it("should return an empty string for empty markdown", () => {
    expect(markdownToCiv5("")).toBe("");
  });
});

describe("markdownToPlain", () => {
  it("should unwrap markdown while preserving content and real newlines", () => {
    expect(markdownToPlain("# Terms\r\n- **120 Gold**\r\n> [Details](https://example.test) `here`")).toBe(
      "Terms\n120 Gold\nDetails here",
    );
  });

  it("should preserve blank lines and existing Civ 5 tags", () => {
    expect(markdownToPlain("first\r\n\r\n\r\nsecond")).toBe("first\n\n\nsecond");
    const tagged = "[COLOR_YELLOW]Terms[ENDCOLOR][NEWLINE][ICON_BULLET] Gold";
    expect(markdownToPlain(tagged)).toBe(tagged);
  });

  it("should return an empty string for empty markdown", () => {
    expect(markdownToPlain("")).toBe("");
  });
});
