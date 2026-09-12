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

/** The plugin's after-login hook may answer the sign-in request itself with a
 *  redirect to the OAuth client, which the browser's fetch cannot follow
 *  cross-origin — the call then reports an error even though the session
 *  cookie was set. So on error, ask the server whether we ARE signed in and,
 *  if so, continue the flow. Returns true when it took over. */
export async function continueOAuthIfSignedIn(
  continueUrl: string,
): Promise<boolean> {
  const { data } = await authClient.getSession();
  if (!data?.session) return false;
  continueOAuthFlow(continueUrl);
  return true;
}
