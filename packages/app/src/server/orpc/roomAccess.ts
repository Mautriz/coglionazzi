import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { db } from "../db";
import { assertSessionAccess } from "./game/access";
import { assertCardAccess, assertTeamMember } from "./teamAccess";

/** A chat room is identified by the entity it belongs to. `global` is the
 *  single app-wide room; `team`/`card`/`game` point at a team/card/game-session
 *  by id. Add a variant (e.g. `dm`) here + a branch in the two switches below. */
export const roomRefSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global") }),
  z.object({ scope: z.literal("team"), teamId: z.uuid() }),
  z.object({ scope: z.literal("card"), cardId: z.uuid() }),
  z.object({ scope: z.literal("game"), sessionId: z.uuid() }),
]);
export type RoomRef = z.infer<typeof roomRefSchema>;

export interface RoomRow {
  id: string;
  kind: string;
  owner_id: string | null;
}

function refToKindOwner(ref: RoomRef): { kind: string; ownerId: string | null } {
  switch (ref.scope) {
    case "global":
      return { kind: "global", ownerId: null };
    case "team":
      return { kind: "team", ownerId: ref.teamId };
    case "card":
      return { kind: "card", ownerId: ref.cardId };
    case "game":
      return { kind: "game", ownerId: ref.sessionId };
  }
}

/** Assert the caller may use the room a ref points at — checked BEFORE the
 *  room is created so a non-member can't conjure a team/card room. `global`
 *  needs only a logged-in user (authP). */
export async function assertRefAccess(userId: string, ref: RoomRef) {
  switch (ref.scope) {
    case "global":
      return;
    case "team":
      return assertTeamMember(userId, ref.teamId);
    case "card":
      return assertCardAccess(userId, ref.cardId);
    case "game":
      await assertSessionAccess(userId, ref.sessionId);
      return;
  }
}

function whereOwner<T extends { where: (...a: any[]) => T }>(
  qb: T,
  ownerId: string | null,
): T {
  return ownerId === null
    ? qb.where("owner_id", "is", null)
    : qb.where("owner_id", "=", ownerId);
}

/** Find-or-create the room for a ref (caller must `assertRefAccess` first). */
export async function resolveRoom(ref: RoomRef): Promise<RoomRow> {
  const { kind, ownerId } = refToKindOwner(ref);
  const find = () =>
    whereOwner(db.selectFrom("chat_rooms").where("kind", "=", kind), ownerId)
      .select(["id", "kind", "owner_id"])
      .executeTakeFirst();

  const existing = await find();
  if (existing) return existing;

  const inserted = await db
    .insertInto("chat_rooms")
    .values({ kind, owner_id: ownerId })
    .onConflict((oc) => oc.doNothing())
    .returning(["id", "kind", "owner_id"])
    .executeTakeFirst();
  if (inserted) return inserted;

  // Lost a create race — the row is there now.
  const row = await find();
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Room not found" });
  return row;
}

/** Delete chat rooms by kind + owner(s) — the explicit cleanup for kinds whose
 *  `owner_id` has no FK (`card`/`team`/`game`), so a cascade off the owning
 *  table would orphan them. Messages/reactions cascade off the room FK. No-ops
 *  on an empty id list. */
export async function deleteRoomsByKindOwner(
  kind: string,
  owners: string | readonly string[],
): Promise<void> {
  const ids = typeof owners === "string" ? [owners] : owners;
  if (ids.length === 0) return;
  await db
    .deleteFrom("chat_rooms")
    .where("kind", "=", kind)
    .where("owner_id", "in", ids)
    .execute();
}

async function getRoom(roomId: string): Promise<RoomRow> {
  const room = await db
    .selectFrom("chat_rooms")
    .where("id", "=", roomId)
    .select(["id", "kind", "owner_id"])
    .executeTakeFirst();
  if (!room) throw new ORPCError("NOT_FOUND", { message: "Room not found" });
  return room;
}

/** Resolve a room by id and assert the caller may access it (the read/write
 *  gate for every by-roomId procedure). Returns the room. */
export async function assertRoomAccess(
  userId: string,
  roomId: string,
): Promise<RoomRow> {
  const room = await getRoom(roomId);
  switch (room.kind) {
    case "global":
      break;
    case "team":
      await assertTeamMember(userId, room.owner_id!);
      break;
    case "card":
      await assertCardAccess(userId, room.owner_id!);
      break;
    case "game":
      await assertSessionAccess(userId, room.owner_id!);
      break;
    default:
      throw new ORPCError("FORBIDDEN", { message: "Unknown room kind" });
  }
  return room;
}
