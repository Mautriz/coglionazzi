import { sql, type Kysely } from "kysely";

// The game framework + the first game ("versus").
//
// SHARED (reused by every future game): a `game_decks` reusable image set, and
// a `game_sessions` lobby (kind discriminates the mechanic) with a frozen
// `game_session_players` roster.
//
// GAME MODULE "versus": a single-elimination left/right voting bracket —
// `versus_matchups` + `versus_votes`. Future games (rating/tierlist) add their
// own *_ tables against the SAME deck/session/player shell.
export async function up(db: Kysely<any>): Promise<void> {
  // --- shared: decks (reusable image sets) ---------------------------------
  await db.schema
    .createTable("game_decks")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("created_by", "text", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("game_deck_cards")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("deck_id", "uuid", (c) =>
      c.notNull().references("game_decks.id").onDelete("cascade"),
    )
    .addColumn("file_id", "uuid", (c) =>
      c.notNull().references("files.id").onDelete("cascade"),
    )
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("description", "text")
    .addColumn("position", "integer", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("game_deck_cards_deck_idx")
    .on("game_deck_cards")
    .column("deck_id")
    .execute();

  // --- shared: sessions (lobby lifecycle) ----------------------------------
  await db.schema
    .createTable("game_sessions")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("deck_id", "uuid", (c) =>
      c.notNull().references("game_decks.id").onDelete("cascade"),
    )
    .addColumn("kind", "text", (c) => c.notNull().defaultTo("versus"))
    .addColumn("host_id", "text", (c) =>
      c.references("users.id").onDelete("set null"),
    )
    .addColumn("visibility", "text", (c) => c.notNull().defaultTo("public"))
    // Set only for private sessions; no FK (mirrors chat_rooms.owner_id).
    .addColumn("team_id", "uuid")
    .addColumn("card_count", "integer")
    .addColumn("status", "text", (c) => c.notNull().defaultTo("lobby"))
    .addColumn("winner_card_id", "uuid", (c) =>
      c.references("game_deck_cards.id").onDelete("set null"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("started_at", "timestamptz")
    .addColumn("finished_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("game_sessions_status_idx")
    .on("game_sessions")
    .columns(["status", "visibility"])
    .execute();

  await db.schema
    .createTable("game_session_players")
    .addColumn("session_id", "uuid", (c) =>
      c.notNull().references("game_sessions.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("joined_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("game_session_players_pk", [
      "session_id",
      "user_id",
    ])
    .execute();

  // --- game module: versus (the bracket) -----------------------------------
  await db.schema
    .createTable("versus_matchups")
    .addColumn("id", "uuid", (c) =>
      c.defaultTo(sql`gen_random_uuid()`).primaryKey(),
    )
    .addColumn("session_id", "uuid", (c) =>
      c.notNull().references("game_sessions.id").onDelete("cascade"),
    )
    .addColumn("round", "integer", (c) => c.notNull())
    .addColumn("position", "integer", (c) => c.notNull())
    .addColumn("left_card_id", "uuid", (c) =>
      c.notNull().references("game_deck_cards.id").onDelete("cascade"),
    )
    .addColumn("right_card_id", "uuid", (c) =>
      c.notNull().references("game_deck_cards.id").onDelete("cascade"),
    )
    .addColumn("winner_card_id", "uuid", (c) =>
      c.references("game_deck_cards.id").onDelete("set null"),
    )
    .addColumn("left_votes", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("right_votes", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("status", "text", (c) => c.notNull().defaultTo("pending"))
    .addColumn("resolved_at", "timestamptz")
    .execute();

  await db.schema
    .createIndex("versus_matchups_session_idx")
    .on("versus_matchups")
    .columns(["session_id", "round", "position"])
    .execute();

  await db.schema
    .createTable("versus_votes")
    .addColumn("matchup_id", "uuid", (c) =>
      c.notNull().references("versus_matchups.id").onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("choice", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("versus_votes_pk", ["matchup_id", "user_id"])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("versus_votes").execute();
  await db.schema.dropTable("versus_matchups").execute();
  await db.schema.dropTable("game_session_players").execute();
  await db.schema.dropTable("game_sessions").execute();
  await db.schema.dropTable("game_deck_cards").execute();
  await db.schema.dropTable("game_decks").execute();
}
