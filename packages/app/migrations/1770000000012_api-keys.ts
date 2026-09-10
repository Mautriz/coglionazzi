import { sql, type Kysely } from "kysely";

// API keys for external (non-browser) access — chat bots and, above all,
// Claude Code over MCP (see src/routes/api/mcp.ts).
//
// A key acts as its creating USER across every team they belong to: there is
// no per-team binding and no read/write split, so the existing
// assertTeamMember / assert*Access gates apply to key callers unchanged.
//
// Only the SHA-256 of the token is stored. That is deliberate rather than a
// password hash: the token is 256 bits of randomness (not guessable), and this
// hash runs on every external request, so it must stay fast. `prefix` is a
// leading slice kept in clear purely so the UI can tell keys apart.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("api_keys")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    // `users.id` is TEXT (better-auth generates string ids), not a uuid.
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("key_hash", "text", (c) => c.notNull().unique())
    .addColumn("prefix", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("last_used_at", "timestamptz")
    .addColumn("revoked_at", "timestamptz")
    .execute();

  // Every external request looks a key up by hash.
  await db.schema
    .createIndex("api_keys_key_hash_idx")
    .on("api_keys")
    .column("key_hash")
    .execute();

  // Listing a user's own keys.
  await db.schema
    .createIndex("api_keys_user_idx")
    .on("api_keys")
    .column("user_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("api_keys").execute();
}
