import { sql, type Kysely } from "kysely";

// OAuth 2.1 authorization-server tables for better-auth's `mcp` plugin. They let
// MCP clients that can only do OAuth (claude.ai custom connectors, Claude Code's
// `/mcp` login) authenticate against /api/mcp — the user logs in to Insacco in
// the OAuth popup, and Claude then acts as that user.
//
// Columns are the plugin's camelCase fields mapped to snake_case in
// src/server/auth.ts (`oidcConfig.schema`), like the other better-auth tables.
// Ids are better-auth-generated strings, hence TEXT primary keys.
export async function up(db: Kysely<any>): Promise<void> {
  // One row per registered OAuth client. claude.ai registers itself through
  // dynamic client registration, so rows appear on first connect.
  await db.schema
    .createTable("oauth_applications")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text")
    .addColumn("icon", "text")
    .addColumn("metadata", "text")
    .addColumn("client_id", "text", (c) => c.notNull().unique())
    .addColumn("client_secret", "text")
    // Comma-joined list (the plugin's own encoding).
    .addColumn("redirect_urls", "text", (c) => c.notNull())
    // "public" (PKCE, no secret — claude.ai) or "web".
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("disabled", "boolean", (c) => c.notNull().defaultTo(false))
    // Null when registered anonymously (the normal case).
    .addColumn("user_id", "text", (c) =>
      c.references("users.id").onDelete("cascade"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("oauth_applications_user_idx")
    .on("oauth_applications")
    .column("user_id")
    .execute();

  // Issued grants. `access_token` is an opaque random string, looked up on
  // every external request (unique index). Stored in clear by the plugin —
  // unlike our hashed api_keys — accepted because tokens expire and refresh.
  await db.schema
    .createTable("oauth_access_tokens")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("access_token", "text", (c) => c.notNull().unique())
    .addColumn("refresh_token", "text", (c) => c.unique())
    .addColumn("access_token_expires_at", "timestamptz", (c) => c.notNull())
    .addColumn("refresh_token_expires_at", "timestamptz")
    .addColumn("client_id", "text", (c) =>
      c
        .notNull()
        .references("oauth_applications.client_id")
        .onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) =>
      c.references("users.id").onDelete("cascade"),
    )
    .addColumn("scopes", "text", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("oauth_access_tokens_client_idx")
    .on("oauth_access_tokens")
    .column("client_id")
    .execute();

  await db.schema
    .createIndex("oauth_access_tokens_user_idx")
    .on("oauth_access_tokens")
    .column("user_id")
    .execute();

  // Consent records. Unused today (we skip the consent screen) but the plugin
  // requires the model.
  await db.schema
    .createTable("oauth_consents")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("client_id", "text", (c) =>
      c
        .notNull()
        .references("oauth_applications.client_id")
        .onDelete("cascade"),
    )
    .addColumn("user_id", "text", (c) =>
      c.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("scopes", "text", (c) => c.notNull())
    .addColumn("consent_given", "boolean", (c) => c.notNull())
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("oauth_consents_client_idx")
    .on("oauth_consents")
    .column("client_id")
    .execute();

  await db.schema
    .createIndex("oauth_consents_user_idx")
    .on("oauth_consents")
    .column("user_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("oauth_consents").execute();
  await db.schema.dropTable("oauth_access_tokens").execute();
  await db.schema.dropTable("oauth_applications").execute();
}
