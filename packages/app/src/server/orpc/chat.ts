import { ORPCError } from "@orpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db";
import { extractLexicalText } from "../lexicalText";
import {
  chatPublisher,
  publishChat,
  type ChatEvent,
  type ChatMessagePayload,
} from "../realtime/publisher";
import { authP } from "./base";
import {
  assertRefAccess,
  assertRoomAccess,
  resolveRoom,
  roomRefSchema,
} from "./roomAccess";

const toIso = (v: unknown) => new Date(v as string | number | Date).toISOString();

type MessageRow = {
  id: string;
  room_id: string;
  body: unknown;
  created_by: string | null;
  created_at: unknown;
  edited_at: unknown;
  author: string | null;
};

/** Attach aggregated reactions to a page of message rows and serialize them
 *  into the client shape (body as a string for the editor; `reactedByMe`
 *  resolved for the viewer). */
async function shapeMessages(
  rows: MessageRow[],
  viewerId: string,
): Promise<ChatMessagePayload[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const reactions = await db
    .selectFrom("chat_message_reactions")
    .where("message_id", "in", ids)
    .select(({ fn }) => [
      "message_id",
      "emoji",
      fn.count<number>("user_id").as("count"),
      sql<boolean>`bool_or(user_id = ${viewerId})`.as("mine"),
    ])
    .groupBy(["message_id", "emoji"])
    .execute();

  return rows.map((r) => ({
    id: r.id,
    roomId: r.room_id,
    // jsonb comes back parsed; the editor wants the serialized string.
    body: JSON.stringify(r.body),
    author: r.author,
    createdBy: r.created_by,
    createdAt: toIso(r.created_at),
    editedAt: r.edited_at ? toIso(r.edited_at) : null,
    reactions: reactions
      .filter((x) => x.message_id === r.id)
      .map((x) => ({
        emoji: x.emoji,
        count: Number(x.count),
        reactedByMe: Boolean(x.mine),
      })),
  }));
}

/** A page of messages for a room, oldest-first (chronological). `before` is a
 *  keyset cursor (the oldest message currently loaded) — pass it to page back
 *  through history. */
async function loadHistory(
  roomId: string,
  viewerId: string,
  before: { createdAt: string; id: string } | undefined,
  limit: number,
): Promise<ChatMessagePayload[]> {
  let q = db
    .selectFrom("chat_messages")
    .leftJoin("users", "users.id", "chat_messages.created_by")
    .where("chat_messages.room_id", "=", roomId)
    .select([
      "chat_messages.id",
      "chat_messages.room_id",
      "chat_messages.body",
      "chat_messages.created_by",
      "chat_messages.created_at",
      "chat_messages.edited_at",
      "users.name as author",
    ]);

  if (before) {
    const cursor = new Date(before.createdAt);
    q = q.where((eb) =>
      eb.or([
        eb("chat_messages.created_at", "<", cursor),
        eb.and([
          eb("chat_messages.created_at", "=", cursor),
          eb("chat_messages.id", "<", before.id),
        ]),
      ]),
    );
  }

  const rows = await q
    .orderBy("chat_messages.created_at", "desc")
    .orderBy("chat_messages.id", "desc")
    .limit(limit)
    .execute();
  rows.reverse();
  return shapeMessages(rows as MessageRow[], viewerId);
}

/** Load a message's room + author for the author-only / access checks. */
async function loadMessageMeta(messageId: string) {
  const msg = await db
    .selectFrom("chat_messages")
    .where("id", "=", messageId)
    .select(["room_id", "created_by"])
    .executeTakeFirst();
  if (!msg) throw new ORPCError("NOT_FOUND", { message: "Message not found" });
  return msg;
}

const PAGE = z.number().int().min(1).max(100).default(30);

