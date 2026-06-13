# coglionazzi.com

A just-for-fun app for a Discord friend group: games, puzzles, rankings —
whatever we feel like building. Tone is playful; quality bar is real
(modelled on the `../propanalyst` codebase, which is the reference for all
patterns used here).

## Keep this file current

**This file is part of the deliverable — update it in the same change.** When
work alters something documented here, edit CLAUDE.md alongside the code (and
mention it in the commit). Update when you:

- add/rename/move a notable file, route, oRPC router, table, or env var, or
  change the repo layout / commands;
- introduce or change a convention, pattern, or reusable component, or a
  non-obvious gotcha worth recording;
- change the stack, deploy setup, or testing approach.

Keep edits tight — document the rule and where it lives, not every detail
(the code is the source of truth). Skip trivia: routine bug fixes, one-off
tweaks, or anything already obvious from the code. If a change contradicts
something written here, fix the stale text rather than leaving both.

## Stack

| Concern        | Choice                                                          |
| -------------- | --------------------------------------------------------------- |
| FE/BE framework| TanStack Start (Vite plugin, file-based routes, SSR)             |
| API layer      | oRPC (`@orpc/server` + `@orpc/client` + `@orpc/tanstack-query`) |
| Realtime       | oRPC WebSocket adapter (crossws via Nitro) + `EventPublisher`   |
| Auth           | better-auth (email/password), mounted at `/api/auth/$`          |
| Database       | Postgres + Kysely (kysely-ctl migrations, kysely-codegen types) |
| Queries        | TanStack Query (via oRPC query utils)                           |
| Forms          | TanStack Form + zod, through the `useAppForm` wrapper           |
| Styling        | Tailwind v4 (CSS-first config) + shadcn/ui (new-york style)     |

## Repo layout

Turborepo with npm workspaces. Single subproject for now (`packages/app`);
more (e.g. a `cron`) may be added later.

```
package.json            # workspace root; turbo scripts proxy into @this/app
turbo.json
docker-compose.yml      # local DEV Postgres on port 5460
deploy/                 # production stack (dokploy/Traefik) — see Deploy below
├── compose.yml
└── .env.example
packages/
├── .env                # shared env, gitignored (.env.example is the template)
└── app/
    ├── .config/kysely.config.ts   # kysely-ctl config (migrations)
    ├── migrations/                # timestamped Kysely migrations
    ├── components.json            # shadcn config
    ├── Dockerfile                 # turbo-pruned build; entrypoint migrates + serves
    ├── entrypoint.sh              # kysely migrate:latest (retry) → node .output
    ├── vite.config.ts             # envDir ".." → reads packages/.env; port 3300
    │                              #   nitro({ features.websocket, handlers:[/api/rpc-ws] })
    └── src/
        ├── router.tsx             # QueryClient (toast on errors) + router
        ├── routes/
        │   ├── __root.tsx         # head, theme init script, session beforeLoad
        │   ├── index.tsx          # redirects to /home or /auth/login
        │   ├── auth/              # public: route.tsx layout + login + sign-up
        │   ├── home/              # protected: route.tsx = guard + topbar (sections nav)
        │   │   ├── index.tsx      # Home = global chat only
        │   │   ├── demo.tsx       # playground: editor + file uploads
        │   │   ├── games/         # global Versus game: index (lobbies+decks),
        │   │   │                  #   decks/$deckId/{index editor, stats}, $sessionId play
        │   │   └── teams/         # Teams section: route.tsx = TeamRail (rail lives
        │   │       │              #   ONLY here), index → first team, $teamId/
        │   │       │              #   (route.tsx = TeamPanel) → board/chat/archive
        │   └── api/
        │       ├── auth/$.ts      # better-auth handler (GET/POST)
        │       ├── files.ts       # GET ?fileId= → streams an uploaded file
        │       └── rpc/$.ts       # oRPC RPCHandler (ANY), prefix /api/rpc
        ├── server/                # server-only code
        │   ├── db.ts              # pg Pool + Kysely instance + dialect
        │   ├── dbtypes.ts         # DB types (regenerate: npm run genDbTypes)
        │   ├── auth.ts            # betterAuth() config + snake_case field maps
        │   ├── ws/
        │   │   └── rpcHandler.ts  # crossws WS handler: upgrade auth + 5-min re-check
        │   ├── files.ts           # disk storage; optimizes images on upload (sharp)
        │   ├── realtime/
        │   │   ├── publisher.ts   # shared EventPublisher + chatPublisher (room-keyed)
        │   │   ├── presence.ts    # in-memory per-board viewer registry
        │   │   ├── gamePublisher.ts # session-keyed game events + lobby presence
        │   │   └── versusEngine.ts  # in-memory Versus bracket state machine + timer
        │   └── orpc/
        │       ├── base.ts        # ORPCContext (+ connection), `t`, `authP`, resolveSession
        │       ├── roomAccess.ts  # chat room ref/resolve/access (per-kind)
        │       ├── chat.ts        # chat.* (rooms + messages + reactions + subscribe)
        │       ├── presence.ts    # presence.subscribe Event Iterator
        │       ├── game/          # decks + sessions (lobby) + versus module + access
        │       ├── router.ts      # appRouter — add feature routers here
        │       └── client.ts      # createAppClient → typed client + query utils
        ├── lib/
        │   ├── rpcClient.tsx      # SSR=fetch link, browser=WebSocket link
        │   ├── wsClient.ts        # partysocket ReconnectingWebSocket singleton (browser)
        │   ├── useRealtime.ts     # useBoardRealtime/useBoardPresence/useWorkspaceRealtime
        │   ├── useChatRoom.ts     # open + live-stream a chat room (messages/reactions)
        │   ├── useGameSession.ts  # seed + live-stream a game session (presence/votes/state)
        │   ├── authClient.tsx     # better-auth react client
        │   ├── theme.ts           # light/dark via class on <html>, localStorage
        │   └── classUtils.tsx     # cn()
        ├── components/
        │   ├── ui/                # shadcn components (add via shadcn CLI)
        │   ├── teams/             # TeamRail (global bubble rail) + TeamPanel
        │   ├── games/             # NewGameDialog (create a Versus session)
        │   └── custom/            # AppForm, Logo, TeamAvatar, app-specific
        └── styles/app.css         # the ONLY Tailwind/theme config (v4 CSS-first)
```

