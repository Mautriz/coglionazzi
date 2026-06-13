import { sql, type Kysely } from "kysely";

// `any` is required since migrations are frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("images")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("path", "text", (c) => c.notNull())
    .addColumn("metadata", "jsonb", (c) => c.notNull())
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("images").execute();
}
