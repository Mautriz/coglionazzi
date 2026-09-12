import { describe, expect, it } from "vitest";
import { isAllowedOAuthRedirect } from "./oauthRedirects";

describe("isAllowedOAuthRedirect", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "http://localhost:5555/callback",
    "http://127.0.0.1:9797/callback",
    "http://[::1]:6274/oauth/callback",
  ])("allows %s", (uri) => {
    expect(isAllowedOAuthRedirect(uri)).toBe(true);
  });

  it.each([
    "https://evil.example/callback",
    "http://claude.ai/api/mcp/auth_callback",
    "https://claude.ai.evil.example/callback",
    "https://notclaude.ai/callback",
    // Exact host match only — a subdomain could host an open redirect.
    "https://app.claude.ai/callback",
    "https://localhost.evil.example/callback",
    "http://127.0.0.1:9797/cb,https://evil.example/callback",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (uri) => {
    expect(isAllowedOAuthRedirect(uri)).toBe(false);
  });
});
