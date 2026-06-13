# Card Archive — Design

**Date:** 2026-06-13
**Status:** Approved (design); pending implementation plan.

## Summary

Add a per-team **Archive** for kanban cards. Instead of permanently
destroying cards, deletions send them to a team-scoped archive with a
list-based, filterable view. Cards can be restored back onto a board or
permanently purged.

## Goals / decisions

- **Archive triggers** (all of):
  - Manual "archive" action on a card (replaces the board's current delete).
  - Deleting a column archives its cards (instead of cascade-deleting them).
  - Deleting a board archives all its cards.
  - A permanent-delete escape hatch remains, exposed from the archive.
- **Restore:** restore to the original column when it still exists; otherwise
  the user picks a destination column (a board in the same team).
- **Scope:** one archive per team, reached from the boards sidebar. Shows that
  team's archived cards across all its boards, including boards that were
  later deleted.
- **Archived card interaction:** fields are read-only; the comment thread
  stays active ("view + comments only"). Actions: Restore, Permanently delete.

## Data model (Approach A: soft-delete in place + denormalized `team_id`)

The constraint: a card only knows its team through `column → board → team`,
and that chain is severed when a column/board is deleted (today the card
cascade-deletes). Denormalizing `team_id` onto the card lets the archive
survive board/column deletion.

Migration `1770000000007_card-archive` alters `cards`:

- `archived_at timestamptz null` — null = live, set = archived.
- `archived_by text null references users.id on delete set null` — who archived.
- `team_id uuid not null references teams.id on delete cascade` — denormalized,
  backfilled from `column → board → team` for existing rows.
- `archived_origin text null` — snapshot label `"Board name / Column name"`
  captured at archive time, so the list shows provenance after the board/column
  is gone.
- `column_id`: drop `not null`; change the FK from `on delete cascade` to
  `on delete set null` (drop + recreate the constraint via raw `sql`).
- Index `cards (team_id, archived_at)`.

`column_id` stays pointing at the real column even for a manually-archived
card (so in-place restore is free); it only goes null when the column/board is
actually deleted (explicit detach + `set null` backstop).

After the migration: `npm run migrate` + `npm run genDbTypes`.

### Rejected alternatives

- **B — separate `archived_cards` snapshot table:** duplicates data; freezes
  attachments/assignees/relations/comments or forces re-linking on restore;
  much more mapping code.
- **C — nullable `column_id` only, lazy team resolution:** breaks exactly when
  needed (board deleted → no team). Does not satisfy the team-archive goal.

## Server / oRPC

`src/server/orpc/teamAccess.ts`:

- `assertCardAccess` simplifies to: read `cards.team_id`, then
  `assertTeamMember`. Works for live and archived cards alike (the old
  3-join resolve breaks when `column_id` is null).

`src/server/orpc/boards.ts`:

- All board/search reads add `archived_at IS NULL`: `board.get`'s card query,
  `search.global`, and relation resolution (a live card must not list an
  archived counterpart).
- `createCard` sets `team_id` (resolved from the column's board).
- New `board.archiveCard({ cardId })` — sets `archived_at = now()`,
  `archived_by`, `archived_origin` snapshot; keeps `column_id`. Becomes the
  board UI's delete affordance.
- `deleteColumn` / `deleteBoard` — archive the live cards first (set
  `archived_at` / `archived_by` / `archived_origin`, then detach `column_id`),
  then delete the column/board. Comment cleanup is removed from these paths
  (cards and their comments are kept).

New `src/server/orpc/archive.ts` (`rpc.archive.*`), all team-gated:

- `archive.list({ teamId })` — archived cards for the team, fully nested
  (assignees, tags, attachments, relations, commentCount), ordered by
  `archived_at desc`. Reuses `board.get`'s nesting helpers.
- `archive.restore({ cardId, destinationColumnId? })` — clears `archived_at` /
  `archived_by` / `archived_origin`; if `column_id` is still set and its column
  exists, restore there at the end position; otherwise require
  `destinationColumnId`, validated to a board in the same team.
- `archive.purge({ cardId })` — permanent delete: the old `deleteCard`
  hard-delete logic, including `deleteCommentsOf`. This is the retained
  hard-delete.

Compose the archive router into `appRouter`.

## UI

- **Sidebar** (`BoardsSidebar`): an "Archive" entry under each team (next to
  its boards / "Add board"), linking to the team's archive route.
- **Route** `routes/home/boards/archive.$teamId.tsx` — under `boards/` so it
  keeps the boards sidebar + layout. URL search params (`q`, `tags`,
  `assignees`, `from`, `to`) mirror the board route for shareable filtered
  views.
- **List view** `CardArchiveList` — rows (not columns): title, tag chips
  (`TagBadge`), assignee avatars (`UserAvatar`), `archived_origin` label,
  archived date, created date. Filtering is client-side over the loaded list
  via the existing `cardFilters.ts` pure functions; the assignee filter is
  scoped via `<AssigneeCombobox teamId>`. Default sort: `archived_at desc`.
- **Card dialog** (`CardDialog`): add an `archived` mode — fields render
  read-only, the comment thread stays active; footer shows **Restore** and
  **Permanently delete**. Restore opens a destination-column picker only when
  `column_id` is null. Each action invalidates `rpc.archive.list`.

## Testing (vitest, procedure-level)

- `archiveCard` hides the card from `board.get` and `search.global`.
- `deleteColumn` / `deleteBoard` archive their cards instead of destroying
  them (cards remain, queryable via `archive.list`).
- `restore` in-place (origin column intact) and with a picked destination
  (origin gone).
- `purge` removes the card and its comments.
- Access control: non-member denied on every archive procedure; `archive.list`
  is team-scoped.
- Relation resolution excludes archived counterparts.
- `cardFilters` pure functions already have unit tests; reused as-is.

## Out of scope (YAGNI)

- Bulk archive/restore/purge.
- Auto-purge / retention policy.
- Archiving non-card entities (boards/columns themselves).
- Editing archived card fields (only comments stay active).
