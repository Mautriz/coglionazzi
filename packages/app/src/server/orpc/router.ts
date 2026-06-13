import { z } from "zod";
import { db } from "../db";
import {
  fileService,
  fileUrl,
  type FileMetadata,
} from "../files";
import { archiveRouter } from "./archive";
import { authP, resolveSession, t } from "./base";
import { boardRouter } from "./boards";
import { commentRouter } from "./comments";
import { presenceRouter } from "./presence";
import { searchRouter } from "./search";
import { teamRouter } from "./teams";
import { userRouter } from "./users";

export const appRouter = {
  file: {
    upload: authP
      .input(
        z.object({
          file: z
            .file()
            .mime(
              [
                "image/gif",
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/svg+xml",
                "application/pdf",
                "text/plain",
                "text/markdown",
                "application/zip",
                "audio/mpeg",
                "video/mp4",
              ],
              "Unsupported file type",
            )
            .max(20 * 1024 * 1024, "File size must be less than 20MB"),
        }),
      )
      .handler(async (info) => {
        const filePath = await fileService.addFile(info.input.file);

        const { id } = await db
          .insertInto("files")
          .values({
            path: filePath,
            user_id: info.context.user.id,
            metadata: JSON.stringify({
              name: info.input.file.name,
              type: info.input.file.type,
              size: info.input.file.size,
            }),
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        return {
          id,
          path: filePath,
          name: info.input.file.name,
          type: info.input.file.type,
          url: fileUrl(filePath),
        };
      }),

    /** The caller's uploads, newest first. */
    mine: authP.handler(async (info) => {
      const files = await db
        .selectFrom("files")
        .where("user_id", "=", info.context.user.id)
        .select(["id", "path", "metadata", "created_at"])
        .orderBy("created_at", "desc")
        .limit(50)
        .execute();

      return files.map((file) => ({
        ...file,
        metadata: file.metadata as FileMetadata,
        url: fileUrl(file.path),
      }));
    }),
  },
  board: boardRouter,
  archive: archiveRouter,
  comment: commentRouter,
  presence: presenceRouter,
  search: searchRouter,
  team: teamRouter,
  user: userRouter,
  auth: {
    // Login AND signup run over HTTP via the better-auth client directly
    // (`authClient.signIn/signUp.email`) because they set the session cookie
    // with Set-Cookie, which the WebSocket transport can't deliver. This
    // procedure only reads the current session (used in `__root` beforeLoad).
    getSession: t.handler(async (info) => {
      const resolved = await resolveSession(info.context);
      if (!resolved) return null;
      return { user: resolved.user, session: resolved.session };
    }),
  },
};

export type AppRouter = typeof appRouter;
