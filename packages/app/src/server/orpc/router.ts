import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { auth } from "../auth";
import { db } from "../db";
import {
  fileService,
  fileUrl,
  type FileMetadata,
} from "../files";
import { authP, getAuthSession, t } from "./base";
import { boardRouter } from "./boards";
import { commentRouter } from "./comments";
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
  comment: commentRouter,
  search: searchRouter,
  team: teamRouter,
  user: userRouter,
  auth: {
    getSession: t.handler(async (info) => {
      if (!info.context.reqHeaders) {
        return null;
      }

      const { summary } = await getAuthSession(info.context.reqHeaders);
      return summary ?? null;
    }),

    signUp: t
      .input(
        z.object({
          email: z.email(),
          password: z.string().min(8),
          name: z.string().min(1),
        }),
      )
      .handler(async (info) => {
        await auth.api
          .signUpEmail({
            body: {
              email: info.input.email,
              name: info.input.name,
              password: info.input.password,
            },
            headers: info.context.request?.headers,
          })
          .catch(() => {
            throw new ORPCError("BAD_REQUEST", {
              message: "Something went wrong during sign up.",
            });
          });

        // Sign the fresh user straight in: replay the credentials and copy
        // the Set-Cookie headers onto our response.
        const { headers } = await auth.api.signInEmail({
          body: {
            email: info.input.email,
            password: info.input.password,
          },
          returnHeaders: true,
          headers: info.context.request?.headers,
        });

        headers.forEach((value, key) => {
          info.context.resHeaders?.set(key, value);
        });
      }),
  },
};

export type AppRouter = typeof appRouter;
