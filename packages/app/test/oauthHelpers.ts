import { createHash, randomBytes } from "node:crypto";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import type { ORPCContext } from "../src/server/orpc/base";

/** Mirrors the `baseURL` fallback in `auth.ts` so the two cannot diverge.
 *  Requests to `auth.handler` must use this origin. */
export const AUTH_ORIGIN =
  process.env.VITE_FRONTEND_URL ?? "http://localhost:3300";

/** Where the pretend OAuth client (claude.ai / Claude Code) wants the code. */
export const REDIRECT_URI = "http://127.0.0.1:9797/callback";

/** The session cookie header value of a `signUpTestUser()` context. */
export function cookieOf(context: ORPCContext): string {
  return new Headers(context.reqHeaders as HeadersInit).get("cookie") ?? "";
}

/** Dynamic client registration (RFC 7591), anonymous — exactly what claude.ai
 *  does before its first authorize. Public client (PKCE, no secret). */
export async function registerOAuthClient(): Promise<string> {
  const res = await auth.handler(
    new Request(`${AUTH_ORIGIN}/api/auth/mcp/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test connector",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }),
  );
  if (!res.ok) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** GET /mcp/authorize as a logged-in browser would (cookie, no Origin — a
 *  top-level navigation). Returns the redirect target. */
export async function authorizeAs(
  cookie: string,
  clientId: string,
  challenge: string,
  state = "state-1",
): Promise<URL> {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid profile email offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const res = await auth.handler(
    new Request(`${AUTH_ORIGIN}/api/auth/mcp/authorize?${params}`, {
      headers: { cookie },
    }),
  );
  const location = res.headers.get("location");
  if (res.status !== 302 || !location) {
    throw new Error(
      `authorize did not redirect: ${res.status} ${await res.text()}`,
    );
  }
  return new URL(location);
}

export async function exchangeCode(
  clientId: string,
  code: string,
  verifier: string,
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const res = await auth.handler(
    new Request(`${AUTH_ORIGIN}/api/auth/mcp/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      }).toString(),
    }),
  );
  if (!res.ok) {
    throw new Error(`token failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** The whole dance. Returns a live access token for the user behind `cookie`. */
export async function mintOAuthToken(cookie: string): Promise<string> {
  const clientId = await registerOAuthClient();
  const { verifier, challenge } = pkcePair();
  const redirect = await authorizeAs(cookie, clientId, challenge);
  const code = redirect.searchParams.get("code");
  if (!code) throw new Error(`no code in redirect: ${redirect}`);
  const { access_token } = await exchangeCode(clientId, code, verifier);
  return access_token;
}

/** Push a token's expiry into the past (the plugin refuses expired tokens). */
export async function expireOAuthToken(accessToken: string): Promise<void> {
  await db
    .updateTable("oauth_access_tokens")
    .set({ access_token_expires_at: new Date(Date.now() - 60_000) })
    .where("access_token", "=", accessToken)
    .execute();
}