## Commands

Run from repo root:

- `npm run dev` — dev server at http://localhost:3300 (Postgres must be up: `docker compose up -d`)
- `npm run build` / `npm run start` — production build / serve
- `npm run type-check` — tsc over the app
- `npm test` — vitest (needs Postgres up; uses a dedicated `coglionazzi_test` DB)
- `npm run migrate` / `npm run rollback` — Kysely migrations (uses packages/.env)
- `npm run genDbTypes` — regenerate `src/server/dbtypes.ts` from the live DB

## Deploy

Production runs as a Docker stack under dokploy/Traefik (same shape as
`../propanalyst/deploy`), trimmed to what this app needs: the app + its own
Postgres + a `uploads` volume for assets.

- `deploy/compose.yml` — `app` (built from `packages/app/Dockerfile`) +
  `postgres` (bundled, `coglionazzi-pg-data` volume) + `coglionazzi-uploads`
  volume. The app joins the external `dokploy-network` (Traefik routes to it
  by `Host(${APP_HOST})`, TLS via letsencrypt — no published host port) and
  an `internal` bridge for app↔postgres. `IMAGES_PATH=/app/uploads`.
- The image is a turbo-pruned multi-stage build. `VITE_FRONTEND_URL` is a
  build ARG (baked into the client bundle) AND a runtime env (better-auth);
  it must equal the public origin. `entrypoint.sh` runs
  `kysely migrate:latest` (retrying until Postgres is up — swarm ignores
  `depends_on`) then serves on `$PORT` (3000).
- Env in `deploy/.env` (see `.env.example`): `APP_HOST`, `VITE_FRONTEND_URL`,
  `POSTGRES_PASSWORD`, `AUTH_SECRET`. Deploy with
  `docker compose up -d --build` from `deploy/`.
- Local smoke-test without Traefik: add an override publishing the port
  (`ports: ["8090:3000"]`) and `docker network create dokploy-network`.
- Realtime (see Conventions → Realtime) needs nothing extra: the WebSocket
  shares the app's port (`/api/rpc-ws`) and Traefik forwards upgrades by
  default. Keep it to ONE app replica — the event bus/presence live in
  process; scaling out requires a LISTEN/NOTIFY backplane first.

## Conventions

### API: oRPC

- Procedures live in `src/server/orpc/router.ts`; split feature routers into
  `src/server/orpc/<feature>.ts` and compose them in `appRouter` as it grows.
- Public procedures build on `t`, authenticated ones on `authP` (gives
  `context.user` / `context.session`, throws `UNAUTHORIZED` otherwise).
- Validate inputs with `.input(z.object({...}))`. Throw `ORPCError` with a
  proper code (`BAD_REQUEST`, `FORBIDDEN`, …) for domain errors.
- Client side: import `rpc` from `~/lib/rpcClient` and use
  `rpc.<router>.<proc>.queryOptions(...)` / `.mutationOptions(...)` with
  TanStack Query. Never fetch `/api/rpc` by hand.

### Auth

- Session is resolved ONCE in `__root.tsx` `beforeLoad` (staleTime Infinity)
  and lands in router context: guard routes with `ctx.context.user` in
  `beforeLoad` (see `routes/home/route.tsx`).
- After login/signup/logout: `reconnectRealtimeSocket()` (re-upgrade the WS
  with the new cookie — see Realtime) + `queryClient.removeQueries()` +
  `router.invalidate()` + navigate — otherwise the cached session and the
  old socket's identity stick.
