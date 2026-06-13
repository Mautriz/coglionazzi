import { sql, type Kysely } from "kysely";

// Teams: boards are now scoped to a team, users join many teams via
// team_members. Membership gates access (see the boards/team routers).
// Backfill: drop all existing users + boards into one default "Coglionazzi"
// team so nothing currently in the app disappears.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("teams")
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
    .createTable("team_members")
    .addColumn("team_id", "uuid", (c) =>
      c.notNull().references("teams.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("role", "text", (c) => c.notNull().defaultTo("member"))
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("team_members_pkey", ["team_id", "user_id"])
    .addCheckConstraint("team_members_role", sql`role in ('owner', 'member')`)
    .execute();

  // Add the FK nullable first so we can backfill, then enforce NOT NULL.
  await db.schema
    .alterTable("boards")
    .addColumn("team_id", "uuid", (c) =>
      c.references("teams.id").onDelete("cascade"),
    )
    .execute();

  const users = await db
    .selectFrom("users")
    .select("id")
    .orderBy("created_at", "asc")
    .execute();
  const boardsExist = await db
    .selectFrom("boards")
    .select("id")
    .limit(1)
    .execute();

  // Only materialize a default team if there's existing data to home.
  if (users.length > 0 || boardsExist.length > 0) {
    const ownerId = users[0]?.id ?? null;
    const team = await db
      .insertInto("teams")
      .values({ name: "Coglionazzi", created_by: ownerId })
      .returning("id")
      .executeTakeFirstOrThrow();

    if (users.length > 0) {
      await db
        .insertInto("team_members")
        .values(
          users.map((u) => ({
            team_id: team.id,
            user_id: u.id,
            role: u.id === ownerId ? "owner" : "member",
          })),
        )
        .execute();
    }

    await db
      .updateTable("boards")
      .set({ team_id: team.id })
      .where("team_id", "is", null)
      .execute();
  }

  await db.schema
    .alterTable("boards")
    .alterColumn("team_id", (c) => c.setNotNull())
    .execute();

  await db.schema
    .createIndex("team_members_user_idx")
    .on("team_members")
    .column("user_id")
    .execute();
  await db.schema
    .createIndex("boards_team_idx")
    .on("boards")
    .column("team_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("boards").dropColumn("team_id").execute();
  await db.schema.dropTable("team_members").execute();
  await db.schema.dropTable("teams").execute();
}
