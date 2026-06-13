import { sql, type Kysely } from "kysely";

// better-auth tables (snake_case columns; field mappings live in
// src/server/auth.ts). `any` is required since migrations are frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create table "users" ("id" text not null primary key, "name" text not null, "email" text not null unique, "email_verified" boolean not null, "image" text, "created_at" timestamp not null, "updated_at" timestamp not null);`.execute(
    db,
  );

  await sql`create table "sessions" ("id" text not null primary key, "expires_at" timestamp not null, "token" text not null unique, "created_at" timestamp not null, "updated_at" timestamp not null, "ip_address" text, "user_agent" text, "user_id" text not null references "users" ("id"));`.execute(
    db,
  );

  await sql`create table "accounts" ("id" text not null primary key, "account_id" text not null, "provider_id" text not null, "user_id" text not null references "users" ("id"), "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamp, "refresh_token_expires_at" timestamp, "scope" text, "password" text, "created_at" timestamp not null, "updated_at" timestamp not null);`.execute(
    db,
  );

  await sql`create table "verifications" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expires_at" timestamp not null, "created_at" timestamp, "updated_at" timestamp);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("verifications").execute();
  await db.schema.dropTable("accounts").execute();
  await db.schema.dropTable("sessions").execute();
  await db.schema.dropTable("users").execute();
}
