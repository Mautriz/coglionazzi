import { sql } from "kysely";
import { afterEach, beforeEach } from "vitest";
import { db } from "../src/server/db";

/** Wrap every test in a Postgres transaction that's *always* rolled back.
 *  Combined with the dedicated test database (set up once by
 *  `test/global-setup.ts`) and the `max: 1` pool in test mode, this gives
 *  every test a clean schema with zero leaked state — no per-test wipes
 *  or factory cleanup needed. */
beforeEach(async () => {
  await sql`BEGIN`.execute(db);
});

afterEach(async () => {
  await sql`ROLLBACK`.execute(db);
});
