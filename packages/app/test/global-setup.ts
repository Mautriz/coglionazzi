import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
} from "kysely";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

const deriveTestUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}_test`;
  return parsed.toString();
};

/** Vitest globalSetup. Runs once per `npm test` invocation, before any
 *  test file is loaded. Ensures the dedicated test database exists and is
 *  migrated to head, so tests start against a clean schema with no rows
 *  leaking in from dev usage. */
export default async function setup() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("globalSetup: DATABASE_URL not set");
  }

  const testUrl = process.env.DATABASE_URL_TEST ?? deriveTestUrl(baseUrl);

  await ensureDatabaseExists(baseUrl, testUrl);
  await runMigrations(testUrl);
}

/** Connect to the postgres admin DB on the same instance and CREATE the
 *  test DB if it doesn't exist. Idempotent. */
async function ensureDatabaseExists(
  baseUrl: string,
  testUrl: string,
): Promise<void> {
  const target = new URL(testUrl);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!dbName) {
    throw new Error(`globalSetup: cannot derive test dbname from ${testUrl}`);
  }

  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";

  const adminPool = new pg.Pool({
    connectionString: adminUrl.toString(),
    max: 1,
  });
  try {
    const exists = await adminPool.query<{ exists: boolean }>(
      `select exists(select 1 from pg_database where datname = $1) as exists`,
      [dbName],
    );
    if (!exists.rows[0]?.exists) {
      // dbName is interpolated rather than parameterized — Postgres doesn't
      // accept parameters in CREATE DATABASE. Quoting keeps the controlled
      // value safe.
      await adminPool.query(`create database "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminPool.end();
  }
}

async function runMigrations(testUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: testUrl, max: 1 });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });

  try {
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder: MIGRATIONS_DIR,
      }),
    });

    const { error, results } = await migrator.migrateToLatest();
    if (error) {
      const failed = results?.find((r) => r.status === "Error");
      throw new Error(
        `globalSetup: migration failed at ${failed?.migrationName ?? "?"}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } finally {
    await db.destroy();
  }
}
