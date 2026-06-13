import { sql, type Kysely } from "kysely";

/** Inlined copy of extractLexicalText (migrations are frozen in time). */
function extractText(state: unknown): string {
  if (state == null) return "";
  const parts: string[] = [];
  function walk(node: unknown) {
    if (node == null || typeof node !== "object") return;
    const n = node as { text?: unknown; children?: unknown[] };
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child);
      parts.push("\n");
    }
  }
  walk((state as { root?: unknown }).root);
  return parts.join("").replace(/\n{2,}/g, "\n").trim();
}

// Fuzzy global search: pg_trgm + plain-text companion columns for the
// lexical jsonb fields, GIN trigram indexes on every searched column.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create extension if not exists pg_trgm;`.execute(db);

  await db.schema
    .alterTable("cards")
    .addColumn("description_text", "text", (c) => c.notNull().defaultTo(""))
    .execute();
  await db.schema
    .alterTable("comments")
    .addColumn("body_text", "text", (c) => c.notNull().defaultTo(""))
    .execute();

  // Backfill from the existing jsonb states.
  const cards = await db
    .selectFrom("cards")
    .select(["id", "description"])
    .where("description", "is not", null)
    .execute();
  for (const card of cards) {
    await db
      .updateTable("cards")
      .set({ description_text: extractText(card.description) })
      .where("id", "=", card.id)
      .execute();
  }
  const comments = await db
    .selectFrom("comments")
    .select(["id", "body"])
    .execute();
  for (const comment of comments) {
    await db
      .updateTable("comments")
      .set({ body_text: extractText(comment.body) })
      .where("id", "=", comment.id)
      .execute();
  }

  await sql`create index boards_name_trgm_idx on boards using gin (name gin_trgm_ops);`.execute(
    db,
  );
  await sql`create index cards_title_trgm_idx on cards using gin (title gin_trgm_ops);`.execute(
    db,
  );
  await sql`create index cards_description_text_trgm_idx on cards using gin (description_text gin_trgm_ops);`.execute(
    db,
  );
  await sql`create index comments_body_text_trgm_idx on comments using gin (body_text gin_trgm_ops);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop index if exists comments_body_text_trgm_idx;`.execute(db);
  await sql`drop index if exists cards_description_text_trgm_idx;`.execute(db);
  await sql`drop index if exists cards_title_trgm_idx;`.execute(db);
  await sql`drop index if exists boards_name_trgm_idx;`.execute(db);
  await db.schema.alterTable("comments").dropColumn("body_text").execute();
  await db.schema.alterTable("cards").dropColumn("description_text").execute();
}
