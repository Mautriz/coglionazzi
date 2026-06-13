import { ORPCError } from "@orpc/server";
import { db } from "../../db";
import { assertTeamMember } from "../teamAccess";

/** Access control for the game framework.
 *  - Decks are global content; only their creator may edit/delete.
 *  - Sessions are public (any logged-in user) OR private to a team (members
 *    only) — see `assertSessionAccess`. */

/** Gate a session: public → any logged-in user; private → team members only.
 *  Returns the session row (handy for the caller). */
export async function assertSessionAccess(userId: string, sessionId: string) {
  const s = await db
    .selectFrom("game_sessions")
    .where("id", "=", sessionId)
    .select([
      "id",
      "deck_id",
      "kind",
      "host_id",
      "visibility",
      "team_id",
      "card_count",
      "status",
      "winner_card_id",
    ])
    .executeTakeFirst();
  if (!s) throw new ORPCError("NOT_FOUND", { message: "Game not found" });
  // public → anyone; private → unlisted/link-only (any logged-in user with the
  // link), UNLESS scoped to a team, in which case members only.
  if (s.visibility === "private" && s.team_id) {
    await assertTeamMember(userId, s.team_id);
  }
  return s;
}

export async function assertDeckOwner(userId: string, deckId: string) {
  const row = await db
    .selectFrom("game_decks")
    .where("id", "=", deckId)
    .select("created_by")
    .executeTakeFirst();
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Deck not found" });
  if (row.created_by !== userId) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only the deck's creator can edit it.",
    });
  }
}

export async function deckIdOfCard(cardId: string): Promise<string> {
  const row = await db
    .selectFrom("game_deck_cards")
    .where("id", "=", cardId)
    .select("deck_id")
    .executeTakeFirst();
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Card not found" });
  return row.deck_id;
}
