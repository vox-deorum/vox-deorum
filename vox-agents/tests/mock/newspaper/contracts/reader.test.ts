/** Verify reader actions and persisted state against publication identities. */
import { describe, expect, it } from "vitest";
import { createNewspaperIssue } from "../../../helpers/newspaper-fixtures.js";
import { validateReaderAction, validateReaderState } from "../../../../src/newspaper/contracts/reader.js";

describe("newspaper reader contracts", () => {
  it("should accept page selections, votes, and typed links for known content", () => {
    const issue = createNewspaperIssue();
    const actions = [
      { type: "select-page", pageId: "analysis", previousPageId: "front" },
      { type: "vote", itemId: "shared-item", value: "up", previousValue: "none" },
      { type: "follow-link", itemId: "shared-item", target: { type: "city", cityId: "city-1" } },
    ];
    for (const action of actions) {
      expect(validateReaderAction(issue, action)).toEqual(action);
    }
  });

  it("should reject actions for unknown pages or items", () => {
    const issue = createNewspaperIssue();
    expect(() => validateReaderAction(issue, {
      type: "select-page", pageId: "missing", previousPageId: null,
    })).toThrow();
    expect(() => validateReaderAction(issue, {
      type: "vote", itemId: "missing", value: "up", previousValue: "none",
    })).toThrow();
    expect(() => validateReaderAction(issue, {
      type: "follow-link", itemId: "missing", target: { type: "screen", screen: "map" },
    })).toThrow();
  });

  it("should accept persisted state and reject unknown page or item references", () => {
    const issue = createNewspaperIssue();
    const state = { activePageId: "front", scrollByPage: { front: 37 }, votes: { "shared-item": "down" } };
    expect(validateReaderState(issue, state)).toEqual(state);
    expect(() => validateReaderState(issue, { ...state, activePageId: "missing" })).toThrow();
    expect(() => validateReaderState(issue, { ...state, scrollByPage: { missing: 37 } })).toThrow();
    expect(() => validateReaderState(issue, { ...state, votes: { missing: "down" } })).toThrow();
  });

  it("should reject invalid vote values and scroll positions", () => {
    const issue = createNewspaperIssue();
    expect(() => validateReaderAction(issue, {
      type: "vote", itemId: "shared-item", value: "favorite", previousValue: "none",
    })).toThrow();
    for (const scroll of [-1, Number.POSITIVE_INFINITY]) {
      expect(() => validateReaderState(issue, {
        activePageId: "front", scrollByPage: { front: scroll }, votes: {},
      })).toThrow();
    }
  });
});
