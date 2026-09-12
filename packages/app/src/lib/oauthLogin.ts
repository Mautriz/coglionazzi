import { useLocation } from "@tanstack/react-router";
import { authClient } from "./authClient";

/** better-auth's mcp plugin sends a logged-out user to /auth/login with the
 *  WHOLE authorize query attached (client_id, redirect_uri, state, PKCE…).
 *  When that query is present, this is where to send the user once they are
 *  signed in: the authorize endpoint sees the session, mints a code and
 *  redirects the browser back to the OAuth client (claude.ai / Claude Code).
 *  Null on an ordinary login. */
export function useOAuthContinueUrl(): string | null {
  const { searchStr } = useLocation();
  const params = new URLSearchParams(searchStr);
  if (!params.has("client_id") || !params.has("redirect_uri")) return null;
  return `/api/auth/mcp/authorize?${params.toString()}`;
}

/** Finish an OAuth-initiated login. A FULL navigation, not `router.navigate`:
 *  the authorize endpoint answers with a redirect to another origin. */
export function continueOAuthFlow(continueUrl: string): void {
  window.location.assign(continueUrl);
}

/** The plugin's after-login hook answers the sign-in request ITSELF with a
 *  302 to the OAuth client's callback carrying a code. The browser's fetch
 *  follows that redirect but cannot read the cross-origin response, so the
 *  sign-in call reports an error even though the session cookie was set. On
 *  error, then, ask the server whether we ARE signed in and, if so, continue
 *  the flow. Returns true when it took over.
 *
 *  Consequence worth knowing: that background fetch has already delivered one
 *  code to the client, and the navigation below mints a second. Both go to the
 *  registered redirect URI, so this is safe — but a loopback client that shuts
 *  its listener down after the first code leaves the user's tab on a dead
 *  127.0.0.1 URL. The connection has succeeded by then. Suppressing the first
 *  code would need `redirect: "manual"` on the sign-in fetch, which is only
 *  worth doing once someone can test it in a real browser. */
export async function continueOAuthIfSignedIn(
  continueUrl: string,
): Promise<boolean> {
  const { data } = await authClient.getSession();
  if (!data?.session) return false;
  continueOAuthFlow(continueUrl);
  return true;
}
