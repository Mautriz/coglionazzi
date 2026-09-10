import { describe, expect, it } from "vitest";
import { renderTask, type TaskCard, type TaskComment } from "./render";

const card = (over: Partial<TaskCard> = {}): TaskCard => ({
  id: "card-1",
  title: "Fix the deck editor autosave",
  description_text: "The autosave fires twice on blur.",
  tags: ["bug", "editor"],
  boardName: "Insacco",
  columnName: "In Progress",
  archived_at: null,
  archived_origin: null,
  created_at: new Date("2026-09-01T10:00:00Z"),
  assignees: [{ id: "u1", name: "Mauro" }],
  relations: [],
  attachments: [],
  ...over,
});

const comment = (over: Partial<TaskComment> = {}): TaskComment => ({
  id: "m1",
  authorName: "Mauro",
  body_text: "It double-fires on blur.",
  created_at: new Date("2026-09-02T09:30:00Z"),
  ...over,
});

describe("renderTask", () => {
  it("leads with the title as a heading", () => {
    expect(renderTask(card(), [])).toMatch(/^# Fix the deck editor autosave/);
  });

  it("states the card id so follow-up tools can be called", () => {
    expect(renderTask(card(), [])).toContain("card-1");
  });

  it("locates the card on its board and column", () => {
    const out = renderTask(card(), []);

    expect(out).toContain("Insacco");
    expect(out).toContain("In Progress");
  });

  it("lists tags and assignees", () => {
    const out = renderTask(card(), []);

    expect(out).toContain("bug");
    expect(out).toContain("editor");
    expect(out).toContain("Mauro");
  });

  it("includes the description as plain text", () => {
    expect(renderTask(card(), [])).toContain(
      "The autosave fires twice on blur.",
    );
  });

  it("says so plainly when there is no description", () => {
    const out = renderTask(card({ description_text: null }), []);

    expect(out).toMatch(/no description/i);
  });

  it("renders comments with their author", () => {
    const out = renderTask(card(), [comment()]);

    expect(out).toContain("It double-fires on blur.");
    expect(out).toContain("Mauro");
  });

  it("attributes a support-style authorless message to the customer", () => {
    const out = renderTask(card(), [comment({ authorName: null })]);

    expect(out).toMatch(/customer/i);
  });

  it("says so when there are no comments", () => {
    expect(renderTask(card(), [])).toMatch(/no comments/i);
  });

  it("lists attachments with a name, a type and a retrievable id", () => {
    const out = renderTask(
      card({
        attachments: [
          {
            id: "f1",
            path: "abc.webp",
            name: "screenshot.webp",
            type: "image/webp",
          },
        ],
      }),
      [],
    );

    expect(out).toContain("screenshot.webp");
    expect(out).toContain("image/webp");
    // The path is what get_attachment takes.
    expect(out).toContain("abc.webp");
  });

  it("names the tool that fetches an attachment, so it is discoverable", () => {
    const out = renderTask(
      card({
        attachments: [
          { id: "f1", path: "abc.webp", name: "s.webp", type: "image/webp" },
        ],
      }),
      [],
    );

    expect(out).toContain("get_attachment");
  });

  it("spells out each relation's direction", () => {
    const out = renderTask(
      card({
        relations: [
          { cardId: "c2", title: "Ship deck stats", kind: "blocks" },
          { cardId: "c3", title: "Old bug", kind: "blocked_by" },
          { cardId: "c4", title: "Sibling", kind: "related" },
        ],
      }),
      [],
    );

    expect(out).toMatch(/blocks[^\n]*Ship deck stats/i);
    expect(out).toMatch(/blocked by[^\n]*Old bug/i);
    expect(out).toMatch(/related[^\n]*Sibling/i);
  });

  it("flags an archived card, with where it came from", () => {
    const out = renderTask(
      card({
        archived_at: new Date("2026-09-05T00:00:00Z"),
        archived_origin: "Insacco / Done",
        columnName: null,
        boardName: null,
      }),
      [],
    );

    expect(out).toMatch(/archived/i);
    expect(out).toContain("Insacco / Done");
  });

  it("does not mention archiving for a live card", () => {
    expect(renderTask(card(), [])).not.toMatch(/archived/i);
  });

  it("survives a card with nothing on it", () => {
    const bare = renderTask(
      card({
        description_text: null,
        tags: [],
        assignees: [],
        relations: [],
        attachments: [],
      }),
      [],
    );

    expect(bare).toContain("Fix the deck editor autosave");
  });
});
