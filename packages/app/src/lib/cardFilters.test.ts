import { describe, expect, it } from "vitest";
import { cardMatchesFilters, isFilterActive } from "./cardFilters";

const card = (over: Partial<Parameters<typeof cardMatchesFilters>[0]> = {}) => ({
  title: "Buy beers",
  description_text: "artigianali from the local brewery",
  tags: ["shopping", "urgent"],
  assignees: [{ id: "u1" }, { id: "u2" }],
  created_at: "2026-06-13T10:00:00Z",
  ...over,
});

describe("isFilterActive", () => {
  it("is false for an empty / blank filter", () => {
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive({ q: "  " })).toBe(false);
    expect(isFilterActive({ tags: [] })).toBe(false);
  });

  it("is true when any filter is set", () => {
    expect(isFilterActive({ q: "x" })).toBe(true);
    expect(isFilterActive({ tags: ["a"] })).toBe(true);
    expect(isFilterActive({ assignees: ["u1"] })).toBe(true);
    expect(isFilterActive({ from: "2026-06-01" })).toBe(true);
  });
});

describe("cardMatchesFilters", () => {
  it("matches everything with no filter", () => {
    expect(cardMatchesFilters(card(), {})).toBe(true);
  });

  it("text filter checks title AND description (case-insensitive)", () => {
    expect(cardMatchesFilters(card(), { q: "BEERS" })).toBe(true);
    expect(cardMatchesFilters(card(), { q: "brewery" })).toBe(true);
    expect(cardMatchesFilters(card(), { q: "wine" })).toBe(false);
  });

  it("tag filter matches ANY of the selected tags", () => {
    expect(cardMatchesFilters(card(), { tags: ["urgent"] })).toBe(true);
    expect(cardMatchesFilters(card(), { tags: ["nope", "urgent"] })).toBe(true);
    expect(cardMatchesFilters(card(), { tags: ["missing"] })).toBe(false);
  });

  it("assignee filter matches ANY of the selected users", () => {
    expect(cardMatchesFilters(card(), { assignees: ["u2"] })).toBe(true);
    expect(cardMatchesFilters(card(), { assignees: ["u9"] })).toBe(false);
    expect(
      cardMatchesFilters(card({ assignees: [] }), { assignees: ["u1"] }),
    ).toBe(false);
  });

  it("date range is inclusive on both ends (by calendar day)", () => {
    const c = card({ created_at: "2026-06-13T23:30:00Z" });
    expect(cardMatchesFilters(c, { from: "2026-06-13" })).toBe(true);
    expect(cardMatchesFilters(c, { to: "2026-06-13" })).toBe(true);
    expect(cardMatchesFilters(c, { from: "2026-06-14" })).toBe(false);
    expect(cardMatchesFilters(c, { to: "2026-06-12" })).toBe(false);
  });

  it("combines filters with AND", () => {
    expect(
      cardMatchesFilters(card(), { q: "beers", tags: ["urgent"] }),
    ).toBe(true);
    expect(
      cardMatchesFilters(card(), { q: "beers", tags: ["missing"] }),
    ).toBe(false);
  });
});