- BOTH login and signup run over HTTP via the better-auth client directly
  (`authClient.signIn.email` / `authClient.signUp.email`, autoSignIn on) —
  they set the session cookie with Set-Cookie, which the WebSocket transport
  can't deliver, so they must NOT go through oRPC. The oRPC `auth` router is
  read-only (`getSession`).
- better-auth maps camelCase fields to snake_case columns in
  `src/server/auth.ts` — new auth-related tables must follow that pattern.
- **Discord OAuth** (optional): `socialProviders.discord` is registered only
  when `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` are set (so dev boots
  without them). The `<DiscordSignInButton>` (`components/custom/SocialAuth.tsx`)
  on both auth pages calls `authClient.signIn.social({provider:"discord",
  callbackURL:"/home"})` — a FULL-PAGE redirect, so the page reloads fresh and
  the realtime socket re-upgrades on its own (NO `reconnectRealtimeSocket()`,
  unlike email login/signup). Redirect URL to register with Discord:
  `${VITE_FRONTEND_URL}/api/auth/callback/discord`.
- **Account linking** is on with `trustedProviders: ["discord"]`
  (`account.accountLinking` in `auth.ts`): signing in with Discord
  auto-links to an existing account with the same email. Only safe because
  Discord verifies emails — NEVER add a provider that doesn't (silent account
  takeover). Untrusted providers keep better-auth's default (refuse + error).
- **Profile pictures:** better-auth populates `users.image` from the provider
  (Discord avatar). `<UserAvatar image=…>` renders it and falls back to
  hash-colored initials when absent. Any query that feeds an avatar must
  `select` `users.image` and pass it through — already wired for `user.list`,
  `team.members`, card assignees (`board.get`/`archive.list`), chat authors
  (`authorImage` on the message payload), and board + game-lobby presence.

### Database

- New tables = new timestamped file in `migrations/` (copy an existing one;
  raw SQL via `sql` template). Then `npm run migrate` + `npm run genDbTypes`.
- Query with the shared `db` (Kysely) from `~/server/db`. snake_case columns.

### Forms

- Use `useAppForm` (`~/components/custom/AppForm`) with a zod schema in
  `validators.onChange`. Fields render through `form.AppField` +
  pre-bound components (`f.TextField`); submit via `form.AppForm` +
  `form.SubscribeButton`. See `routes/auth/sign-up.tsx` for the pattern.
- Add new field kinds (selects, switches, …) to AppForm's `fieldComponents`,
  not ad-hoc in pages.

### Styling

- Tailwind v4: there is NO tailwind.config — design tokens live in the
  `@theme` block of `src/styles/app.css`. TWO independent axes, both classes
  on `<html>`: light/dark mode (`light` is the default) × a brand "skin"
  (`.brand-arcade` | `blurple` | `sunset` | `deepsea` — `arcade`, neon
  purple, is the default). Each `.<mode>.brand-<x>` block overrides the
  token vars. Add a brand by adding both its `.dark.brand-x` /
  `.light.brand-x` blocks AND an entry in `BRANDS` (`lib/theme.ts`).
- Always use semantic tokens (`bg-card`, `text-muted-foreground`,
  `text-primary`, `border-border`…), never hardcoded colors, so every
  mode×brand combo works. (Exception: `components/custom/Logo.tsx` bakes the
  arcade palette into its SVG — update it by hand if the brand identity
  changes; `public/favicon.svg` is the same artwork, keep them in sync.)
- Primary filled surfaces (default Button variant) wear the `special`
  utility → brand gradient + readable label. Links use `text-link`.
- Theme + brand switching: `toggleTheme()`/`useTheme()` and
  `setBrand()`/`useBrand()` from `~/lib/theme` (classes on `<html>`,
  persisted to localStorage, init script in __root prevents flash).
  `<BrandPicker>` is the topbar swatch picker.
- New shadcn components: `npx shadcn@latest add <name>` inside
  `packages/app` (components.json is configured; cn lives at
  `~/lib/classUtils`).

### Rich text (Lexical)

- Use `<RichTextEditor />` from `~/components/editor/RichTextEditor` for any
  formatted-text feature. It's uncontrolled: pass `onChange` to receive the
  serialized editor-state JSON (persist that string) and `initialState` to
  restore it. Demo on `/home`.
- Keyboard submit: pass `onSubmit` to fire on ⌘/Ctrl+Enter (Shift/bare Enter
  = newline). Implemented by `components/editor/SubmitPlugin.tsx`. NEVER use
  bare Enter to send — `<MessageComposer>` (the one shared composer for
  comments + chat) is ⌘/Ctrl+Enter only; the `submitOnEnter` prop exists but
  is unused (kept for flexibility).
- Feature set is local-only (history, headings/quote/code, lists +
  checklists, links + autolink, markdown shortcuts, alignment/indent, hr).
  New toolbar actions go in `components/editor/ToolbarPlugin.tsx`; new nodes
  must be registered in the `nodes` array AND themed (theme object in
  RichTextEditor + classes in `styles/editor.css`).

