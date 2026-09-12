/** Hosts an OAuth client may send authorization codes to. Registration is
 *  anonymous and there is no consent screen, so THIS is what stops a rogue
 *  client from collecting codes: a code can only ever land on Anthropic's
 *  callback (claude.ai binds the flow to the user who started it) or on the
 *  user's own machine (Claude Code, the MCP inspector).
 *
 *  EXACT host match, no subdomains: real clients only ever use
 *  `https://claude.ai/api/mcp/auth_callback`, so a wildcard would buy nothing
 *  and would forward codes off-platform if any subdomain ever hosted an open
 *  redirect or user content. Adding a host means editing this list. */
export const OAUTH_REDIRECT_HOSTS = ["claude.ai", "claude.com"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when `uri` is an acceptable `redirect_uri` for a registering client:
 *  https on exactly one of the allowed hosts, or http/https on loopback with
 *  any port. Anything unparsable is refused. */
export function isAllowedOAuthRedirect(uri: string): boolean {
  // better-auth stores the whole list as `redirect_uris.join(",")` and splits
  // it back on "," at authorize time, so a comma INSIDE one entry silently
  // registers two URIs — and only the first would be checked here. A comma is
  // a legal path character, so this must be refused explicitly.
  if (uri.includes(",")) return false;

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }

  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  if (url.protocol !== "https:") return false;
  return OAUTH_REDIRECT_HOSTS.some((host) => url.hostname === host);
}
