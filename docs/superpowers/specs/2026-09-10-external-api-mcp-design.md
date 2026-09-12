# External API: API keys + MCP server (and locking down file serving)

**Date:** 2026-09-10
**Status:** Implemented (2026-09-10)

## Problem

Insacco should be reachable from outside the browser, primarily so **Claude
Code** can be handed a task: read a card with its full context (description,
comments, attachments, assignees, relations), do the work, and report back by
commenting on the card. A secondary goal is that a hand-written Discord bot can
read tasks over plain HTTP later.

Two surfaces were considered — OpenAPI/REST and MCP. They share ~70% of the
work (an API-key table, bearer auth in `resolveSession`, a curated set of
externally-safe procedures) and differ only in the last mile. **MCP ships
first** because Claude Code consumes it natively (`claude mcp add --transport
http`), and it discovers tools on its own. OpenAPI stays a cheap follow-up on
the same foundation (see Non-goals).

Investigating asset access surfaced a **pre-existing security problem** in
`GET /api/files` that this project fixes first (Part 1).

## Decisions (from brainstorming)

- **Consumers:** Claude Code (MCP) now; a hand-written bot (OpenAPI) later.
- **Key scope:** a key acts as its creating user across **all** their teams. No
  per-team binding, no read/write split. Existing `assertTeamMember` gates then
  apply unchanged.
