import {
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
} from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { signUpTestUser } from "./helpers";
import {
  AUTH_ORIGIN,
  REDIRECT_URI,
  authorizeAs,
  cookieOf,
  exchangeCode,
  pkcePair,
  registerOAuthClient,
} from "./oauthHelpers";

describe("OAuth authorization server (better-auth mcp plugin)", () => {
  it("registers a client anonymously (dynamic client registration)", async () => {
    const clientId = await registerOAuthClient();

    expect(clientId).toMatch(/^[A-Za-z]{32}$/);
  });

  it("sends a logged-out user to the login page with the authorize query", async () => {
    const clientId = await registerOAuthClient();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid profile email",
      state: "s",
      code_challenge: pkcePair().challenge,
      code_challenge_method: "S256",
    });

    const res = await auth.handler(
      new Request(`${AUTH_ORIGIN}/api/auth/mcp/authorize?${params}`),
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!, AUTH_ORIGIN);
    expect(location.pathname).toBe("/auth/login");
    expect(location.searchParams.get("client_id")).toBe(clientId);
    expect(location.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("issues a code to a logged-in user and exchanges it for a token bound to that user", async () => {
    const { context, userId } = await signUpTestUser("alice");
    const clientId = await registerOAuthClient();
    const { verifier, challenge } = pkcePair();

    const redirect = await authorizeAs(
      cookieOf(context),
      clientId,
      challenge,
      "xyz",
    );

    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get("state")).toBe("xyz");
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await exchangeCode(clientId, code!, verifier);
    expect(token.access_token).toBeTruthy();
    expect(token.refresh_token).toBeTruthy();
    expect(token.expires_in).toBe(60 * 60 * 24 * 30);

    const grant = await auth.api.getMcpSession({
      headers: new Headers({ authorization: `Bearer ${token.access_token}` }),
    });
    expect(grant?.userId).toBe(userId);
  });

  it("rejects a code exchange with the wrong PKCE verifier", async () => {
    const { context } = await signUpTestUser("bob");
    const clientId = await registerOAuthClient();
    const { challenge } = pkcePair();
    const code = (
      await authorizeAs(cookieOf(context), clientId, challenge)
    ).searchParams.get("code")!;

    await expect(
      exchangeCode(clientId, code, "not-the-verifier"),
    ).rejects.toThrow(/token failed/);
  });

  it("refuses to register a client whose redirect URI is not Anthropic's or loopback", async () => {
    const res = await auth.handler(
      new Request(`${AUTH_ORIGIN}/api/auth/mcp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Phisher",
          redirect_uris: [REDIRECT_URI, "https://evil.example/callback"],
          token_endpoint_auth_method: "none",
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/redirect/i);
  });

  it("registers a client for claude.ai's callback", async () => {
    const res = await auth.handler(
      new Request(`${AUTH_ORIGIN}/api/auth/mcp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
          token_endpoint_auth_method: "none",
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect((await res.json()).redirect_uris).toEqual([
      "https://claude.ai/api/mcp/auth_callback",
    ]);
  });

  it("refuses a redirect URI that smuggles a second URL after a comma", async () => {
    const res = await auth.handler(
      new Request(`${AUTH_ORIGIN}/api/auth/mcp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Comma smuggler",
          // better-auth stores the list comma-joined and splits it back at
          // authorize time, so a comma inside ONE entry registers two URIs.
          redirect_uris: [`${REDIRECT_URI},https://evil.example/callback`],
          token_endpoint_auth_method: "none",
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/redirect/i);
  });
});

describe("OAuth discovery documents", () => {
  it("authorization-server metadata points at the mcp plugin endpoints", async () => {
    const res = await oAuthDiscoveryMetadata(auth)(
      new Request(`${AUTH_ORIGIN}/.well-known/oauth-authorization-server`),
    );
    const meta = await res.json();

    expect(meta.issuer).toBe(AUTH_ORIGIN);
    expect(meta.authorization_endpoint).toBe(
      `${AUTH_ORIGIN}/api/auth/mcp/authorize`,
    );
    expect(meta.token_endpoint).toBe(`${AUTH_ORIGIN}/api/auth/mcp/token`);
    expect(meta.registration_endpoint).toBe(
      `${AUTH_ORIGIN}/api/auth/mcp/register`,
    );
    expect(meta.code_challenge_methods_supported).toContain("S256");
  });

  it("protected-resource metadata names the MCP endpoint and our origin as its server", async () => {
    const res = await oAuthProtectedResourceMetadata(auth)(
      new Request(`${AUTH_ORIGIN}/.well-known/oauth-protected-resource`),
    );
    const meta = await res.json();

    expect(meta.resource).toBe(`${AUTH_ORIGIN}/api/mcp`);
    expect(meta.authorization_servers).toEqual([AUTH_ORIGIN]);
  });
});
