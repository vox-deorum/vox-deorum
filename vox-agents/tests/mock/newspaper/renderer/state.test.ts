/** Verify shared reader presentation state across pages and reversible votes. */
import { describe, expect, it } from "vitest";
import { createNewspaperIssue } from "../../../helpers/newspaper-fixtures.js";
import { issueDocumentSchema } from "../../../../src/newspaper/contracts/issue.js";
import { createReaderState, getVote, normalizeReaderState, setPageScroll, toggleVote } from "../../../../src/newspaper/renderer/state.js";

describe("newspaper vote state", () => {
  it("should preserve valid identifiers that match object prototype properties", () => {
    const issue = createNewspaperIssue();
    issue.pages[0].id = "__proto__";
    issue.pages[0].itemIds = ["constructor"];
    issue.items[0].id = "constructor";
    const initial = createReaderState(issueDocumentSchema.parse(issue), {
      scrollByPage: JSON.parse('{"__proto__":37}'),
      votes: JSON.parse('{"constructor":"up"}'),
    });
    expect(initial.scrollByPage["__proto__"]).toBe(37);
    expect(getVote(initial, "constructor")).toBe("up");
    const cleared = toggleVote(initial, "constructor", "up");
    expect(getVote(cleared, "constructor")).toBe("none");
    expect(getVote(cleared, "toString")).toBe("none");
    expect(setPageScroll(cleared, "__proto__", 81).scrollByPage["__proto__"]).toBe(81);
  });
  it("should keep reversible votes scoped to each item as the reader changes tabs", () => {
    const issue = createNewspaperIssue();
    const initial = createReaderState(issue);
    const up = toggleVote(initial, "shared-item", "up");
    expect(getVote(up, "shared-item")).toBe("up");

    const analysis = normalizeReaderState(issue, {
      ...up,
      activePageId: "analysis",
    });
    expect(analysis.activePageId).toBe("analysis");
    expect(getVote(analysis, "shared-item")).toBe("up");
    expect(getVote(analysis, "analysis-item")).toBe("none");

    const cleared = toggleVote(analysis, "shared-item", "up");
    expect(getVote(cleared, "shared-item")).toBe("none");

    const down = toggleVote(up, "shared-item", "down");
    expect(getVote(down, "shared-item")).toBe("down");
  });
});
