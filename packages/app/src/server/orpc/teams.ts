import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { db } from "../db";
import { publishTeamChanged, publisher } from "../realtime/publisher";
import { authP } from "./base";
import {
  assertTeamMember,
  assertTeamOwner,
  isTeamMember,
  myTeamIds,
} from "./teamAccess";

/** Delete the comments belonging to every card in the given boards (comments
 *  are polymorphic, no FK — so a board/team cascade leaves them orphaned). */
async function deleteCommentsForBoards(boardIds: string[]) {
  if (boardIds.length === 0) return;
  const cards = await db
    .selectFrom("cards")
    .innerJoin("board_columns", "board_columns.id", "cards.column_id")
    .where("board_columns.board_id", "in", boardIds)
    .select("cards.id")
    .execute();
  if (cards.length === 0) return;
  await db
    .deleteFrom("comments")
    .where("entity_type", "=", "card")
    .where(
      "entity_id",
      "in",
      cards.map((c) => c.id),
    )
    .execute();
}

export const teamRouter = {
  /** Live workspace changes: yields whenever a team the caller belongs to
   *  changes its membership or board set (board added/removed, member
   *  added/removed, rename, delete). The client refetches `team.list` +
   *  `board.list`.
   *
   *  Performance: membership is resolved ONCE into a local set and events are
   *  filtered in-process (O(1) per event) — NOT a DB query per event. The DB
   *  is re-hit ONLY when THIS user's own membership changes (the rare,
   *  directly-affected case, signalled by `affectedUserIds`); the high-volume
   *  board-add/remove/rename traffic and every irrelevant event are filtered
   *  with a `Set.has`, and non-members never touch the DB at all. So the work
   *  per event is bounded by the genuinely-affected users, not the connection
   *  count. */
  subscribe: authP.handler(async function* (
    info,
  ): AsyncGenerator<{ teamId: string }> {
    const me = info.context.user.id;
    let mine = new Set(await myTeamIds(me));
    for await (const event of publisher.subscribe("team", {
      signal: info.signal,
    })) {
      if (event.affectedUserIds?.includes(me)) {
        // My own membership changed — refresh the set, then notify.
        mine = new Set(await myTeamIds(me));
        yield { teamId: event.teamId };
      } else if (mine.has(event.teamId)) {
        yield { teamId: event.teamId };
      }
    }
  }),

  /** Teams the caller belongs to, with board + member counts. */
  list: authP.handler(async (info) => {
    const teams = await db
      .selectFrom("teams")
      .innerJoin("team_members", "team_members.team_id", "teams.id")
      .where("team_members.user_id", "=", info.context.user.id)
      .select(["teams.id", "teams.name", "teams.created_by", "teams.created_at"])
      .orderBy("teams.created_at", "asc")
      .execute();

    if (teams.length === 0) return [];
    const teamIds = teams.map((t) => t.id);

    const memberCounts = await db
      .selectFrom("team_members")
      .where("team_id", "in", teamIds)
      .select(({ fn }) => ["team_id", fn.count<number>("user_id").as("count")])
      .groupBy("team_id")
      .execute();
    const boardCounts = await db
      .selectFrom("boards")
      .where("team_id", "in", teamIds)
      .select(({ fn }) => ["team_id", fn.count<number>("id").as("count")])
      .groupBy("team_id")
      .execute();

    return teams.map((t) => ({
      ...t,
      isOwner: t.created_by === info.context.user.id,
      memberCount: Number(
        memberCounts.find((m) => m.team_id === t.id)?.count ?? 0,
      ),
      boardCount: Number(
        boardCounts.find((b) => b.team_id === t.id)?.count ?? 0,
      ),
    }));
  }),

  create: authP
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .handler(async (info) => {
      const team = await db
        .insertInto("teams")
        .values({ name: info.input.name, created_by: info.context.user.id })
        .returning("id")
        .executeTakeFirstOrThrow();

      await db
        .insertInto("team_members")
        .values({
          team_id: team.id,
          user_id: info.context.user.id,
          role: "owner",
        })
        .execute();

      publishTeamChanged(team.id, [info.context.user.id]);
      return team;
    }),

  /** Members of a team (member-only). Feeds the assignee pickers. */
  members: authP
    .input(z.object({ teamId: z.uuid() }))
    .handler(async (info) => {
      await assertTeamMember(info.context.user.id, info.input.teamId);
      return db
        .selectFrom("team_members")
        .innerJoin("users", "users.id", "team_members.user_id")
        .where("team_members.team_id", "=", info.input.teamId)
        .select(["users.id", "users.name", "team_members.role"])
        .orderBy("users.name", "asc")
        .execute();
    }),

  /** Any member can add another user to the team. */
  addMember: authP
    .input(z.object({ teamId: z.uuid(), userId: z.string() }))
    .handler(async (info) => {
      await assertTeamMember(info.context.user.id, info.input.teamId);
      await db
        .insertInto("team_members")
        .values({
          team_id: info.input.teamId,
          user_id: info.input.userId,
          role: "member",
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      publishTeamChanged(info.input.teamId, [info.input.userId]);
    }),

  /** Owner removes someone else (not themselves — owner uses delete). */
  removeMember: authP
    .input(z.object({ teamId: z.uuid(), userId: z.string() }))
    .handler(async (info) => {
      await assertTeamOwner(info.context.user.id, info.input.teamId);
      if (info.input.userId === info.context.user.id) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The owner can't remove themselves — delete the team instead.",
        });
      }
      await db
        .deleteFrom("team_members")
        .where("team_id", "=", info.input.teamId)
        .where("user_id", "=", info.input.userId)
        .execute();
      publishTeamChanged(info.input.teamId, [info.input.userId]);
    }),

  /** Leave a team. The owner can't leave (must delete the team). */
  leave: authP
    .input(z.object({ teamId: z.uuid() }))
    .handler(async (info) => {
      if (!(await isTeamMember(info.context.user.id, info.input.teamId))) {
        throw new ORPCError("NOT_FOUND", { message: "Not a member." });
      }
      const team = await db
        .selectFrom("teams")
        .where("id", "=", info.input.teamId)
        .select("created_by")
        .executeTakeFirst();
      if (team?.created_by === info.context.user.id) {
        throw new ORPCError("BAD_REQUEST", {
          message: "The owner can't leave — delete the team instead.",
        });
      }
      await db
        .deleteFrom("team_members")
        .where("team_id", "=", info.input.teamId)
        .where("user_id", "=", info.context.user.id)
        .execute();
      publishTeamChanged(info.input.teamId, [info.context.user.id]);
    }),

  rename: authP
    .input(
      z.object({ teamId: z.uuid(), name: z.string().trim().min(1).max(80) }),
    )
    .handler(async (info) => {
      await assertTeamOwner(info.context.user.id, info.input.teamId);
      await db
        .updateTable("teams")
        .set({ name: info.input.name })
        .where("id", "=", info.input.teamId)
        .execute();
      publishTeamChanged(info.input.teamId);
    }),

  /** Owner-only. Cascades boards/columns/cards via FK; cleans up the
   *  cards' polymorphic comments first (no FK). */
  delete: authP
    .input(z.object({ teamId: z.uuid() }))
    .handler(async (info) => {
      await assertTeamOwner(info.context.user.id, info.input.teamId);
      const boards = await db
        .selectFrom("boards")
        .where("team_id", "=", info.input.teamId)
        .select("id")
        .execute();
      // Capture members before the cascade so every ex-member is notified the
      // team is gone (they won't match by membership anymore).
      const members = await db
        .selectFrom("team_members")
        .where("team_id", "=", info.input.teamId)
        .select("user_id")
        .execute();
      await deleteCommentsForBoards(boards.map((b) => b.id));
      await db
        .deleteFrom("teams")
        .where("id", "=", info.input.teamId)
        .execute();
      publishTeamChanged(
        info.input.teamId,
        members.map((m) => m.user_id),
      );
    }),
};
