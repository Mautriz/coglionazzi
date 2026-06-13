import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { db } from "../db";
import { authP } from "./base";

/** Every commentable entity kind. Extend this enum (and clean up comments in
 *  the entity's delete procedure) when something new becomes commentable. */
export const commentEntityType = z.enum(["card"]);
export type CommentEntityType = z.infer<typeof commentEntityType>;

const entityRef = z.object({
  entityType: commentEntityType,
  entityId: z.uuid(),
});

export const commentRouter = {
  list: authP.input(entityRef).handler(async (info) => {
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
      return db
        .insertInto("comments")
        .values({
          entity_type: info.input.entityType,
          entity_id: info.input.entityId,
          body: info.input.body,
          created_by: info.context.user.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    }),

  /** Authors can delete their own comments. */
  delete: authP
    .input(z.object({ commentId: z.uuid() }))
    .handler(async (info) => {
      const result = await db
        .deleteFrom("comments")
        .where("id", "=", info.input.commentId)
        .where("created_by", "=", info.context.user.id)
        .executeTakeFirst();

      if (result.numDeletedRows === 0n) {
        throw new ORPCError("FORBIDDEN", {
          message: "You can only delete your own comments.",
        });
      }
    }),
};
