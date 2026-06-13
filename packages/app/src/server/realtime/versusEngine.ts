import { ORPCError } from "@orpc/server";
import { sql } from "kysely";
import { db } from "../db";
import { publishGame } from "./gamePublisher";

/** The Versus bracket runs as an in-memory state machine per active session:
 *  the current matchup, live vote tallies, the frozen roster size, and a
 *  server-authoritative timer. Votes are also persisted (versus_votes) so
 *  `game.sessions.get` can recompute counts; the engine owns the DEADLINE
 *  (memory only). Single instance — a restart mid-game loses the live timer
 *  (cast votes survive); same constraint as board presence. */

let MATCH_FULL_MS = 60_000;
let MATCH_SHORT_MS = 10_000;
// How long the winner stays revealed (zoom) before the next matchup opens.
let REVEAL_MS = 2_500;

/** Test-only: shrink the timers so a bracket can be played in milliseconds.
 *  Never call this in app code. */
export function __setVersusTimings(
  fullMs: number,
  shortMs: number,
  revealMs = 2_500,
) {
  MATCH_FULL_MS = fullMs;
  MATCH_SHORT_MS = shortMs;
  REVEAL_MS = revealMs;
}

type Choice = "left" | "right";

interface MatchupState {
  matchupId: string;
  openedAt: number;
  deadline: number;
  shortened: boolean;
  votes: Map<string, Choice>; // userId → choice (changeable until deadline)
  timer: ReturnType<typeof setTimeout>;
}

interface EngineState {
  rosterSize: number;
  current: MatchupState | null;
}

const engines = new Map<string, EngineState>();

/** ISO deadline of the active matchup, for `game.sessions.get` (memory-only).
 *  Null when there's no live matchup (e.g. server restarted mid-game). */
export function liveDeadline(sessionId: string): string | null {
  const cur = engines.get(sessionId)?.current;
  return cur ? new Date(cur.deadline).toISOString() : null;
}

function tally(votes: Map<string, Choice>) {
  let left = 0;
  let right = 0;
  for (const c of votes.values()) if (c === "left") left++;
    else right++;
  return { left, right };
}

/** Begin a session (its round-1 matchups are already seeded): open matchup #1. */
export async function startVersus(sessionId: string, rosterSize: number) {
  engines.set(sessionId, { rosterSize, current: null });
  await openNextMatchup(sessionId);
}

async function openNextMatchup(sessionId: string) {
  const eng = engines.get(sessionId);
  if (!eng) return;

  const next = await db
    .selectFrom("versus_matchups")
    .where("session_id", "=", sessionId)
    .where("status", "=", "pending")
    .orderBy("round", "asc")
    .orderBy("position", "asc")
    .select("id")
    .executeTakeFirst();

  if (!next) {
    // Current round fully resolved — build the next round, or finish.
    await advanceRoundOrFinish(sessionId);
    return;
  }

  await db
    .updateTable("versus_matchups")
    .set({ status: "active" })
    .where("id", "=", next.id)
    .execute();

  const openedAt = Date.now();
  eng.current = {
    matchupId: next.id,
    openedAt,
    deadline: openedAt + MATCH_FULL_MS,
    shortened: false,
    votes: new Map(),
    timer: setTimeout(() => void resolveMatchup(sessionId), MATCH_FULL_MS),
  };

  // Structural change → clients refetch game.sessions.get (new matchup + cards).
  publishGame(sessionId, { type: "state" });
}

async function resolveMatchup(sessionId: string) {
  const eng = engines.get(sessionId);
  if (!eng?.current) return;
  const cur = eng.current;
  clearTimeout(cur.timer);
  eng.current = null;

  try {
    const { left, right } = tally(cur.votes);
    const m = await db
      .selectFrom("versus_matchups")
      .where("id", "=", cur.matchupId)
      .select(["left_card_id", "right_card_id"])
      .executeTakeFirst();
    if (!m) return;

    // More votes wins; a tie (incl. 0–0) is broken randomly.
    const winner =
      left > right
        ? m.left_card_id
        : right > left
          ? m.right_card_id
          : Math.random() < 0.5
            ? m.left_card_id
            : m.right_card_id;

    await db
      .updateTable("versus_matchups")
      .set({
        status: "done",
        winner_card_id: winner,
        left_votes: left,
        right_votes: right,
        resolved_at: sql`now()`,
      })
      .where("id", "=", cur.matchupId)
      .execute();

    // Reveal the winner, then open the next matchup after a beat so every
    // client can play the zoom animation in sync.
    publishGame(sessionId, {
      type: "resolved",
      matchupId: cur.matchupId,
      winnerCardId: winner,
      leftVotes: left,
      rightVotes: right,
    });
    setTimeout(() => void openNextMatchup(sessionId), REVEAL_MS);
  } catch (err) {
    console.error("versus: failed to resolve matchup", err);
  }
}

