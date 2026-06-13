# coglionazzi.com

A just-for-fun app for a Discord friend group: games, puzzles, rankings —
whatever we feel like building. Tone is playful; quality bar is real
(modelled on the `../propanalyst` codebase, which is the reference for all
patterns used here).

## Stack

| Concern        | Choice                                                          |
| -------------- | --------------------------------------------------------------- |
| FE/BE framework| TanStack Start (Vite plugin, file-based routes, SSR)             |
| API layer      | oRPC (`@orpc/server` + `@orpc/client` + `@orpc/tanstack-query`) |
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
docker-compose.yml      # local Postgres on port 5460
packages/
├── .env                # shared env, gitignored (.env.example is the template)
└── app/
    ├── .config/kysely.config.ts   # kysely-ctl config (migrations)
    ├── migrations/                # timestamped Kysely migrations
    ├── components.json            # shadcn config
    ├── vite.config.ts             # envDir ".." → reads packages/.env; port 3300
    └── src/
        ├── router.tsx             # QueryClient (toast on errors) + router
        ├── routes/
        │   ├── __root.tsx         # head, theme init script, session beforeLoad
        │   ├── index.tsx          # redirects to /home or /auth/login
        │   ├── auth/              # public: route.tsx layout + login + sign-up
        │   ├── home/              # protected: route.tsx guards on ctx.context.user
        │   └── api/
        │       ├── auth/$.ts      # better-auth handler (GET/POST)
        │       └── rpc/$.ts       # oRPC RPCHandler (ANY), prefix /api/rpc
        ├── server/                # server-only code
        │   ├── db.ts              # pg Pool + Kysely instance + dialect
        │   ├── dbtypes.ts         # DB types (regenerate: npm run genDbTypes)
        │   ├── auth.ts            # betterAuth() config + snake_case field maps
        │   └── orpc/
        │       ├── base.ts        # ORPCContext, `t`, `authP` middleware
        │       ├── router.ts      # appRouter — add feature routers here
        │       └── client.ts      # createAppClient → typed client + query utils
        ├── lib/
        │   ├── rpcClient.tsx      # RPCLink (SSR forwards request headers!)
        │   ├── authClient.tsx     # better-auth react client
        │   ├── theme.ts           # light/dark via class on <html>, localStorage
        │   └── classUtils.tsx     # cn()
        ├── components/
        │   ├── ui/                # shadcn components (add via shadcn CLI)
        │   └── custom/            # AppForm, Logo, app-specific components
        └── styles/app.css         # the ONLY Tailwind/theme config (v4 CSS-first)
```

## Commands

Run from repo root:

- `npm run dev` — dev server at http://localhost:3300 (Postgres must be up: `docker compose up -d`)
- `npm run build` / `npm run start` — production build / serve
- `npm run type-check` — tsc over the app
- `npm run migrate` / `npm run rollback` — Kysely migrations (uses packages/.env)
- `npm run genDbTypes` — regenerate `src/server/dbtypes.ts` from the live DB

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
- After login/signup/logout: `queryClient.removeQueries()` +
  `router.invalidate()` + navigate — otherwise the cached session sticks.
- Login uses `authClient.signIn.email` directly; signup goes through the
  oRPC `auth.signUp` procedure (which signs in by copying Set-Cookie onto
  the response via `resHeaders`).
- better-auth maps camelCase fields to snake_case columns in
  `src/server/auth.ts` — new auth-related tables must follow that pattern.

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
  `@theme` block of `src/styles/app.css`. Dark ("deep-sea electric cyan")
  is the default theme; `.light` overrides to the near-white ice-cyan
  palette. Both follow the PropFirmHub brand from propanalyst.
- Always use semantic tokens (`bg-card`, `text-muted-foreground`,
  `text-primary`, `border-border`…), never hardcoded colors, so both themes
  work.
- Primary filled surfaces (default Button variant) wear the `special`
  utility → brand gradient + readable label. Links use `text-link`.
- Theme switching: `toggleTheme()` / `useTheme()` from `~/lib/theme`
  (class on `<html>`, persisted to localStorage, init script in __root
  prevents flash).
- New shadcn components: `npx shadcn@latest add <name>` inside
  `packages/app` (components.json is configured; cn lives at
  `~/lib/classUtils`).

### Rich text (Lexical)

- Use `<RichTextEditor />` from `~/components/editor/RichTextEditor` for any
  formatted-text feature. It's uncontrolled: pass `onChange` to receive the
  serialized editor-state JSON (persist that string) and `initialState` to
  restore it. Demo on `/home`.
- Feature set is local-only (history, headings/quote/code, lists +
  checklists, links + autolink, markdown shortcuts, alignment/indent, hr).
  New toolbar actions go in `components/editor/ToolbarPlugin.tsx`; new nodes
  must be registered in the `nodes` array AND themed (theme object in
  RichTextEditor + classes in `styles/editor.css`).

### Images / file uploads

- Upload via `rpc.image.upload` (`{ file: File }`, auth required, ≤5MB,
  image mime types only) → returns `{ id, path, url }`. List the caller's
  images with `rpc.image.mine`. `<ImageUploads />` is the reference UI.
- Files live on disk at `IMAGES_PATH` (default `packages/app/data/images`,
  gitignored) and are served by `GET /api/files?fileId=…` with long cache.
  The `images` table records path + metadata + uploader.

### Misc

- Path alias: `~/*` (and `@/*`) → `packages/app/src/*`.
- Server-only code goes under `src/server/` — never import it from
  components (only `routes/api/*` and other server files may).
- `src/routeTree.gen.ts` is generated by the Start plugin — never edit it.
- Env vars come from `packages/.env` (see `.env.example`). `VITE_`-prefixed
  ones are exposed to the client; secrets must NOT carry the prefix.
