import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { generateApiKey } from "../apiKeys";
import { db } from "../db";
import { authP } from "./base";

/** Manage the caller's own API keys. A key acts as its creating user across
 *  all their teams, so minting one is exactly as powerful as logging in —
 *  every procedure here is scoped to `context.user.id` and never accepts a
 *  user id from the client. */
export const apiKeyRouter = {
  /** The caller's live keys, newest first. Never exposes the hash. */
  list: authP.handler(async (info) => {
    return db
      .selectFrom("api_keys")
      .where("user_id", "=", info.context.user.id)
      .where("revoked_at", "is", null)
      .select(["id", "name", "prefix", "created_at", "last_used_at"])
      .orderBy("created_at", "desc")
      .execute();
  }),

  /** Mint a key. `token` is returned HERE AND NOWHERE ELSE — only its hash is
   *  stored, so it cannot be recovered afterwards. */
  create: authP
    .input(z.object({ name: z.string().trim().min(1).max(100) }))
    .handler(async (info) => {
      const { token, hash, prefix } = generateApiKey();

      const row = await db
        .insertInto("api_keys")
        .values({
          user_id: info.context.user.id,
          name: info.input.name,
          key_hash: hash,
          prefix,
        })
        .returning(["id", "name", "prefix", "created_at"])
        .executeTakeFirstOrThrow();

      return { ...row, token };
    }),

  /** Revoke a key. Irreversible — the token can never be shown again anyway. */
  revoke: authP
    .input(z.object({ id: z.uuid() }))
    .handler(async (info) => {
      const result = await db
        .updateTable("api_keys")
        .set({ revoked_at: new Date() })
        .where("id", "=", info.input.id)
        // Scoping the UPDATE by owner means a stranger's revoke matches no
        // row rather than revoking someone else's key.
        .where("user_id", "=", info.context.user.id)
        .where("revoked_at", "is", null)
        .executeTakeFirst();

      if (Number(result.numUpdatedRows) === 0) {
        throw new ORPCError("NOT_FOUND", { message: "API key not found" });
      }
    }),
};
