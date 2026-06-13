import { sql, type Kysely } from "kysely";

// Chat rooms: the generic message container. A room is identified by
// (kind, owner_id) — the entity it belongs to:
//   - 'global' : owner_id NULL, the single app-wide public room (any user)
//   - 'team'   : owner_id = team.id, the team's public room (members)
//   - 'card'   : owner_id = card.id, a card's discussion thread (card access)
// (future: 'game', 'dm'). No team_id column and no FK on owner_id — access and
// cleanup are resolved per-kind in roomAccess, exactly like the old polymorphic
// `comments` table. This migration REPLACES `comments` (card threads are now
// 'card' rooms); the project has no data yet, so there's nothing to migrate.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("chat_rooms")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("owner_id", "uuid")
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // One room per (kind, owner) for entity-bound rooms…
  await sql`create unique index chat_rooms_owner_uniq on chat_rooms (kind, owner_id) where owner_id is not null;`.execute(
    db,
  );
  // …and exactly one global room (owner_id is NULL, which the index above
  // can't dedupe).
  await sql`create unique index chat_rooms_global_uniq on chat_rooms (kind) where kind = 'global';`.execute(
    db,
  );

  await db.schema
    .createTable("chat_messages")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("room_id", "uuid", (c) =>
      c.notNull().references("chat_rooms.id").onDelete("cascade"),
    )
    .addColumn("body", "jsonb", (c) => c.notNull())
    .addColumn("body_text", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("created_by", "text", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("edited_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("chat_messages_room_created_idx")
    .on("chat_messages")
    .columns(["room_id", "created_at"])
    .execute();
  await sql`create index chat_messages_body_text_trgm_idx on chat_messages using gin (body_text gin_trgm_ops);`.execute(
    db,
  );

  await db.schema
    .createTable("chat_message_reactions")
    .addColumn("message_id", "uuid", (c) =>
      c.notNull().references("chat_messages.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("emoji", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("chat_message_reactions_pk", [
      "message_id",
      "user_id",
      "emoji",
    ])
    .execute();

  // Seed the single global public room.
  await db.insertInto("chat_rooms").values({ kind: "global" }).execute();

  // Card threads are 'card' rooms now — the old comments table is gone.
  await db.schema.dropTable("comments").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Recreate the comments table (shape from the comments + search migrations).
  await db.schema
    .createTable("comments")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("entity_type", "text", (c) => c.notNull())
    .addColumn("entity_id", "uuid", (c) => c.notNull())
    .addColumn("body", "jsonb", (c) => c.notNull())
    .addColumn("body_text", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("created_by", "text", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();
  await db.schema
    .createIndex("comments_entity_idx")
    .on("comments")
    .columns(["entity_type", "entity_id"])
    .execute();
  await sql`create index comments_body_text_trgm_idx on comments using gin (body_text gin_trgm_ops);`.execute(
    db,
  );

  await db.schema.dropTable("chat_message_reactions").execute();
  await db.schema.dropTable("chat_messages").execute();
  await db.schema.dropTable("chat_rooms").execute();
}
