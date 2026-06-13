import { ORPCError } from "@orpc/server";
import { db } from "../db";

/** Team-membership access control. Boards are scoped to a team; a user may
 *  touch a board (and its columns/cards/comments/attachments/relations) only
 *  if they're a member of that board's team. These helpers resolve any
 *  entity id up to its team and assert membership, throwing FORBIDDEN
 *  (or NOT_FOUND when the entity is gone). */

export async function isTeamMember(
  userId: string,
  teamId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom("team_members")
    .where("team_id", "=", teamId)
    .where("user_id", "=", userId)
    .select("user_id")
    .executeTakeFirst();
  return !!row;
}

export async function assertTeamMember(
  userId: string,
  teamId: string,
): Promise<void> {
  if (!(await isTeamMember(userId, teamId))) {
    throw new ORPCError("FORBIDDEN", {
      message: "You are not a member of this team.",
    });
  }
}

export async function isTeamOwner(
  userId: string,
  teamId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom("team_members")
    .where("team_id", "=", teamId)
    .where("user_id", "=", userId)
    .where("role", "=", "owner")
    .select("user_id")
    .executeTakeFirst();
  return !!row;
}

export async function assertTeamOwner(
  userId: string,
  teamId: string,
): Promise<void> {
  if (!(await isTeamOwner(userId, teamId))) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only the team owner can do that.",
    });
  }
}

/** Team ids the user belongs to (for scoping list/search). */
export async function myTeamIds(userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("team_members")
    .where("user_id", "=", userId)
    .select("team_id")
    .execute();
  return rows.map((r) => r.team_id);
}

async function teamIdOfBoard(boardId: string): Promise<string> {
  const row = await db
    .selectFrom("boards")
    .where("id", "=", boardId)
    .select("team_id")
    .executeTakeFirst();
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Board not found" });
  return row.team_id;
}

async function teamIdOfColumn(columnId: string): Promise<string> {
  const row = await db
    .selectFrom("board_columns")
    .innerJoin("boards", "boards.id", "board_columns.board_id")
    .where("board_columns.id", "=", columnId)
    .select("boards.team_id")
    .executeTakeFirst();
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Column not found" });
  return row.team_id;
}

async function teamIdOfCard(cardId: string): Promise<string> {
  // `team_id` is denormalized onto the card so this resolves even for an
  // archived card whose column/board has been deleted (column_id is null).
  const row = await db
    .selectFrom("cards")
    .where("cards.id", "=", cardId)
    .select("cards.team_id")
    .executeTakeFirst();
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Card not found" });
  return row.team_id;
}

export async function assertBoardAccess(userId: string, boardId: string) {
  await assertTeamMember(userId, await teamIdOfBoard(boardId));
}

export async function assertColumnAccess(userId: string, columnId: string) {
  await assertTeamMember(userId, await teamIdOfColumn(columnId));
}

export async function assertCardAccess(userId: string, cardId: string) {
  await assertTeamMember(userId, await teamIdOfCard(cardId));
}
