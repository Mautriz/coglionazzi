import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { db } from "../db";
import { extractLexicalText } from "../lexicalText";
import {
  publishBoardOfCard,
  publishCommentChanged,
  publisher,
} from "../realtime/publisher";
import { authP } from "./base";
import { assertCardAccess } from "./teamAccess";

/** A comment thread changed: refresh the thread, and (for card threads) the
 *  board too, so the card's comment-count badge stays live. */
async function announceCommentChange(
  entityType: CommentEntityType,
  entityId: string,
) {
  publishCommentChanged(entityType, entityId);
  if (entityType === "card") await publishBoardOfCard(entityId);
}

/** Every commentable entity kind. Extend this enum (and clean up comments in
 *  the entity's delete procedure) when something new becomes commentable. */
export const commentEntityType = z.enum(["card"]);
export type CommentEntityType = z.infer<typeof commentEntityType>;

const entityRef = z.object({
  entityType: commentEntityType,
  entityId: z.uuid(),
});

/** Gate access to a comment thread by its host entity. Each commentable kind
 *  maps to its owner's access check — add a branch when extending the enum. */
async function assertEntityAccess(
  userId: string,
  entityType: CommentEntityType,
  entityId: string,
) {
  if (entityType === "card") {
    await assertCardAccess(userId, entityId);
  }
}

export const commentRouter = {
  /** Live comment thread: yields whenever this entity's comments change. The
   *  client refetches `comment.list` on each event (signal-and-refetch). */
  subscribe: authP
    .input(entityRef)
    .handler(async function* (
      info,
    ): AsyncGenerator<{ entityType: string; entityId: string }> {
      await assertEntityAccess(
        info.context.user.id,
        info.input.entityType,
        info.input.entityId,
      );
      for await (const event of publisher.subscribe("comment", {
        signal: info.signal,
      })) {
        if (
          event.entityType === info.input.entityType &&
          event.entityId === info.input.entityId
        ) {
          yield { entityType: event.entityType, entityId: event.entityId };
        }
      }
    }),

  list: authP.input(entityRef).handler(async (info) => {
    await assertEntityAccess(
      info.context.user.id,
      info.input.entityType,
      info.input.entityId,
    );
    return db
      .selectFrom("comments")
      .leftJoin("users", "users.id", "comments.created_by")
      .where("entity_type", "=", info.input.entityType)
      .where("entity_id", "=", info.input.entityId)
      .select([
        "comments.id",
        "comments.body",
        "comments.created_by",
        "comments.created_at",
        "users.name as author",
      ])
      .orderBy("comments.created_at", "asc")
      .execute()
      .then((rows) =>
        // jsonb comes back parsed; the editor wants the serialized string.
        rows.map((row) => ({ ...row, body: JSON.stringify(row.body) })),
      );
  }),

  add: authP
    .input(
      entityRef.extend({
        /** Serialized Lexical editor state. */
        body: z.string().min(1),
      }),
    )
    .handler(async (info) => {
      await assertEntityAccess(
        info.context.user.id,
        info.input.entityType,
        info.input.entityId,
      );
      const created = await db
        .insertInto("comments")
        .values({
          entity_type: info.input.entityType,
          entity_id: info.input.entityId,
          body: info.input.body,
          body_text: extractLexicalText(info.input.body),
          created_by: info.context.user.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await announceCommentChange(info.input.entityType, info.input.entityId);
      return created;
    }),

  /** Authors can delete their own comments. */
  delete: authP
    .input(z.object({ commentId: z.uuid() }))
    .handler(async (info) => {
      // Return the host thread (for the change announcement) while enforcing
      // author-only deletion.
      const deleted = await db
        .deleteFrom("comments")
        .where("id", "=", info.input.commentId)
        .where("created_by", "=", info.context.user.id)
        .returning(["entity_type", "entity_id"])
        .executeTakeFirst();

      if (!deleted) {
        throw new ORPCError("FORBIDDEN", {
          message: "You can only delete your own comments.",
        });
      }

      await announceCommentChange(
        deleted.entity_type as CommentEntityType,
        deleted.entity_id,
      );
    }),
};