async function advanceRoundOrFinish(sessionId: string) {
  const maxRound = await db
    .selectFrom("versus_matchups")
    .where("session_id", "=", sessionId)
    .select((eb) => eb.fn.max("round").as("r"))
    .executeTakeFirst();
  const round = Number(maxRound?.r ?? 0);

  const winners = await db
    .selectFrom("versus_matchups")
    .where("session_id", "=", sessionId)
    .where("round", "=", round)
    .orderBy("position", "asc")
    .select("winner_card_id")
    .execute();
  const ids = winners
    .map((w) => w.winner_card_id)
    .filter((x): x is string => !!x);

  if (ids.length <= 1) {
    await finishSession(sessionId, ids[0] ?? null);
    return;
  }

  // Pair this round's winners into the next round, in order.
  const rows = [];
  for (let i = 0; i < ids.length; i += 2) {
    rows.push({
      session_id: sessionId,
      round: round + 1,
      position: i / 2,
      left_card_id: ids[i],
      right_card_id: ids[i + 1],
      status: "pending",
    });
  }
  await db.insertInto("versus_matchups").values(rows).execute();
  await openNextMatchup(sessionId);
}

async function finishSession(sessionId: string, winnerCardId: string | null) {
  await db
    .updateTable("game_sessions")
    .set({
      status: "finished",
      winner_card_id: winnerCardId,
      finished_at: sql`now()`,
    })
    .where("id", "=", sessionId)
    .execute();
  engines.delete(sessionId);
  publishGame(sessionId, { type: "state" });
}

/** Cast/change a vote on the current matchup. Persists + updates live tallies,
 *  shortens the timer once ≥50% of the roster has voted, and streams the new
 *  counts. Throws if voting is closed (wrong/old matchup or past the deadline).
 *  Roster membership is checked by the caller. */
export async function recordVote(
  sessionId: string,
  matchupId: string,
  userId: string,
  choice: Choice,
) {
  const eng = engines.get(sessionId);
  if (!eng?.current || eng.current.matchupId !== matchupId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Voting on this matchup is closed.",
    });
  }
  const cur = eng.current;
  if (Date.now() > cur.deadline) {
    throw new ORPCError("BAD_REQUEST", { message: "Time's up for this matchup." });
  }

  await db
    .insertInto("versus_votes")
    .values({ matchup_id: matchupId, user_id: userId, choice })
    .onConflict((oc) =>
      oc.columns(["matchup_id", "user_id"]).doUpdateSet({ choice }),
    )
    .execute();
  cur.votes.set(userId, choice);

  const votedCount = cur.votes.size;
  // Once ≥50% have voted, collapse to a 10s countdown (never past the 60s cap).
  if (!cur.shortened && eng.rosterSize > 0 && votedCount / eng.rosterSize >= 0.5) {
    cur.shortened = true;
    const newDeadline = Math.min(
      cur.openedAt + MATCH_FULL_MS,
      Date.now() + MATCH_SHORT_MS,
    );
    if (newDeadline < cur.deadline) {
      clearTimeout(cur.timer);
      cur.deadline = newDeadline;
      cur.timer = setTimeout(
        () => void resolveMatchup(sessionId),
        Math.max(0, newDeadline - Date.now()),
      );
    }
  }

  const { left, right } = tally(cur.votes);
  publishGame(sessionId, {
    type: "votes",
    matchupId,
    leftVotes: left,
    rightVotes: right,
    votedCount,
    rosterSize: eng.rosterSize,
    deadline: new Date(cur.deadline).toISOString(),
  });

  // Everyone has voted → resolve immediately, no need to wait out the timer.
  if (votedCount >= eng.rosterSize) {
    void resolveMatchup(sessionId);
  }
}
