# Tag combobox + tag-aware filtering

**Date:** 2026-06-13
**Status:** Approved

## Problem

Adding a tag to a card is free-text only ([CardDialog.tsx:259-289](../../../packages/app/src/components/boards/CardDialog.tsx)):
type → Enter/comma/blur. There is no way to discover or reuse tags already in
use, so the tag vocabulary drifts (typos, near-duplicates like `bug`/`Bug`).

Goals:

1. Adding a tag offers existing tags to pick from, and lets you create a new
   one when nothing matches what you typed.
2. The board's tag filter keeps showing the existing tags (it already does);
   make it stay correct as tags are added.

## Decisions

- **Suggestion source = whole team.** The add-tag picker suggests tags used
  across every board in the card's team (not just the current board), so
  vocabulary stays consistent across a team's boards. This needs a new
  server-side aggregation (board data alone only knows the current board).
- **Filter scope = current board only** (decision A). Each filter badge must
  match at least one card on the board — no dead options. The team-wide
  source feeds only the add-tag combobox; the filter keeps deriving its
  badges from the loaded board's cards (unchanged behavior, which already
  auto-syncs because `board.get` refetches after a card save).

## Design

### 1. Server: `rpc.board.teamTags`

New team-gated procedure in
[`src/server/orpc/boards.ts`](../../../packages/app/src/server/orpc/boards.ts).
Returns the distinct tags used across all **live** (non-archived) cards in a
team, sorted:

```ts
teamTags: authP
  .input(z.object({ teamId: z.uuid() }))
  .handler(async ({ input, context }) => {
    await assertTeamMember(context.user.id, input.teamId);
    const { rows } = await sql<{ tag: string }>`
      SELECT DISTINCT unnest(tags) AS tag
      FROM cards
      WHERE team_id = ${input.teamId} AND archived_at IS NULL
      ORDER BY tag
    `.execute(db);
    return rows.map((r) => r.tag);
  })
```

- Uses the denormalized `cards.team_id` (set in `createCard`) — no joins.
- Excludes archived cards, consistent with all other read paths.
- `unnest` of an empty `tags` array yields no rows, so cards with no tags
  contribute nothing.

### 2. Client: `<TagCombobox>`

New component
[`~/components/boards/TagCombobox.tsx`](../../../packages/app/src/components/boards/TagCombobox.tsx),
modeled on
[`AssigneeCombobox`](../../../packages/app/src/components/custom/AssigneeCombobox.tsx)
(popover + cmdk `Command`). Controlled multi-select.

Props:

```ts
{
  selected: string[];
  onChange: (tags: string[]) => void;
  teamId: string;
  placeholder?: string;
  className?: string;
}
```

Behavior:

- Fetches `rpc.board.teamTags({ teamId })` for the suggestion list.
- Renders the selected tags as removable hash-colored `<TagBadge>` chips
  above the trigger (same look as today; chips come from `selected`, so a
  just-created tag still shows even though it isn't in the fetched list yet).
- The popover has a `CommandInput` (controlled via `value`/`onValueChange` so
  we can read the typed text) and a `CommandList` of existing tags, each with
  a check when selected; selecting toggles membership.
- **Create-new:** compute `query = input.trim()`. If `query` is non-empty,
  1–40 chars, and has **no case-insensitive match** among existing tags ∪
  selected tags, render a `Create "<query>"` `CommandItem` that appends
  `query` and clears the input. Case-insensitive matching prevents accidental
  `bug`/`Bug` duplicates (it steers you to the existing tag instead).
- The 1–40 char bound mirrors the server validation in `updateCard`.

### 3. CardDialog integration

In [`CardDialog.tsx`](../../../packages/app/src/components/boards/CardDialog.tsx):

- Remove `tagInput` state, the `addTag()` function, and the free-text
  `<Input>` + chip-rendering block (lines ~259-289).
- Replace with:
  ```tsx
  <div className="flex flex-col gap-1.5">
    <Label>Tags</Label>
    <TagCombobox selected={tags} onChange={setTags} teamId={teamId} />
  </div>
  ```
- The `tags` state and the `save()` → `updateCard({ ..., tags })` flow are
  unchanged. `teamId` is already a prop of `CardDialog`.

### 4. Filter (no behavior change)

[`BoardFilters`](../../../packages/app/src/components/boards/BoardsSidebar.tsx)
keeps deriving `allTags` from the loaded board's cards and rendering the
clickable-`TagBadge` toggles. No code change required — adding a tag to a card
and saving refetches `board.get`, so the new tag appears in the filter
automatically. (Confirmed correct under decision A; documented here so it
isn't "improved" into showing dead team-wide options.)

## Testing

- `test/` procedure test for `board.teamTags`:
  - returns distinct tags across multiple cards/boards in one team, sorted;
  - excludes tags that appear only on archived cards;
  - is team-gated (a non-member gets `FORBIDDEN`/`NOT_FOUND`);
  - returns `[]` for a team whose cards have no tags.
- Build the combobox following TDD where practical; the create-new match
  logic (case-insensitive existence check, trim, length bound) is the part
  worth a focused unit test if extracted to a pure helper.

## Docs

Update `CLAUDE.md` (Kanban section): note `rpc.board.teamTags` and that
`<TagCombobox>` (create-or-pick, team-wide suggestions) is the tag input,
built on the same combobox idea as `<AssigneeCombobox>`.

## Out of scope (YAGNI)

- A separate `tags` table / tag metadata (colors, descriptions). Tags stay
  plain strings in `cards.tags text[]`.
- Tag rename/merge across a team.
- Tags on `createCard` (tags are still added via the edit dialog).
- Team-wide filter options (decision A).
