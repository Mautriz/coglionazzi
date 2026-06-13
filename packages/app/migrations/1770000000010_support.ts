import { sql, type Kysely } from "kysely";

// Team support / helpdesk: each team is a support inbox. External visitors
// (identified by email + a per-ticket secret token) and logged-in users open
// tickets; team members (agents) reply and triage by category + status.
//
// Ticket CONVERSATIONS reuse the generic chat model: a `chat_rooms` row with
// kind='support' (owner_id = ticket.id). In a support room, a message's
// `created_by IS NULL` means the visitor; a non-null user means an agent. So no
// change to chat_messages is needed (see src/server/orpc/roomAccess.ts).
export async function up(db: Kysely<any>): Promise<void> {
  // Per-team support categories (triage labels).
  await db.schema
    .createTable("support_categories")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("team_id", "uuid", (c) =>
      c.notNull().references("teams.id").onDelete("cascade"),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("position", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("support_categories_team_name_uniq")
    .on("support_categories")
    .columns(["team_id", "name"])
    .unique()
    .execute();

  // Support tickets. The conversation lives in a kind='support' chat room
  // (owner_id = this ticket's id); no FK on the room side (mirrors chat_rooms).
  await db.schema
    .createTable("support_tickets")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("team_id", "uuid", (c) =>
      c.notNull().references("teams.id").onDelete("cascade"),
    )
    .addColumn("subject", "text")
    .addColumn("category_id", "uuid", (c) =>
      c.references("support_categories.id").onDelete("set null"),
    )
    .addColumn("status", "text", (c) =>
      c
        .notNull()
        .defaultTo("open")
        .check(sql`status in ('open', 'resolved')`),
    )
    // The logged-in coglionazzi user who opened it (in-app path), if any.
    .addColumn("requester_user_id", "text", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("requester_email", "text")
    .addColumn("requester_name", "text")
    // The visitor's per-ticket secret (resume + auth the public endpoints).
    .addColumn("access_token", "text", (c) => c.notNull().unique())
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("last_message_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("resolved_at", "timestamptz")
    .execute();

  // Inbox query: a team's tickets, by status, newest-active first.
  await db.schema
    .createIndex("support_tickets_inbox_idx")
    .on("support_tickets")
    .columns(["team_id", "status", "last_message_at"])
    .execute();

  // The public embeddable widget id (like an Intercom app_id). Lazily set by
  // support.enableWidget; nullable so existing teams keep working.
  await db.schema
    .alterTable("teams")
    .addColumn("widget_key", "text")
    .execute();

  await db.schema
    .createIndex("teams_widget_key_uniq")
    .on("teams")
    .column("widget_key")
    .unique()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("teams").dropColumn("widget_key").execute();
  await db.schema.dropTable("support_tickets").execute();
  await db.schema.dropTable("support_categories").execute();
}
