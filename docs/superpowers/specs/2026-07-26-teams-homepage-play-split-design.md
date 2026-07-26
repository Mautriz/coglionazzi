# Teams as the homepage, everything else under /play

**Date:** 2026-07-26
**Status:** approved

## Why

The app is becoming a teams app. Boards, team chat, archive and support are the
bulk of it; the global chat, the Versus game and the component playground are
secondary — things to test and mess about with. The information architecture
should say that: Teams is what you land on, the rest lives on its own URL and
you reach it by typing that URL.

## Routing

### Teams is the landing page

`/home` becomes a redirect to `/home/teams`, which already resolves to your
first team (or renders the "you're not in any team yet" empty state).

**Nothing under `routes/home/teams/` is renamed.** Every `/home/teams/...`
path, the `<SearchBox>` deep-links and the board / chat / archive / support
routes stay exactly as they are. Post-auth redirects already target `/home`, so
login, sign-up and the Discord callback all land on Teams with no change.

### /play is the secondary area

| from                          | to                       |
| ----------------------------- | ------------------------ |
| `routes/home/index.tsx`       | `routes/play/index.tsx`  |
| `routes/home/demo.tsx`        | `routes/play/demo.tsx`   |
| `routes/home/games/**`        | `routes/play/games/**`   |

A new `routes/play/route.tsx` mirrors the `/home` shell: same auth guard, same
topbar. It **keeps** the section nav (Chat / Games / Demo) and its mobile
hamburger — there is no other entry point into `/play`, so that nav is the only
way to move around inside it.

`/play` itself is the global chat, unchanged from today's `/home`.

There is deliberately **no UI link into `/play`** from Teams. It is reached by
URL. The Logo in the `/play` topbar points at `/home`, which is the way back.

## Chrome

- The Teams shell (`routes/home/route.tsx`) drops `NAV` and `SectionMenu`
  entirely. Its topbar is Logo + connected-users count + user actions, nothing
  else — the section nav was the thing competing with the app for header room.
- The header markup moves to `components/custom/AppTopbar.tsx` with an optional
  `nav` prop, shared by both shells rather than duplicated (Teams passes no
  nav; Play passes its three items). The mobile rules — hamburger below `md`,
  wordmark hidden below `sm`, compact `UserActions` — live there once.
- `<TeamRail>` loses its top Home bubble and the divider under it. That bubble
  linked to `/home` = the global chat; now `/home` resolves back into the team
  you are already in, so it would be a no-op. The rail becomes team bubbles
  plus the "+".

## Rename: Coglionazzi → Insacco

**Renamed:** the page title, the `<Logo>` wordmark, the favicon `aria-label`,
the root `package.json` name, `deploy/compose.yml`'s container name / Traefik
router + service labels / network name, the placeholder domain in
`deploy/.env.example`, incidental comments in `server/support.ts`,
`styles/app.css` and `migrations/1770000000010_support.ts`, and CLAUDE.md.

**Not renamed — every database and volume identifier.** `POSTGRES_USER`,
`POSTGRES_DB`, `DATABASE_URL`, the `coglionazzi-pg-data` and
`coglionazzi-uploads` volumes, the dev `docker-compose.yml` database and
volume, and the derived `coglionazzi_test` database all keep the old name.

The reason is prod: the deployed stack's Postgres was initialised with that
role and database inside that named volume. `initdb` only runs on an empty data
directory, so renaming `POSTGRES_USER`/`POSTGRES_DB` in place makes the app
boot against a role and database that do not exist, and renaming the volumes
orphans the real data behind a fresh empty one. Applying the same rule to dev
keeps it a single sentence to remember and means nobody has to edit their local
gitignored `packages/.env`. A note in CLAUDE.md records why the names don't
match the app.

**Deliberately untouched:**

- `migrations/1770000000006_teams.ts` — already applied; editing it would only
  change fresh databases while diverging from every existing one.
- The team row literally named "Coglionazzi" created by that backfill. It is
  user data and renameable from the team gear dialog.

## Verification

`npm run type-check` is the real safety net: the TanStack Start plugin
regenerates `routeTree.gen.ts` and every `<Link to>` / `redirect({to})` is typed
against it, so a stale path fails the build rather than 404ing at runtime. Then
`npm test` (server-side; untouched by this change), then a manual pass over
`/home` → team, `/play`, `/play/games`, `/play/demo`, and a mobile-width check
of the Teams topbar now that the hamburger is gone.

## Out of scope

- Any UI entry point into `/play`.
- Renaming the `/home/teams/*` URLs to something shorter.
- Changing the public domain (`APP_HOST` is `localhost`; the `.com` in
  `.env.example` was only ever an illustrative placeholder).
