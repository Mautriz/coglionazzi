import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./dbtypes";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set (expected in packages/.env)");
}

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 10,
});

export const dialect = new PostgresDialect({
  pool,
});

export const db = new Kysely<DB>({
  dialect,
});