### File uploads

- Upload via `rpc.file.upload` (`{ file: File }`, auth required, ≤20MB,
  allowlisted mime types: images, pdf, text/markdown, zip, mp3, mp4) →
  returns `{ id, path, name, type, url }`. List the caller's files with
  `rpc.file.mine`. UI helpers in `~/components/custom/FileUploads`:
  `<UploadButton onUploaded>`, `<FilePreview>` (image thumb / file chip)
  and the `<FileUploads />` gallery.
- Files live on disk at `IMAGES_PATH` (default `packages/app/data/images`,
  gitignored) and are served by `GET /api/files?fileId=…` with long cache.
  The `files` table records path + metadata (`{name,type,size}`) + uploader.
- Raster images are optimized on upload in `fileService.addFile` (`server/files.ts`,
  via `sharp`): auto-orient, downscale to ≤1920px longest edge, strip metadata,
  recompress to WebP q80 — so we never store/serve 8K originals. SVG and GIF are
  left untouched; `addFile` returns the metadata of what was ACTUALLY stored
  (type/size/name change for optimized images). Note: the ≤20MB cap is on the
  UPLOAD; optimization shrinks what's stored, not the bytes uploaded.

### Teams (permissions)

- `teams` + `team_members(team_id, user_id, role)` (role `owner | member`).
  Boards belong to a team (`boards.team_id`, NOT NULL); a user sees/touches
  a board only if they're a member of its team. Users join many teams. This
  is a custom model (mirrors propanalyst's `group_members`), NOT
  better-auth's organization plugin.
- Access control lives in `src/server/orpc/teamAccess.ts`: `assertTeamMember`
  / `assertTeamOwner`, `assert{Board,Column,Card}Access` (resolve the entity
  up to its team, then check membership — throw FORBIDDEN/NOT_FOUND), and
  `myTeamIds`. EVERY board/card/column/comment/relation/attachment procedure
  is gated; `board.list` and `search.global` are scoped to `myTeamIds`.
  When extending board/card features, add the matching access assertion.
- `rpc.team.*` (`src/server/orpc/teams.ts`): list (my teams, with
  member/board counts + `isOwner`), create (creator = owner), get/members
  (member-only), addMember (any member), removeMember (owner), leave
  (members; owner can't — must delete), rename/delete (owner). `delete`
  drops the team's chat rooms first (`deleteTeamRooms` — the team room + its
  cards' rooms; no FK on `owner_id`). Membership/board-set changes publish on
  the `team` realtime channel (see Realtime).
- UI is team-centric (Discord-shaped): a global `<TeamRail>` of team "bubbles"
  (far-left, in the `/home` shell) switches teams; selecting one opens its
  `<TeamPanel>` (second column) with that team's boards (+ inline "Add board"),
  Chat, Archive and a stubbed Games slot. `<TeamAvatar>` = square hash-colored
  initials (the team sibling of round `<UserAvatar>`). `TeamDialog` (gear in the
  panel header) manages members/rename/delete/leave; new teams are created from
  the rail's `+` or the home teams grid. `board.create` takes a `teamId`.
  Card assignee pickers + the assignee filter are scoped to the board's
  team via `<AssigneeCombobox teamId=…>` (uses `rpc.team.members`).
- Migration `1770000000006_teams` backfilled all pre-teams data into one
  default "Coglionazzi" team (every existing user a member, all boards
  assigned).

### Kanban boards

- Schema: `boards` (`team_id`) → `board_columns` (ordered by `position`) →
  `cards` (`tags text[]`, `description` = serialized Lexical JSON,
  `description_text` for search, float `position`) + `card_attachments`
  (card ↔ file), `card_assignees` (card ↔ user, many-to-many),
  `card_relations` (card ↔ card). Boards are team-scoped (see Teams above).
- `card_relations` carries a `kind`: `'related'` is undirected (rows
  normalized `card_id < related_card_id` so one row = both directions);
  `'blocks'` is directed (`card_id` blocks `related_card_id`). The API
  exposes three perspective kinds — `related`, `blocks`, `blocked_by` —
  and normalizes `blocked_by` to a stored inverse `blocks`. One relation
  per pair (addRelation clears the pair first). `board.get` resolves the
  per-card kind from each card's point of view.
- API: `rpc.board.*` in `src/server/orpc/boards.ts` — list/create/get,
  addColumn/renameColumn/moveColumn/deleteColumn,
  createCard/updateCard/moveCard/deleteCard, add/removeAttachment,
  add/removeRelation (all team-gated). `create` takes a `teamId`;
  `updateCard` takes optional `assigneeIds` (replaces the whole set,
  validated against the card's team membership). `deleteColumn` cleans up
  its cards' comments (no FK). `rpc.team.members` feeds the (team-scoped)
  assignee pickers. `board.get` returns the fully nested board (cards carry
  `assignees`, `relations`, `commentCount`, `attachments`); the UI
  invalidates that one query after any mutation.
- Ordering uses float positions: the client computes midpoint-of-neighbors
  and sends it to `moveCard`/`moveColumn` (omitted position = append at
  end). Drag & drop is @dnd-kit in `routes/home/teams/$teamId/board.$boardId.tsx`: a
  horizontal `SortableContext` of columns wraps per-column vertical
  `SortableContext`s of cards (one `DndContext`). Items carry
  `data.type: 'column' | 'card'`; `handleDragEnd` branches on it. Each
  column is `useSortable` (drag listeners only on the grip handle) which
  also makes it the droppable for cards (incl. empty columns). Optimistic
  `queryClient.setQueryData` (cards and columns) avoids snap-back;
  `onSettled` re-syncs. PointerSensor `activationConstraint.distance` keeps
  plain clicks opening the dialog. Column headers rename inline (click →
  input, Enter/blur saves) and have a hover delete.
- Card editing happens in `~/components/boards/CardDialog` (title, lexical
  description, assignees via `<AssigneeCombobox>`, related-cards manager
  with a kind select, tags via `<TagBadge>` hash-colored chips, attachments
  via the upload helpers, a `<MessageThread>` card discussion at the bottom —
  see Chat rooms & messages). Archiving a card KEEPS its room/messages; only
  `archive.purge` deletes them (`deleteCardRooms`).
- Navigation chrome: the global topbar carries the app **sections** (Home /
  Teams / Games / Demo) + `UserActions` (theme + logout). **Home** is the global
  chat only. The `<TeamRail>` (team bubbles) lives ONLY in the Teams section
  (`routes/home/teams/route.tsx`); the `<TeamPanel>` (second column) is added by
  `routes/home/teams/$teamId/route.tsx` and holds the global `<SearchBox>`
  (deliberately NOT in the topbar), the team's boards + spaces, and — when a
  board OR the archive is open — that view's filters.
- **Mobile / responsive** (breakpoint = Tailwind `md`, 768px). Everything must
  fit a ~390px viewport: a horizontal overflow anywhere triggers mobile
  Chrome's shrink-to-fit and zooms the WHOLE app out, so keep wide rows
  responsive. The topbar collapses below `md`: the section nav becomes a
  `DropdownMenu` hamburger (`SectionMenu` in `routes/home/route.tsx`), the Logo
  wordmark hides (`textClassName="hidden sm:inline"`), and `UserActions` goes
  compact (BrandPicker hidden, icon-only logout). The Teams `<TeamRail>` +
  `<TeamPanel>` are desktop sidebars (`max-md:hidden`) AND render inside a
  left **Sheet** drawer on mobile, opened from `TeamsMobileBar`
  (`routes/home/teams/route.tsx`, reads `teamId` via `useParams({strict:false})`).
  Both components take `variant="sidebar" | "drawer"` (drawer drops
  `max-md:hidden` and flexes to fill) + `onNavigate` (closes the drawer on a
  link tap). Add the same `variant`/`onNavigate` plumbing to any new rail/panel
  entry so it works in both layouts.
- Filtering is client-side over the already-loaded board/archive: pure
  functions in `~/lib/cardFilters.ts` (`cardMatchesFilters`, `isFilterActive`,
  `mergeFilters` = merge a patch + drop emptied keys) over the active route's
  search params (`q`, `tags`, `assignees`, `from`, `to`) — kept in the URL so
  filtered views are shareable. The filter UI is ONE shared component,
  `<CardFiltersPanel>` (`~/components/boards/`), rendered in the team panel for
  BOTH the board and archive views (same place, same stacked layout — unified);
  the panel owns the search-param wiring (`onPatch` targets the active route).
  Date
  range compares UTC calendar days (inclusive); the UI uses `<DatePicker>`
  (popover +
  shadcn `Calendar`/react-day-picker). `<AssigneeCombobox>` (popover +
  cmdk `Command`) is the searchable multi-select used for both card
  assignees and the assignee filter. `<UserAvatar>` renders hash-colored
  initials, reused on cards and in the pickers.

### Card archive

- Cards are soft-deleted into a per-team archive instead of being destroyed.
  `cards.archived_at` (null = live) marks a card archived; `cards.team_id`
  is DENORMALIZED onto the card (set in `createCard`) so the archive survives
  its column/board being deleted — that's why `assertCardAccess` resolves the
  team straight off `cards.team_id` (not the old column→board→team join).
  `cards.column_id` is nullable with `ON DELETE SET NULL` (was NOT NULL +
  CASCADE); `archived_origin` snapshots a `"Board / Column"` label for display
  once the origin is gone. Migration `1770000000007_card-archive`.
- Three things archive a card: `rpc.board.archiveCard` (manual; keeps
  `column_id` so it restores in place), and `deleteColumn` / `deleteBoard`
  (they set `archived_at`/`archived_origin` on the live cards, then the column
  delete's SET NULL detaches them). None of these delete the cards' comments
  anymore — only permanent purge does.
- `rpc.archive.*` (`src/server/orpc/archive.ts`, team-gated): `list({teamId})`
  (archived cards, fully nested, newest-first), `restore({cardId,
  destinationColumnId?})` (clears the archived fields; restores into the
  original column if `column_id` survives, else requires a destination in the
  same team), `purge({cardId})` (permanent delete of an archived card + its
  comments — the retained hard delete), `restoreTargets({teamId})` (every
  column of the team's boards, for the destination picker).
- Board/search reads exclude archived cards: `board.get`'s card query +
  relation resolution, `board.list`'s card count (conditional join), and both
  legs of `search.global` add `archived_at IS NULL`. `attachCardExtras` in
  `boards.ts` is the shared card-nesting helper (`liveRelationsOnly` toggles
  whether archived counterparts show in relations) used by `board.get` and
  `archive.list`.
- UI: the team panel has an "Archive" space →
  `routes/home/teams/$teamId/archive.tsx`, a list view (not columns) reusing
  `cardFilters` with the same URL search params as the board (its filters
  render in the panel, see Kanban). Rows open `<ArchivedCardDialog>`: read-only
  fields + an active comment thread, footer = Restore / Delete forever.

### Chat rooms & messages (the generic message model)

- ONE message model backs every thread — card discussions AND public chat.
  A `chat_rooms(kind, owner_id, …)` row is identified by the entity it
  belongs to: `'global'` (owner_id NULL — the single app-wide room, any
  logged-in user), `'team'` (owner_id = team.id, members), `'card'` (owner_id
  = card.id, card access). Add a kind (e.g. `game`, `dm`) + a branch in
  `roomAccess.ts`. NO FK on `owner_id` and no `team_id` column — access and
  cleanup are resolved per-kind, mirroring the old polymorphic `comments`
  (which this REPLACED — there is no comments table anymore).
- `src/server/orpc/roomAccess.ts`: `roomRefSchema` (the `{scope}` union),
  `assertRefAccess` (gate BEFORE create), `resolveRoom` (find-or-create —
  rooms are lazily made on first open), `assertRoomAccess(userId, roomId)`
  (the read/write gate for every by-roomId procedure). Cleanup is explicit:
  `deleteCardRooms` (archive.purge) and `deleteTeamRooms` (team.delete) drop
  rooms whose owner is gone (messages/reactions cascade off the room FK).
- `chat_messages(room_id, body jsonb, body_text, created_by, edited_at)` +
  `chat_message_reactions(message_id, user_id, emoji)` (PK all three →
  one of each emoji per user per message). `created_at` is set with
  `clock_timestamp()` (not `now()`) so message order = real insertion order
  even within a transaction. `body_text` is the search companion (see Search).
- API: `rpc.chat.*` (`src/server/orpc/chat.ts`): `open({ref})` → find-or-create
  + latest page; `history({roomId, before?, limit})` keyset pages back;
  `send`/`editMessage`/`deleteMessage` (author-only edit/delete); `react`
  (toggle); `subscribe({roomId})` Event Iterator. Card `commentCount` on
  `board.get` counts the card room's messages; `search.global` searches
  `card`-room messages (was comments).
- UI: `<MessageThread roomRef={…}>` (`components/custom/`) is the one thread
  component — used by card dialogs (`{scope:'card', cardId}`) and the Chat
  section. It composes the shared `<MessageComposer>` (⌘/Ctrl+Enter to send,
  NEVER bare Enter), `<MessageItem>` (body + reactions + author edit/delete),
  and `useChatRoom` (`lib/useChatRoom.ts`) which seeds from `chat.open`,
  streams live (see Realtime), and pages history. The global room is on the
  home page (`routes/home/index.tsx`); each team's room is the Chat space in
  its panel (`routes/home/teams/$teamId/chat.tsx`).
- Gotcha: jsonb columns come back from pg as parsed objects — serialize
  with `JSON.stringify` when returning editor states to the client (the
  editor's `initialState` wants the string).

### Search

- Global fuzzy search lives in `src/server/orpc/search.ts` (pg_trgm:
  `ILIKE` substring OR `word_similarity >= 0.45`, GIN trigram indexes).
  Lexical jsonb fields are NEVER searched directly — plain text is
  extracted at write time (`extractLexicalText`) into `*_text` companion
  columns (`cards.description_text`, `chat_messages.body_text`). New rich-text
  fields that should be searchable need the same companion column +
  trigram index + write-path extraction.
- UI: `<SearchBox />` lives in the team panel (`<TeamPanel>`); results carry a
  `teamId` and deep-link to the team-scoped board route, card/message hits via
  its `?card=` param.

### Games (Versus + the game framework)

- A small **game framework** (global, NOT team-scoped) under
  `src/server/orpc/game/` + `routes/home/games/`, designed for many games. Layers:
  a shared **deck** (reusable image set), a shared **session** (lobby lifecycle),
  and a per-game **module** (only `versus` today; future `rating`/`tierlist` add
  their own tables + module against the SAME deck/session/presence shell).
  `game_sessions.kind` discriminates the mechanic. Spec:
  `docs/superpowers/specs/2026-06-13-versus-game-design.md`.
- **Decks** (`game_decks` + `game_deck_cards` → `files`): `rpc.game.decks.*`
  (list/get/create/update/addCard/updateCard/removeCard/delete + **clone** +
  **stats**). Global content; **creator-only edit** (`assertDeckOwner`) — anyone
  else can `clone` a deck into their own editable copy. Edited in place
  (auto-save) in the deck editor; images use the upload helpers (optimized on
  upload — see File uploads). `stats({deckId})` aggregates per-card appearances /
  votes / wins / championships / win-rate across the deck's completed games
  (`/home/games/decks/$deckId/stats`).
- **Sessions** (`game_sessions` + frozen `game_session_players` roster):
  `rpc.game.sessions.*` — create({deckId,visibility,teamId?}), list (public
  lobbies only — private games are unlisted), get (full snapshot), subscribe.
  Access via `assertSessionAccess`: **public** → any logged-in user; **private**
  → unlisted / join-by-link (any logged-in user with the link), UNLESS an
  OPTIONAL `team_id` is set, in which case `assertTeamMember` (link works for that
  team only). No FK on `team_id` (mirrors chat rooms).
- **Versus** = single-elimination left/right bracket (`versus_matchups` +
  `versus_votes`). Host `start({sessionId,cardCount})` (power-of-2 ≤ deck size):
  freezes the present players as the roster, draws a RANDOM subset, seeds round 1,
  opens matchup #1. Players `vote({matchupId,choice})` (roster-only, current
  matchup, before the deadline; changeable). The bracket grows round-by-round
  (`left/right_card_id` are NOT NULL, so a round's matchups are created from the
  previous round's winners). Tie (incl. 0–0) → random.
- **The engine** (`server/realtime/versusEngine.ts`) is an in-memory state
  machine per active session (current matchup, live tallies, frozen roster size,
  a server-authoritative **timer**). A matchup opens at +60s; once **≥50% of the
  roster** has voted the deadline collapses to `min(open+60s, now+10s)`, and once
  **everyone** has voted it resolves instantly. On resolve a `resolved` event
  reveals the winner (clients zoom it) for ~2.5s before the next matchup opens
  (a following `state`). Votes are ALSO persisted (so `sessions.get` recomputes
  counts); the engine owns the DEADLINE (memory only). **Single instance** — a
  restart mid-game loses the live timer (cast votes survive), same constraint as
  presence. Timings (full / short / reveal) are `__setVersusTimings`-overridable
  for tests only.
- **Realtime** uses a session-keyed `gamePublisher` (like `chatPublisher`) +
  in-memory lobby presence (`gamePublisher.ts`). `sessions.subscribe` registers
  presence and streams `GameEvent`s; the client (`lib/useGameSession.ts`) seeds
  from `sessions.get` and applies them: high-frequency `votes` stream as deltas
  (live counts + deadline), low-frequency `state` (matchup opened/resolved/
  finished) is signal-and-refetch, `presence` is the live roster.
- UI: `/home/games` (topbar **Games** link) lists open lobbies + decks;
  `decks/$deckId` is the editor (+ Play → `<NewGameDialog>`); `$sessionId` is the
  play view (lobby → live matchup voting → champion + results). New game = new
  `*_` tables + a realtime engine + a `game.<kind>.*` module; reuse decks/sessions/
  presence.

### Realtime (WebSockets)

- **Transport:** in the browser EVERY oRPC call goes over ONE persistent
  WebSocket; SSR keeps the HTTP fetch link. `lib/rpcClient.tsx` branches on
  `typeof window`. The socket is partysocket's `ReconnectingWebSocket`
  (`lib/wsClient.ts`) — it implements the standard WebSocket interface oRPC's
  websocket `RPCLink` drives and owns reconnection/backoff/buffering; a drop
  looks like a normal `close` to oRPC (the ClientPeer is reusable, so
  TanStack Query `retry` re-issues calls over the new socket).
  `getRealtimeSocket()` is the singleton; `reconnectRealtimeSocket()` calls
  partysocket's `.reconnect()` on auth change (login/signup/logout) so the new
  upgrade re-resolves the cookie — same object the RPCLink holds. A server
  close with code `4401` (session expired) stops retries and redirects to
  login.
- **Server endpoint:** a native Nitro WS handler at `/api/rpc-ws`
  (`server/ws/rpcHandler.ts`), registered via the `nitro()` plugin's
  `handlers` + `features.websocket` in `vite.config.ts` (takes precedence
  over Start's catch-all). It uses oRPC's `@orpc/server/crossws`
  `experimental_RPCHandler` over the SAME `appRouter`.
- **Auth is resolved ONCE at the upgrade** (WS frames carry no cookies): the
  `upgrade` hook reads the better-auth cookie and pins
  `{ user, session, headers }` onto the connection context. Anonymous
  upgrades are ALLOWED (no cookie → no pinned user) so the socket still
  serves public procedures on logged-out pages; `authP` rejects protected
  calls per-request exactly as on HTTP. `authP`/`resolveSession`
  (`orpc/base.ts`) accept EITHER that `context.connection` (WS) OR
  per-request `reqHeaders` (HTTP/SSR). An authenticated connection runs a
  5-min interval that re-checks the session and closes the socket (code
  `4401` → client redirects to login) on logout/expiry. Because auth is
  pinned at upgrade, the client MUST `reconnectRealtimeSocket()` after
  login/logout. Caveat: WS activity can't slide the session forward (no
  `Set-Cookie`); normal HTTP navigation refreshes it.
- **Push = Event Iterators + `EventPublisher`** (`server/realtime/`).
  `publisher` is an in-process pub/sub on three SHARED channels (`board`,
  `presence`, `team`); payloads carry the entity id so subscription
  procedures filter the shared channel. Mutations call
  `publishBoard*`/`publishTeamChanged` after writing.
  **Signal-and-refetch**: `board.subscribe`/`team.subscribe` yield a
  contentless change signal; the client (`lib/useRealtime.ts` →
  `useBoardRealtime`/`useWorkspaceRealtime`) invalidates `board.get` /
  (`team.list`+`board.list`) and refetches. Subscriptions are team-gated like
  everything else; add a `publish*` call when adding a new board/card/team
  mutation.
- **`chat` = a SEPARATE room-keyed publisher** (`chatPublisher`, keyed by
  `roomId`, NOT a shared channel). Chat is high-frequency, so a message must
  only wake its OWN room's subscribers — a shared channel would wake every
  chat connection per message. `chat.subscribe({roomId})` streams the actual
  change (created message / edit / delete / reaction delta); the client
  (`useChatRoom`) applies it to the local list — **stream, not refetch**
  (reaction deltas carry the actor so each client recomputes `reactedByMe`).
  `useChatRoom` resubscribes + refetches the latest page on reconnect to fill
  gaps. Use a room-keyed publisher for any future high-frequency fan-out — the
  Versus game's `gamePublisher` (session-keyed) is the other one (see Games).
- **`team` channel = workspace/sidebar liveness** (board added/removed, member
  added/removed, rename, delete). `publishTeamChanged(teamId, affectedUserIds?)`:
  `affectedUserIds` lists members whose OWN membership changed, so a
  just-removed/deleted member is still notified (they no longer match by
  membership). `team.subscribe` filters by a per-connection membership `Set`
  resolved ONCE at subscribe; it only re-hits the DB when THIS user's
  membership changes (i.e. they're in `affectedUserIds`). So per-event work is
  bounded by the genuinely-affected users — NOT a `myTeamIds` query per
  connection per event. Keep that pattern (filter in-process; DB only for the
  directly-affected) for any new fan-out channel.
- **Presence** (`server/realtime/presence.ts` + `orpc/presence.ts`):
  `presence.subscribe` registers the caller as a viewer (deduped by user),
  yields the current roster immediately then on every join/leave, and
  deregisters in its `finally` (run when oRPC aborts the generator on socket
  close). `<PresenceStack>` renders the live avatar stack on the board.
- **Single instance** (see Deploy): the bus/presence registry live in one
  Node process. To scale horizontally, back `publisher` with Postgres
  LISTEN/NOTIFY — only `realtime/publisher.ts` changes. Traefik passes WS
  upgrades by default.
- Subscription procedures are generators (`async function*`) and don't run
  until iterated — drive `.next()` to start them (tests rely on this).

### Testing (vitest)

- `npm test` runs vitest per workspace. Tests hit a real Postgres: a
  dedicated `<dbname>_test` database is created + migrated by
  `test/global-setup.ts`; `src/server/db.ts` pins the pool to ONE
  connection under `NODE_ENV=test` and `test/db.ts` wraps every test in
  BEGIN/ROLLBACK — no cleanup needed, but test files run serially
  (`fileParallelism: false`), don't change that.
- Call oRPC procedures directly with `call(router.proc, input, { context })`
  from `@orpc/server`; `signUpTestUser()` (test/helpers.ts) creates a real
  better-auth user and returns a context whose `reqHeaders` satisfy `authP`.
  `lexicalState("text")` builds a minimal serialized editor state.
- Pure helpers get unit tests next to the source (`src/**/*.test.ts`);
  DB/procedure tests live in `test/`.

### Misc

- Path alias: `~/*` (and `@/*`) → `packages/app/src/*`.
- Server-only code goes under `src/server/` — never import it from
  components (only `routes/api/*` and other server files may).
- `src/routeTree.gen.ts` is generated by the Start plugin — never edit it.
- Env vars come from `packages/.env` (see `.env.example`). `VITE_`-prefixed
  ones are exposed to the client; secrets must NOT carry the prefix.
