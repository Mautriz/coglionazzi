import { sql, type Kysely } from "kysely";

// Uploads become generic (images → files) and the kanban entities land:
// boards → board_columns → cards (tags as text[], description = serialized
// lexical state) + card_attachments linking cards to uploaded files.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("images").renameTo("files").execute();

  await db.schema
    .createTable("boards")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("created_by", "text", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("board_columns")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("board_id", "uuid", (c) =>
      c.notNull().references("boards.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("position", "double precision", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("cards")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("column_id", "uuid", (c) =>
      c.notNull().references("board_columns.id").onDelete("cascade"),
    )
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("description", "jsonb")
    .addColumn("tags", sql`text[]`, (c) =>
      c.notNull().defaultTo(sql`'{}'::text[]`),
    )
    .addColumn("position", "double precision", (c) => c.notNull())
    .addColumn("created_by", "text", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("card_attachments")
    .addColumn("card_id", "uuid", (c) =>
      c.notNull().references("cards.id").onDelete("cascade"),
    )
    .addColumn("file_id", "uuid", (c) =>
      c.notNull().references("files.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("card_attachments_pkey", ["card_id", "file_id"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("card_attachments").execute();
  await db.schema.dropTable("cards").execute();
  await db.schema.dropTable("board_columns").execute();
  await db.schema.dropTable("boards").execute();
  await db.schema.alterTable("files").renameTo("images").execute();
}
