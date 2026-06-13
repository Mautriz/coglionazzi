import { sql, type Kysely } from "kysely";

// Card properties: multi-user assignees and card↔card relations.
//
// Relations carry a kind:
//  - 'related': undirected; rows are normalized (card_id < related_card_id)
//    at insert so one row covers both directions.
//  - 'blocks':  directed; card_id blocks related_card_id (i.e. the related
//    card depends on this one). "blocked by" is the same row read from the
//    other side.
// One relation per pair max — enforced in the addRelation procedure (it
// clears both directions first), with the PK as the storage-level backstop.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("card_assignees")
    .addColumn("card_id", "uuid", (c) =>
      c.notNull().references("cards.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("card_assignees_pkey", ["card_id", "user_id"])
    .execute();

  await db.schema
    .createTable("card_relations")
    .addColumn("card_id", "uuid", (c) =>
      c.notNull().references("cards.id").onDelete("cascade"),
    )
    .addColumn("related_card_id", "uuid", (c) =>
      c.notNull().references("cards.id").onDelete("cascade"),
    )
    .addColumn("kind", "text", (c) => c.notNull().defaultTo("related"))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("card_relations_pkey", [
      "card_id",
      "related_card_id",
    ])
    .addCheckConstraint(
      "card_relations_kind",
      sql`kind in ('related', 'blocks')`,
    )
    .addCheckConstraint(
      "card_relations_not_self",
      sql`card_id <> related_card_id`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("card_relations").execute();
  await db.schema.dropTable("card_assignees").execute();
}
