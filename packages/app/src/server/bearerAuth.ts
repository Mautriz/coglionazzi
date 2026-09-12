import { API_KEY_PREFIX, bearerToken, resolveApiKey } from "./apiKeys";
import { auth } from "./auth";

/** How an `Authorization: Bearer …` credential resolved.
 *
 *  - `absent`: no bearer credential at all — the caller may still have a
 *    session cookie, so callers fall through to it.
 *  - `invalid`: a bearer credential WAS presented and failed (unknown,
 *    revoked, expired). Callers must NOT fall through to the cookie: a failed
 *    credential is a failed attempt, not an invitation to try another.
 *  - `ok`: the user it acts as, and which kind it was. */
export type BearerResolution =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "ok"; userId: string; via: "apiKey" | "oauth" };

/** THE bearer branch, shared by `resolveSession` (oRPC) and
 *  `resolveHttpCaller` (plain routes). Two kinds of token exist:
 *
 *  1. our API keys, recognisable by the `ins_` prefix (hashed lookup);
 *  2. OAuth access tokens minted by better-auth's `mcp` plugin for
 *     claude.ai / Claude Code — opaque strings the plugin looks up and
 *     expiry-checks in `oauth_access_tokens`.
 *
 *  Both act as a plain user; every team gate downstream applies unchanged. */
export async function resolveBearerCaller(
  headers: Headers,
): Promise<BearerResolution> {
  const token = bearerToken(headers);
  if (!token) return { kind: "absent" };

  if (token.startsWith(API_KEY_PREFIX)) {
    const key = await resolveApiKey(token);
    return key
      ? { kind: "ok", userId: key.userId, via: "apiKey" }
      : { kind: "invalid" };
  }

  // Hand the plugin ONLY the bearer, never the caller's cookies.
  const grant = await auth.api.getMcpSession({
    headers: new Headers({ authorization: `Bearer ${token}` }),
  });
  if (!grant?.userId) return { kind: "invalid" };

  return { kind: "ok", userId: grant.userId, via: "oauth" };
}