- **Surface:** a **curated subset** of procedures, not the whole `appRouter`.
- **Tools are hand-written**, shaped for the task-assignment workflow — not
  auto-generated one-per-procedure. There is no official oRPC↔MCP bridge to
  use anyway (verified against oRPC v1.15's packages and doc index).
- **Key storage:** our own table, not `@better-auth/api-key`. The plugin exists
  (split out of core as a version-matched package) and would integrate with
  near-zero changes, but it carries ~20 columns for rate limiting, refills and
  permissions we do not want, and its schema would have to be mirrored by hand
  in a kysely migration forever. This follows the precedent already set by
  `teams` over better-auth's organization plugin.
- **Assets:** a `get_attachment` MCP tool returns file bytes as an MCP content
  block, so Claude Code can actually *see* a screenshot rather than link to it.

## Part 1: fix `GET /api/files` (do this first)

### The current state

`routes/api/files.ts` performs **no authentication and no authorization**. Any
`fileId` is served to anyone on the internet, logged in or not.

It is not browsable — ids are `randomUUID()` + extension (~122 bits) and no
endpoint lists other users' files — so this is an "anyone with the link" model
rather than an open corpus. Two things make it worse than typical:

1. Not even a logged-in account is required, so a URL pasted into Discord is
   public forever.
2. **Nothing ever deletes a file.** There is no `deleteFrom("files")` and no
   `unlink` in the codebase. `board.removeAttachment` only drops the
   `card_attachments` join row, so a "removed" attachment stays fetchable at
   the same URL permanently. There is no revocation.

### Authorization

New `src/server/fileAccess.ts` exporting `assertFileAccess(userId, path)`.

Note the route's `fileId` query parameter is the **storage path**
(`<uuid>.<ext>`, see `fileUrl`), not `files.id`. Resolve by `path`.

Access is granted when any of these hold:

- `files.user_id = userId` — the uploader always keeps access, which also
  covers uploads not yet attached to anything (the `/play/demo` gallery).
- The file is attached to a card whose `cards.team_id` is one of the caller's
  teams (`card_attachments` → `cards`, reusing `myTeamIds`).
- The file is a `game_deck_cards` image. Decks are deliberately **global**
  content (any logged-in user), so membership is not checked.

One query with `EXISTS` legs. Failure returns **404, not 403**, so the endpoint
never confirms that an id exists.

### Route changes

- Resolve the caller ⇒ 401 if there is none.
- `assertFileAccess` ⇒ 404 on denial.
- `Cache-Control: public, max-age=86400` becomes **`private`**.

Because Part 1 lands **before** API keys exist, resolution goes through a new
shared `resolveHttpCaller(request)` helper (`server/httpCaller.ts`) that starts
cookie-only. Part 2 adds the bearer-key branch inside that one helper, so the
route itself is not touched again.

Same-origin `<img>` tags keep working — the browser sends the session cookie.
The support widget needs no change (attachments are out of scope there).

**Accepted cost:** each uncached file request now resolves a session, adding a
DB round-trip. `max-age=86400` means this is a first-load cost per file per
browser, which is acceptable.

**User-visible break:** any `/api/files` link previously pasted outside the app
stops working for logged-out readers. That is the point of the change, but it
should be announced to the group rather than discovered.

### Deletion

New `deleteFileIfUnreferenced(fileRowId)` (in `server/fileAccess.ts`) plus
`fileService.deleteFile(path)` (unlink, ignoring `ENOENT`).

**Critical gotcha:** both `card_attachments.file_id` and
`game_deck_cards.file_id` are declared `ON DELETE CASCADE` to `files.id`
(`1770000000002_files-boards.ts`, `1770000000009_games.ts`). The database will
therefore **never block** deleting a still-referenced file — it will silently
strip it from every card and deck that uses it. The reference check must be
application-level, and must be correct.

Procedure:

1. Inside a transaction, `SELECT … FOR UPDATE` the `files` row, then count
   references in `card_attachments` and `game_deck_cards`. If either is
   non-zero, do nothing.
2. If zero, delete the `files` row and commit.
3. **After** the commit, unlink the bytes from disk.

Disk deletion cannot participate in the transaction, so it goes last. If the
process dies between commit and unlink the result is an orphaned file on disk —
harmless and unreachable. The reverse ordering could serve a row whose bytes are
gone, which the route already tolerates (`fileService.exists` ⇒ 404).

Concurrent detaches are safe: the row lock serializes them, and both `unlink`
and the row delete are idempotent.

Call sites (each must collect file ids **before** the cascading delete removes
the join rows):

- `board.removeAttachment`
- `archive.purge` — deleting the card cascades `card_attachments` away
- `game.decks.removeCard` and `game.decks.delete`

Files that were never attached are **not** garbage-collected; they belong to
their uploader and appear in `file.mine`.

## Part 2: API keys

### Schema

Migration `1770000000011_api-keys.ts`:

```
api_keys(
  id           uuid pk default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  name         text not null,
  key_hash     text not null unique,
  prefix       text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
)
```

`prefix` is the first ~8 characters of the token, stored in clear purely so the
UI can distinguish keys in a list.

### Key handling — `src/server/apiKeys.ts`

- Token format `ins_<base64url(randomBytes(32))>`, returned **once** at
  creation and never recoverable.
- Stored as a plain **SHA-256** hash. Deliberately not bcrypt/argon2: the token
  is 256 bits of entropy rather than a guessable password, so key-stretching
  buys nothing, and this hash runs on every external request — it must be fast.
  The unique index on `key_hash` makes verification a single indexed lookup,
  so there is no timing oracle worth defending against.
- `resolveApiKey(token)` joins `users`, rejects rows with `revoked_at` set, and
  **throttles** the `last_used_at` write to at most once per 60 seconds per key
  so reads don't cause a write per request.

### Auth wiring

`resolveSession` in `server/orpc/base.ts` is already the single choke point
reconciling the WebSocket and HTTP transports; an API key becomes a third
branch, resolved in this order:

1. `context.connection` (WebSocket, auth pinned at upgrade)
2. `Authorization: Bearer ins_…` from `context.reqHeaders`
3. the session cookie via `auth.api.getSession`

Because every `authP` procedure and every `assertTeamMember` /
`assert*Access` gate reads `context.user`, **no procedure needs editing** to
accept key callers.

API-key callers have no better-auth session row, so `resolveSession`'s return
type widens to `session: AuthSession | null` and gains `viaApiKey: boolean`.
Only two call sites read it — `authP` itself and the `auth.getSession`
procedure in `router.ts` (which is the cookie path in practice).

**API keys are HTTP-only.** They are deliberately not wired into the WebSocket
upgrade: the browser is the only WS client, and it has a cookie.

### Management API and UI

`rpc.apiKey.*` (`src/server/orpc/apiKeys.ts`), all `authP`, all scoped to the
caller's own keys:

- `list` — name, prefix, created_at, last_used_at (never the hash)
- `create({ name })` — returns the plaintext token exactly once
- `revoke({ id })` — sets `revoked_at`

UI: an "API keys" dialog reached from `UserActions`, listing keys with a
create form and a revoke action, and showing a new token once with a copy
button and an explicit "this will not be shown again" warning.

## Part 3: the MCP server

### Endpoint

`src/routes/api/mcp.ts`, `POST` only.

`@modelcontextprotocol/sdk` (v1.30.x) ships
`WebStandardStreamableHTTPServerTransport`, whose
`handleRequest(request): Promise<Response>` is pure Web Fetch — no Node
`req`/`res` adapter is needed inside TanStack Start. Used **stateless**
(`sessionIdGenerator: undefined`), building a fresh server and transport per
request, which is correct for a single request/response route.

Flow: read `Authorization: Bearer` ⇒ `resolveApiKey` ⇒ 401 with
`WWW-Authenticate` if absent or revoked ⇒ build an `ORPCContext` carrying the
resolved user ⇒ register tools ⇒ `transport.handleRequest(request)`.

Tools dispatch through `call(appRouter.x.y, input, { context })` from
`@orpc/server` — the same mechanism the test suite already uses. `ORPCError`s
are converted to MCP tool errors carrying the message.

Neither SDK validates `Host`/`Origin`; the route rejects requests whose `Host`
is not the configured `VITE_FRONTEND_URL` host as DNS-rebinding defence.

### Layout

```
src/server/mcp/
├── server.ts      # builds McpServer, registers tools
├── render.ts      # markdown rendering (pure — unit tested)
└── tools/*.ts     # one file per tool group
```

### Tools

| Tool | Backed by | Notes |
| --- | --- | --- |
| `list_teams` | `team.list` | |
| `list_boards` | `board.list` | |
| `get_board` | `board.get` | Compact: columns + card ids/titles/tags/assignees, no descriptions |
| `search` | `search.global` | Existing fuzzy search |
| `get_task` | new `board.getCard` + `chat.open` | The full dossier |
| `get_attachment` | `fileService` + `assertFileAccess` | Bytes as an MCP content block |
| `create_task` | `board.createCard` | |
| `update_task` | `board.updateCard` / `board.moveCard` | Title, description, tags, assignees, column |
| `comment_task` | `chat.send` | Closes the loop — Claude Code reports progress onto the card |
| `archive_task` | `board.archiveCard` | |

Subscriptions, presence, file upload, the support widget and the game/deck
procedures are never registered.

**`get_task`** is the centrepiece and returns one markdown document: title,
ids, board/column, tags, assignees, relations (`blocks` / `blocked_by` /
`related`), the description, every comment with author and timestamp, and the
attachment list with names, types and URLs. Rendering is a pure function in
`render.ts`.

Two existing details make this cheap: cards already carry `description_text`
and chat messages already carry `body_text` (the search companion columns), so
Lexical-to-text for the model is a column read rather than a transform.

**New procedure `board.getCard`** — the UI only ever loads cards nested inside
`board.get`, so there is no single-card read today and a bot would otherwise
have to fetch a whole board to see one task. Gated by the existing
`assertCardAccess`, and it reuses `attachCardExtras` from `boards.ts`.

**`comment_task`** writes plain text into the Lexical message model via the
existing `plainTextToLexical` from `server/support.ts` — the same path the
support widget already uses.

**`get_attachment`** takes the storage path exactly as it appears in
`get_task`'s attachment list, runs the **same** `assertFileAccess`
gate as the browser route (one rule, two callers), and returns an image content
block for images, text for text files, and otherwise an error directing the
caller to the URL. Payloads are capped at 5 MB; raster images are already
downscaled to ≤1920px WebP on upload.

### Connecting

```bash
claude mcp add --transport http insacco https://<host>/api/mcp \
  --header "Authorization: Bearer ins_..."
```

## Non-goals

- **Rate limiting** on API keys. Friend-group scale; add later if needed.
- **Key expiry and per-key scopes** (read-only, single-team). The chosen model
  is "a key is its user".
- **OpenAPI/REST.** A deliberate follow-up, not a rewrite: `@orpc/openapi`
  v1.15's `OpenAPIHandler` takes a `filter` option, so the same curated set
  becomes REST plus a Scalar docs page (via `OpenAPIReferencePlugin`) in
  roughly 20 lines. Note the zod v4 converter must be imported from
  `@orpc/zod/zod4`, and subscriptions must be excluded by the filter.
- **API keys over WebSocket.**
- **Garbage-collecting never-attached uploads.**
- **MCP resources and prompts** — tools only.
- **Signed/expiring file URLs.**

## Testing

Unit (`src/**/*.test.ts`, pure functions):

- key generation, hashing, and prefix extraction
- `get_task` markdown rendering, including empty comments/attachments/relations

DB and procedure tests (`test/`, real Postgres):

- `assertFileAccess` matrix: uploader; teammate via a card attachment;
  non-member via a card attachment (denied); any user via a deck image;
  unattached file for a non-uploader (denied); unknown path (404)
- `deleteFileIfUnreferenced`: deletes when the last reference goes; is a no-op
  while a second card or a deck still references it; `archive.purge` collects
  ids before the cascade
- `board.getCard` access gating (member vs non-member)
- API key auth end-to-end through `resolveSession`: a valid key resolves a
  user; a revoked key is refused; a garbage token is refused; `last_used_at`
  is throttled
- key management procedures never leak `key_hash` and never touch another
  user's keys

MCP tool handlers are tested as plain functions given a context, without going
through the transport.

## Implementation order

1. **Part 1** — file authorization and deletion. Independently valuable and
   independently testable; it fixes a live problem regardless of the rest.
2. **Part 2** — the `api_keys` table, `resolveSession` branch, management
   procedures and UI.
3. **Part 3** — `board.getCard`, the MCP route, and the tools.

## CLAUDE.md updates

Alongside the code:

- A new **"External API (API keys + MCP)"** convention section: the key model,
  the `resolveSession` branch, the curated tool list, where to add a tool, and
  the rule that new tools are hand-written rather than generated.
- Rewrite the **File uploads** section: serving now requires a session or API
  key plus `assertFileAccess`, and files are garbage-collected when their last
  reference goes — including the `ON DELETE CASCADE` trap that makes the
  application-level reference check mandatory.
- Note in **Deploy** that `/api/mcp` needs no special handling (same port, plain
  POST).

## As built — deviations from this spec

Implemented in `58a4a19` (files), `615f07b` (API keys), `2d48438` (MCP).
Where the build differs from the design above, the build is right:

- **The MCP endpoint refuses session cookies.** Not in the original design.
  Accepting them would make `/api/mcp` reachable cross-site from a logged-in
  user's browser, so it takes API keys only, and additionally rejects a `Host`
  that isn't `VITE_FRONTEND_URL`'s.
- **`deleteFileIfUnreferenced` uses one atomic statement**, not a transaction
  with `SELECT … FOR UPDATE`. The `NOT EXISTS` legs ride inside the `DELETE`,
  which removes the read-then-write window and avoids an explicit transaction —
  which would nest badly inside the test harness's `BEGIN`/`ROLLBACK`.
- **Eleven tools, not ten.** `list_team_members` was added: `update_task`'s
  `assigneeIds` needs user ids, and nothing else surfaced them.
- **Migration is `1770000000012_api-keys`** — `…011` was taken by
  `file-path-index`. `api_keys.user_id` is `text`, because better-auth's
  `users.id` is text rather than a uuid.
- **`resolveSession` returns `session: AuthSession | null` plus `viaApiKey`**,
  as designed; a bearer token that looks like ours but doesn't resolve now
  fails outright rather than falling through to the cookie.
- **Test uploads** go to `./data/test-images` (`vitest.config.ts` `env`) so they
  never touch the dev image store.
- Route logic lives in `server/fileServe.ts` and `server/mcp/route.ts` so both
  are directly testable; the route files are thin wrappers.

**Verification:** 235 tests pass, type-check and production build are clean, and
the whole flow was exercised against a running server — sign-up, key creation,
`initialize`, `tools/list`, and `create_task` → `comment_task` → attach →
`get_task` → `update_task`, plus `/api/files` returning 401 anonymously and 200
with either a cookie or a key. The two security-critical route tests (cookies
refused; no cross-user leakage) were mutation-tested to confirm they fail when
the protection is removed.

## Addendum (2026-09-12): OAuth for claude.ai connectors

claude.ai custom connectors only speak OAuth, so API keys alone left the MCP
server unreachable from claude.ai. Decision: make the app its own OAuth 2.1
authorization server with better-auth's `mcp()` plugin, and keep API keys for
scripts. Rejected: hand-rolling a mini OAuth server that mints API keys (~200
lines of security-sensitive code), and the newer `@better-auth/oauth-provider`
(needs the JWT plugin, a JWKS table and a consent page; same three DB tables,
so switching later is config — `mcp()` is flagged "soon deprecated").

**Identity model, unchanged:** there is no Claude user and no scope system.
The person who signs in during the OAuth popup is who Claude acts as, with
that person's team memberships. Want a narrower Claude? Sign in as a dedicated
account that belongs to fewer teams.

**What was built**
- Plugin registered in `auth.ts` (`loginPage: /auth/login`, `resource:
  <origin>/api/mcp`, 30-day access / 90-day refresh tokens, snake_case schema
  map). Migration `1770000000013_oauth-provider` → `oauth_applications`,
  `oauth_access_tokens`, `oauth_consents`.
- Root discovery routes `routes/[.]well-known/oauth-authorization-server.ts`
  and `…/oauth-protected-resource.ts` (the plugin's copies live under
  `/api/auth/.well-known/`; clients look at the root).
- `server/bearerAuth.ts` `resolveBearerCaller`: `ins_` → API key, anything
  else → `auth.api.getMcpSession`. Used by `resolveSession` and
  `resolveHttpCaller`; `/api/mcp` calls it and answers 401 with the RFC 9728
  `WWW-Authenticate … resource_metadata=` challenge. Cookies still refused.
- `lib/oauthLogin.ts` + login/sign-up pages: when the authorize query is
  present, a successful login continues with a full navigation to
  `/api/auth/mcp/authorize?…`; because the plugin's after-login hook may answer
  the sign-in fetch with a cross-origin 302 (which fetch can't follow), an
  error followed by "am I signed in? yes" is treated as success. Discord login
  passes the authorize URL as its `callbackURL`. Both pages state plainly that
  Claude will act as the account being used.
- `ApiKeysDialog` shows the connector URL and the OAuth path for Claude Code;
  keys are described as the option for scripts.

**The consent screen was replaced by a redirect allowlist, not skipped.**
Anonymous dynamic client registration plus no consent means a rogue client
could otherwise mail a logged-in member an authorize link and collect a
30-day token. `server/oauthRedirects.ts` (`isAllowedOAuthRedirect`, enforced
by a `hooks.before` guard on `/mcp/register`) accepts only https URLs on
exactly claude.ai / claude.com (no subdomains — real clients use one fixed
callback, and a wildcard would forward codes off-platform if any subdomain
ever hosted an open redirect) and loopback — and refuses any URI containing a comma,
because better-auth stores `redirect_uris.join(",")` and splits it back at
authorize time, so a comma inside one entry would register an unchecked second
target. Residual risk: a code can still be delivered to the victim's own
loopback, which no third party can read.

PKCE is required (`requirePKCE`), and a test pins the property the whole model
rests on: authorize refuses a `redirect_uri` the client never registered.

**Deliberately not built:** consent screen, scopes, a token-revocation UI,
rate limiting on the public register/token endpoints (same posture as the
public support widget).

**Testing:** `test/oauth.test.ts` runs the full in-process dance (dynamic
client registration → authorize with a session cookie → PKCE code exchange →
`getMcpSession`), checks both discovery documents, the registration allowlist
(including comma smuggling), the 30-day `expires_in`, and proves an OAuth
token authenticates oRPC procedures and plain routes as its user, that an
expired token is refused, and that a bad bearer never falls back to the
cookie. `src/server/oauthRedirects.test.ts` unit-tests the allowlist.
`test/mcpRoute.test.ts` covers the 401 challenge and tool calls with an OAuth
token. The browser handoff was verified with curl against a running dev
server: logged-out authorize → `/auth/login` + prompt cookie, sign-in → 302 to
the client callback with a code, logged-in authorize → code directly.
