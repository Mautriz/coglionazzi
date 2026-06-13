# Connected-users count (global header + in-game) — design

## Goal

Two live "who's here" counts:

1. **Global** — number of connected users, shown in the top-right header on
   every protected (`/home/*`) page, at all times.
2. **In-game** — number of users connected to a specific game session,
   shown in the play view across **all** phases (lobby / live matchup /
   finished), not just the lobby.

Both are realtime: they update as people connect and disconnect, with no
refresh.

## Decisions

- **Counts unique logged-in users**, deduped by `userId` (3 tabs from one
  person = 1). Matches the existing board/lobby presence pattern. Anonymous
  sockets are not counted (the header only renders inside the authenticated
  `/home` shell anyway).
- **Display = number + pulsing green dot** (`● 5`). Hovering shows a tooltip
  listing who's online (names + avatars).
- **In-game = persistent session badge** showing the live connected count in
  every phase. Distinct from the existing `votedCount/rosterSize` vote tracker
  (that counts *votes cast*, this counts *people watching*).

## Architecture

### Global presence — new channel (mirrors board presence)

There is no app-wide presence today; presence is per-board
(`realtime/presence.ts`) and per-session (`realtime/gamePublisher.ts`). We add
a third registry of the same shape.

**`src/server/realtime/globalPresence.ts`** (new) — in-memory `Map<symbol,
PresenceViewer>` (reuse the existing `PresenceViewer` type from
`publisher.ts`: `{ userId, name, image }`).

- `globalPresenceSnapshot(): PresenceViewer[]` — dedupe by `userId`, return the
  roster.
- `joinGlobalPresence(viewer): () => void` — add a `Symbol` token, publish the
  new snapshot, return a `leave()` that deletes the token and re-publishes.
  Identical lifecycle to `joinPresence`/`joinGamePresence`.

**`src/server/realtime/publisher.ts`** — add one channel to `RealtimeEvents`:

```ts
globalPresence: { viewers: PresenceViewer[] };
```

(We stream the full roster, not just a count — it's trivial at this scale and
powers the tooltip. The client derives the number with `.length`.)

**`src/server/orpc/globalPresence.ts`** (new router) —
`subscribe: authP.handler(async function* (info) { ... })`:

1. `joinGlobalPresence({ userId, name, image })` from `info.context.user`.
2. `yield globalPresenceSnapshot()` immediately.
3. `for await (event of publisher.subscribe("globalPresence", { signal:
   info.signal })) yield event.viewers`.
4. `finally { leave() }` — deregisters when oRPC aborts the generator on
   socket close (same teardown path as board/game presence).

No input, no access check beyond `authP` (any logged-in user sees the global
count). Register as `globalPresence` in `src/server/orpc/router.ts`.

### In-game count — UI only, no server change

`game.sessions.subscribe` **already** calls `joinGamePresence()` for the whole
lifetime of the play view and streams `{ type: "presence", players }` events;
`useGameSession` already exposes `players`. The lobby renders `players.length`;
the live/finished views simply don't. So this is purely a client change:
surface `players.length` as a badge in those phases too.

## Client

### `src/components/custom/ConnectedUsersCount.tsx` (new)

```tsx
const live = useQuery(
  rpc.globalPresence.subscribe.experimental_liveOptions({ retry: true }),
);
const viewers = live.data ?? [];
```

Renders a pulsing green dot + `viewers.length`, wrapped in a shadcn `Tooltip`
whose content is the list of `viewers` (each an `<UserAvatar>` + name). Uses
semantic tokens only. While `live.data` is undefined (connecting) it can render
nothing or a dim `●` — no layout shift.

Placed in the header right cluster in `src/routes/home/route.tsx`, before
`<UserActions />`:

```tsx
<div className="flex items-center justify-end gap-1 sm:gap-2">
  <ConnectedUsersCount />
  <UserActions />
</div>
```

### In-game badge — `src/routes/home/games/$sessionId.tsx`

Lift the connected count so it's visible in every phase. A small
`● {players.length} watching` badge (reusing the green-dot motif for
consistency with the header) near the top of the play view, present in lobby,
live, and finished states. The lobby keeps its existing "In the lobby (N)" list
and avatar row; the live view keeps `votedCount/rosterSize`. `players` comes
from the `useGameSession` hook already in scope (fallback to
`session.players` when the live stream hasn't seeded yet, as the lobby already
does).

## Data flow

```
socket opens → globalPresence.subscribe generator starts
  → joinGlobalPresence() → publish("globalPresence", snapshot)
  → every other subscriber's generator yields the new roster
  → <ConnectedUsersCount> re-renders with new count + tooltip
socket closes → oRPC aborts generator → finally → leave()
  → publish updated (smaller) snapshot → all clients update
```

Game presence is the identical flow on the existing session-keyed
`gamePublisher`, already wired.

## Scale / cost (honest caveats)

- Snapshot is an O(N) dedupe over *currently-connected viewers*, computed only
  on join/leave. Trivial for a friend group (dozens).
- Fan-out: each join/leave wakes all current subscribers, so a burst of N
  simultaneous connects is ~O(N²) wakeups. Fine at this scale; if it ever grew
  to thousands, debounce/batch the publish. **YAGNI for now** — not built.
- Single-instance only, like all current presence/realtime (in-process
  registry). Horizontal scaling would need the same Postgres LISTEN/NOTIFY
  backplane already noted for `publisher`. Out of scope.

## Testing

- Unit (`src/server/realtime/globalPresence.test.ts`): join two viewers →
  snapshot has 2; same `userId` twice → snapshot dedupes to 1; `leave()`
  removes; snapshot empty after all leave.
- Procedure (`test/globalPresence.test.ts`): drive
  `globalPresence.subscribe.next()` for user A → first yield is a roster
  containing A; a second subscriber (user B) → A's generator yields a roster of
  2; abort B → A yields a roster of 1. (Generators don't run until iterated —
  drive `.next()`, per the existing test convention.)
- The in-game badge is UI-only over already-tested presence; no new server
  test needed there.

## Out of scope

- Anonymous / guest counts.
- Per-team or per-board "online" counts in the sidebar.
- Persisting presence / history.
- Debounced fan-out, multi-instance backplane.

## CLAUDE.md

Update the **Realtime → Presence** section: note the new app-wide
`globalPresence` channel/registry/router alongside the per-board and
per-session ones, and that `<ConnectedUsersCount>` renders the header count.
