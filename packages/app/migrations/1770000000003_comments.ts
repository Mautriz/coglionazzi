import { sql, type Kysely } from "kysely";

// Polymorphic comments: (entity_type, entity_id) points at any commentable
// entity ("card" today). No FK on entity_id — the owning entity's delete
// procedures clean up their comments (see boards router).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("comments")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("entity_type", "text", (c) => c.notNull())
    .addColumn("entity_id", "uuid", (c) => c.notNull())
    .addColumn("body", "jsonb", (c) => c.notNull())
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
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("comments").execute();
}
