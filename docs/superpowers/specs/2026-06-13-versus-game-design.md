# Versus game (community voting bracket) — design

A real-time multiplayer game for the friend group: a single-elimination
**Versus** bracket over a reusable **deck** of images. Players join a lobby,
the host picks a power-of-2 size, a random subset is drawn into a bracket, and
the lobby votes **left or right** one matchup at a time until one champion
remains. Votes and results are persisted.

This is the FIRST game on a small, reusable **game framework** — future games
(Rating 1–10, Tier List, …) slot into the same deck + lobby + presence shell.

## Layers

```
SHARED FRAMEWORK  (reused by every game)
  game_decks / game_deck_cards   reusable image set (image + title + desc)
  game_sessions                  lobby lifecycle: kind, host, visibility, status
  game_session_players           frozen roster (set at Start)
  per-session presence + a session-keyed gamePublisher (realtime)

GAME MODULE "versus"  (the only one built now)
  versus_matchups / versus_votes  the bracket mechanic + server timer
  versusEngine (in-memory state machine) + game.versus.* procedures

FUTURE  rating_* / tierlist_* modules — same shell, untouched deck/lobby code
```

A deck is **game-agnostic** (create a set of images once, run any game on it);
`game_sessions.kind` ('versus' | future) discriminates the mechanic.

## Data model (migration `…_games`)

- `game_decks` (id, name, description?, created_by, created_at)
- `game_deck_cards` (id, deck_id, **file_id** → `files`, title, description?,
  position) — deck needs ≥2 cards; no power-of-2 requirement on the pool.
- `game_sessions` (id, deck_id, **kind** default 'versus', host_id,
  **visibility** `public|private`, **team_id?** (set when private), card_count?,
  status `lobby|active|finished`, winner_card_id?, created/started/finished_at)
- `game_session_players` (session_id, user_id) — roster, frozen at Start;
  timer denominator + results.
- `versus_matchups` (id, session_id, round, position, left_card_id,
  right_card_id, winner_card_id?, left_votes, right_votes, status
  `pending|active|done`, resolved_at)
- `versus_votes` (matchup_id, user_id, choice `left|right`,
  PK(matchup_id,user_id)) — one vote/user/matchup, changeable until deadline.

`*_card_id` reference `game_deck_cards`. No FK on `game_sessions.team_id`
(mirrors chat rooms' owner_id).

## Live engine (in-process, single instance)

Mirrors presence/chat. An in-memory `versusEngine` per active session holds the
current matchup, live tallies, the frozen roster, and the
**server-authoritative timer**; a session-keyed `gamePublisher` (like
`chatPublisher`) streams events so only that session's subscribers wake.

- **Lobby = presence:** opening `/home/games/$sessionId` subscribes you → you
  appear as a present player live (in-memory registry keyed by sessionId).
- **Start (host only):** snapshot present players → frozen roster; draw a random
  power-of-2 subset; build the bracket (shuffle → pair 1v2,3v4,…); open
  matchup #1; status → active.
- **Per matchup:** opens with `deadline = openedAt + 60s`. The instant **≥50% of
  the roster** has voted, `deadline = min(openedAt+60s, now+10s)`; the new
  deadline is broadcast. Clients render the countdown from the broadcast
  timestamp (no client-side authority). **Live L/R counts** stream on every
  vote.
- **Resolve at deadline:** winner = more votes; **tie (incl. 0–0) → random**;
  persist matchup result + votes; open next matchup, else finish → champion
  (persist `winner_card_id`, status → finished). Every transition is broadcast.
- **Caveat:** a server restart mid-game loses the live timer (cast votes are
  already persisted) — acceptable for a single-instance fun app, same as
  presence today.

## API — `rpc.game.*` (`server/orpc/game/`)

- `game.decks.*`: list / get / create({name, description?, cards:[{fileId,
  title, description?}]}) / delete (creator-only).
- `game.sessions.*`: create({deckId, kind:'versus', visibility, teamId?}),
  list (public lobbies + private ones of teams I'm in), get, subscribe
  ({sessionId}) — presence + game stream.
- `game.versus.*`: start({sessionId, cardCount}) (host-only; validates
  power-of-2 ≤ deck size), vote({matchupId, choice}) (roster-only, current
  matchup, before deadline).
- Access gate `assertSessionAccess`: public → any logged-in user; private →
  `assertTeamMember(team_id)`. A private link 403s for non-members.

## UI

- Topbar gets a **"Games"** link (next to Demo) → `/home/games`. The team
  panel's "Games — soon" stub is **removed** (games are global).
- `/home/games` — open **lobbies** + your **decks** (new game / new deck).
- Deck editor (`/home/games/decks/$deckId`) — name/description + images via the
  existing `UploadButton`/`FilePreview`, each with title + description.
- Session (`/home/games/$sessionId`):
  - *Lobby:* present players, share link, host controls (card-count selector
    among valid powers of 2, visibility badge, **Start**).
  - *Active:* two big image cards (left/right) — click to vote, **live L/R
    counts**, voted/roster count, countdown, round/position + compact bracket
    trail.
  - *Finished:* champion reveal + final bracket/results.

## Defaults

- Host-only card-count + Start; host leaving the lobby before Start abandons the
  session (no host transfer yet).
- Late joiners to an active game spectate (subscribe) but can't vote (not in the
  frozen roster).
- Decks are global; only sessions carry the public/private switch.
- Card-count options = powers of 2 from 2 up to the largest ≤ the deck's size.

## Build phases

1. Migration + `game.decks` API + deck list/editor UI + topbar Games entry.
2. `game.sessions` + bracket seeding + `versusEngine`/timer + `gamePublisher`
   realtime + `game.versus` start/vote.
3. Play UI (lobby → matchup → champion) + results.
