import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./dbtypes";

const isTest = process.env.NODE_ENV === "test";

/** Replace the dbname in a Postgres URL with `<dbname>_test`, so tests run
 *  against a dedicated database (created/migrated by test/global-setup.ts)
 *  without extra env on a fresh checkout. */
const deriveTestUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}_test`;
  return parsed.toString();
};

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  throw new Error("DATABASE_URL is not set (expected in packages/.env)");
}

const databaseUrl = isTest
  ? (process.env.DATABASE_URL_TEST ?? deriveTestUrl(baseUrl))
  : baseUrl;

/** In test mode the pool is pinned to a single connection so every query
 *  funnels through the same backend session — that's what makes the BEGIN
 *  issued in the test setup's beforeEach envelope every query, and the
 *  ROLLBACK in afterEach revert them. */
export const pool = new pg.Pool({
  connectionString: databaseUrl,
  min: isTest ? 1 : undefined,
  max: isTest ? 1 : 10,
  // Don't reap the single test connection between queries — losing it
  // would discard the in-flight transaction state with it.
  idleTimeoutMillis: isTest ? 0 : undefined,
});

export const dialect = new PostgresDialect({
  pool,
});

export const db = new Kysely<DB>({
  dialect,
});
