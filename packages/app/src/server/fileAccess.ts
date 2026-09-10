import { ORPCError } from "@orpc/server";
import { db } from "./db";
import { fileService, type FileMetadata } from "./files";

/** A file the caller is allowed to read, as recorded in the `files` table. */
export interface AccessibleFile {
  id: string;
  path: string;
  metadata: FileMetadata;
}

/** Denial and non-existence are the SAME answer: the storage id is the only
 *  secret protecting a file, so a 403 would confirm that an id is real. */
function notFound(): ORPCError<"NOT_FOUND", undefined> {
  return new ORPCError("NOT_FOUND", { message: "File not found" });
}

/** Gate for reading an uploaded file, shared by the browser (`/api/files`)
 *  and the MCP `get_attachment` tool — one rule, both callers.
 *
 *  Access is granted when ANY of these hold:
 *  - the caller uploaded it (this also covers uploads not yet attached to
 *    anything, e.g. the `/play/demo` gallery);
 *  - it is attached to a card in one of the caller's teams;
 *  - it is a game deck image — decks are deliberately GLOBAL content, so any
 *    logged-in user may read them.
 *
 *  Throws NOT_FOUND when the path is unknown OR the caller isn't allowed. */
export async function assertFileAccess(
  userId: string,
  path: string,
): Promise<AccessibleFile> {
  const row = await db
    .selectFrom("files")
    .where("files.path", "=", path)
    .select(["id", "path", "metadata", "user_id"])
    .executeTakeFirst();

  if (!row) throw notFound();

  const file: AccessibleFile = {
    id: row.id,
    path: row.path,
    metadata: (row.metadata ?? {}) as FileMetadata,
  };

  // The common case (viewing your own upload) costs no extra query.
  if (row.user_id === userId) return file;

  const referenced = await db
    .selectFrom("files")
    .where("files.id", "=", row.id)
    .where(({ eb, or, exists, selectFrom }) =>
      or([
        // A deck image — global content, no membership check.
        exists(
          selectFrom("game_deck_cards")
            .select("game_deck_cards.id")
            .whereRef("game_deck_cards.file_id", "=", "files.id"),
        ),
        // Attached to a card in a team the caller belongs to.
        exists(
          selectFrom("card_attachments")
            .innerJoin("cards", "cards.id", "card_attachments.card_id")
            .innerJoin("team_members", "team_members.team_id", "cards.team_id")
            .select("card_attachments.file_id")
            .whereRef("card_attachments.file_id", "=", "files.id")
            .where("team_members.user_id", "=", eb.val(userId)),
        ),
      ]),
    )
    .select("files.id")
    .executeTakeFirst();

  if (!referenced) throw notFound();
  return file;
}

/** Delete a file once its LAST reference goes away, returning whether it did.
 *
 *  Both `card_attachments.file_id` and `game_deck_cards.file_id` are declared
 *  ON DELETE CASCADE to `files.id`, so the database will never BLOCK deleting
 *  a still-referenced file — it would silently strip it from every card and
 *  deck that uses it. The reference check is therefore application-level and
 *  must be correct.
 *
 *  It rides in the DELETE itself (`NOT EXISTS` legs) so the check and the
 *  delete are one atomic statement — no read-then-write window, and no
 *  explicit transaction (which would nest badly inside the tests' BEGIN).
 *
 *  Disk deletion cannot be transactional, so it happens last: a crash in
 *  between leaves unreachable bytes on disk, which is harmless. The reverse
 *  order could serve a row whose bytes are gone — the route already tolerates
 *  that (`fileService.exists` ⇒ 404), but this ordering avoids it entirely. */
export async function deleteFileIfUnreferenced(
  fileId: string,
): Promise<boolean> {
  const deleted = await db
    .deleteFrom("files")
    .where("files.id", "=", fileId)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("card_attachments")
            .select("card_attachments.file_id")
            .whereRef("card_attachments.file_id", "=", "files.id"),
        ),
      ),
    )
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("game_deck_cards")
            .select("game_deck_cards.id")
            .whereRef("game_deck_cards.file_id", "=", "files.id"),
        ),
      ),
    )
    .returning("path")
    .executeTakeFirst();

  if (!deleted) return false;

  await fileService.deleteFile(deleted.path);
  return true;
}

/** Drop every file in `fileIds` that no longer has a reference. Callers must
 *  collect the ids BEFORE the delete that cascades their join rows away. */
export async function deleteFilesIfUnreferenced(
  fileIds: string[],
): Promise<void> {
  for (const id of fileIds) {
    await deleteFileIfUnreferenced(id);
  }
}
