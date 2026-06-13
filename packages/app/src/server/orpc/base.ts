import { ORPCError, os } from "@orpc/server";
import {
  RequestHeadersPluginContext,
  ResponseHeadersPluginContext,
} from "@orpc/server/plugins";
import { auth } from "../auth";

export interface ORPCContext
  extends RequestHeadersPluginContext,
    ResponseHeadersPluginContext {
  request?: Request;
}

export const t = os.$context<ORPCContext>();

export async function getAuthSession(headers: HeadersInit) {
  const summary = await auth.api.getSession({
    headers,
  });

  return { summary, headers };
}

/** Procedures built on `authP` require a logged-in user; `context.user` and
 *  `context.session` are populated. */
export const authP = t.use(async (info) => {
  if (!info.context.reqHeaders) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "You must be logged in to perform this action.",
    });
  }

  const { summary, headers } = await getAuthSession(info.context.reqHeaders);

  if (!summary?.user) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "You must be logged in to perform this action.",
    });
  }

  const { session, user } = summary;

  return info.next({
    context: {
      session,
      user,
      headers,
    },
  });
});
