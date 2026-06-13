import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { auth } from "../auth";
import { getAuthSession, t } from "./base";

export const appRouter = {
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
