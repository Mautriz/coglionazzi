import { sql, type Kysely } from "kysely";

// Card archive: instead of being destroyed, cards are soft-deleted into a
// per-team archive. `archived_at` marks a card archived; `team_id` is
// denormalized onto the card so the archive survives its column/board being
// deleted (the column→board→team chain is otherwise severed). `column_id`
// becomes nullable with ON DELETE SET NULL so deleting a column/board detaches
// (rather than cascade-wipes) its archived cards. `archived_origin` snapshots
// a "Board / Column" label for display once the origin is gone.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("cards")
    .addColumn("archived_at", "timestamptz")
    .addColumn("archived_by", "text", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("archived_origin", "text")
    // Nullable first so we can backfill from the column→board→team chain.
    .addColumn("team_id", "uuid", (c) =>
      c.references("teams.id").onDelete("cascade"),
    )
    .execute();

  await sql`
    update cards
    set team_id = boards.team_id
    from board_columns, boards
    where cards.column_id = board_columns.id
      and board_columns.board_id = boards.id
  `.execute(db);

  await db.schema
    .alterTable("cards")
    .alterColumn("team_id", (c) => c.setNotNull())
    .execute();

  // column_id: was NOT NULL + ON DELETE CASCADE. Make it nullable and switch
  // the cascade to SET NULL so a deleted column/board detaches archived cards
  // instead of wiping them.
  await db.schema
    .alterTable("cards")
    .alterColumn("column_id", (c) => c.dropNotNull())
    .execute();

  await sql`alter table cards drop constraint cards_column_id_fkey`.execute(db);
  await sql`
    alter table cards
    add constraint cards_column_id_fkey
    foreign key (column_id) references board_columns (id) on delete set null
  `.execute(db);

  await db.schema
    .createIndex("cards_team_archived_idx")
    .on("cards")
    .columns(["team_id", "archived_at"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("cards_team_archived_idx").execute();

  await sql`alter table cards drop constraint cards_column_id_fkey`.execute(db);
  await sql`
    alter table cards
    add constraint cards_column_id_fkey
    foreign key (column_id) references board_columns (id) on delete cascade
  `.execute(db);
  await db.schema
    .alterTable("cards")
    .alterColumn("column_id", (c) => c.setNotNull())
    .execute();

  await db.schema
    .alterTable("cards")
    .dropColumn("team_id")
    .dropColumn("archived_origin")
    .dropColumn("archived_by")
    .dropColumn("archived_at")
    .execute();
}
