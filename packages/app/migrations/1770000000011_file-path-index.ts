import { type Kysely } from "kysely";

// Files are now served by their storage id: routes/api/files.ts looks the row
// up by `path` on every request (the recorded metadata decides the content
// type + download name), so that lookup needs an index. Unique because a path
// is a uuid — one row per stored file.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex("files_path_uniq")
    .on("files")
    .column("path")
    .unique()
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("files_path_uniq").execute();
}