export const chatRouter = {
  /** Find-or-create the room for a ref and return the latest page. The client
   *  then drives `history`/`send`/`subscribe` by `roomId`. */
  open: authP
    .input(z.object({ ref: roomRefSchema, limit: PAGE }))
    .handler(async (info) => {
      await assertRefAccess(info.context.user.id, info.input.ref);
      const room = await resolveRoom(info.input.ref);
      const messages = await loadHistory(
        room.id,
        info.context.user.id,
        undefined,
        info.input.limit,
      );
      return { roomId: room.id, kind: room.kind, messages };
    }),

  /** Page back through a room's history (older than the `before` cursor). */
  history: authP
    .input(
      z.object({
        roomId: z.uuid(),
        before: z
          .object({ createdAt: z.string(), id: z.uuid() })
          .optional(),
        limit: PAGE,
      }),
    )
    .handler(async (info) => {
      await assertRoomAccess(info.context.user.id, info.input.roomId);
      return loadHistory(
        info.input.roomId,
        info.context.user.id,
        info.input.before,
        info.input.limit,
      );
    }),

  send: authP
    .input(
      z.object({
        roomId: z.uuid(),
        /** Serialized Lexical editor state. */
        body: z.string().min(1),
      }),
    )
    .handler(async (info) => {
      await assertRoomAccess(info.context.user.id, info.input.roomId);
      const row = await db
        .insertInto("chat_messages")
        .values({
          room_id: info.input.roomId,
          body: info.input.body,
          body_text: extractLexicalText(info.input.body),
          created_by: info.context.user.id,
          // clock_timestamp() (not now()) so messages sent within one
          // transaction still order by real insertion time — message order is
          // load-bearing for chat, and the tests run in a single transaction.
          created_at: sql`clock_timestamp()`,
        })
        .returning(["id", "created_at"])
        .executeTakeFirstOrThrow();

      const message: ChatMessagePayload = {
        id: row.id,
        roomId: info.input.roomId,
        body: info.input.body,
        author: info.context.user.name ?? null,
        createdBy: info.context.user.id,
        createdAt: toIso(row.created_at),
        editedAt: null,
        reactions: [],
      };
      publishChat(info.input.roomId, { type: "created", message });
      return message;
    }),

  /** Authors can edit their own message (sets an `edited_at` marker). */
  editMessage: authP
    .input(z.object({ messageId: z.uuid(), body: z.string().min(1) }))
    .handler(async (info) => {
      const msg = await loadMessageMeta(info.input.messageId);
      await assertRoomAccess(info.context.user.id, msg.room_id);
      if (msg.created_by !== info.context.user.id) {
        throw new ORPCError("FORBIDDEN", {
          message: "You can only edit your own messages.",
        });
      }
      const row = await db
        .updateTable("chat_messages")
        .set({
          body: info.input.body,
          body_text: extractLexicalText(info.input.body),
          edited_at: sql`now()`,
        })
        .where("id", "=", info.input.messageId)
        .returning("edited_at")
        .executeTakeFirstOrThrow();
      publishChat(msg.room_id, {
        type: "updated",
        messageId: info.input.messageId,
        body: info.input.body,
        editedAt: toIso(row.edited_at),
      });
    }),

  /** Authors can delete their own message (cascades its reactions). */
  deleteMessage: authP
    .input(z.object({ messageId: z.uuid() }))
    .handler(async (info) => {
      const msg = await loadMessageMeta(info.input.messageId);
      await assertRoomAccess(info.context.user.id, msg.room_id);
      if (msg.created_by !== info.context.user.id) {
        throw new ORPCError("FORBIDDEN", {
          message: "You can only delete your own messages.",
        });
      }
      await db
        .deleteFrom("chat_messages")
        .where("id", "=", info.input.messageId)
        .execute();
      publishChat(msg.room_id, {
        type: "deleted",
        messageId: info.input.messageId,
      });
    }),

  /** Toggle the caller's reaction on a message. Returns whether it's now on. */
  react: authP
    .input(
      z.object({ messageId: z.uuid(), emoji: z.string().min(1).max(16) }),
    )
    .handler(async (info) => {
      const msg = await loadMessageMeta(info.input.messageId);
      await assertRoomAccess(info.context.user.id, msg.room_id);
      const userId = info.context.user.id;

      const existing = await db
        .selectFrom("chat_message_reactions")
        .where("message_id", "=", info.input.messageId)
        .where("user_id", "=", userId)
        .where("emoji", "=", info.input.emoji)
        .select("emoji")
        .executeTakeFirst();

      let added: boolean;
      if (existing) {
        await db
          .deleteFrom("chat_message_reactions")
          .where("message_id", "=", info.input.messageId)
          .where("user_id", "=", userId)
          .where("emoji", "=", info.input.emoji)
          .execute();
        added = false;
      } else {
        await db
          .insertInto("chat_message_reactions")
          .values({
            message_id: info.input.messageId,
            user_id: userId,
            emoji: info.input.emoji,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
        added = true;
      }

      publishChat(msg.room_id, {
        type: "reaction",
        messageId: info.input.messageId,
        emoji: info.input.emoji,
        userId,
        added,
      });
      return { added };
    }),

  /** Live message stream for a room (append/patch/remove against the local
   *  list). Access-gated like everything else. */
  subscribe: authP
    .input(z.object({ roomId: z.uuid() }))
    .handler(async function* (info): AsyncGenerator<ChatEvent> {
      await assertRoomAccess(info.context.user.id, info.input.roomId);
      // Room-keyed channel: only this room's messages arrive here — no shared
      // fan-out to every chat connection.
      for await (const event of chatPublisher.subscribe(info.input.roomId, {
        signal: info.signal,
      })) {
        yield event;
      }
    }),
};
