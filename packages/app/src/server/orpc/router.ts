import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { auth } from "../auth";
import { db } from "../db";
import { fileService } from "../files";
import { authP, getAuthSession, t } from "./base";

/** Public URL an uploaded file is served from (routes/api/files.ts). */
const fileUrl = (path: string) =>
  `/api/files?fileId=${encodeURIComponent(path)}`;

export const appRouter = {
  image: {
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
              ],
              "Unsupported file type",
            )
            .max(5 * 1024 * 1024, "File size must be less than 5MB"),
        }),
      )
      .handler(async (info) => {
        const filePath = await fileService.addFile(info.input.file);

        const { id } = await db
          .insertInto("images")
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
          url: fileUrl(filePath),
        };
      }),

    /** The caller's uploaded images, newest first. */
    mine: authP.handler(async (info) => {
      const images = await db
        .selectFrom("images")
        .where("user_id", "=", info.context.user.id)
        .select(["id", "path", "metadata", "created_at"])
        .orderBy("created_at", "desc")
        .limit(50)
        .execute();

      return images.map((img) => ({
        ...img,
        url: fileUrl(img.path),
      }));
    }),
  },
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
