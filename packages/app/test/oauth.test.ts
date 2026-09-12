import { call } from "@orpc/server";
import {
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
} from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { resolveHttpCaller } from "../src/server/httpCaller";
import type { ORPCContext } from "../src/server/orpc/base";
import { teamRouter } from "../src/server/orpc/teams";
import { createTestTeam, signUpTestUser } from "./helpers";
import {
  AUTH_ORIGIN,
  REDIRECT_URI,
  authorizeAs,
  cookieOf,
  exchangeCode,
  expireOAuthToken,
  mintOAuthToken,
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
    // Effectively forever — a connector must not silently stop working.
    expect(token.expires_in).toBe(60 * 60 * 24 * 365 * 10);

    const grant = await auth.api.getMcpSession({
      headers: new Headers({ authorization: `Bearer ${token.access_token}` }),
    });
    expect(grant?.userId).toBe(userId);
  });

  it("refuses to issue a code to a redirect_uri the client never registered", async () => {
    // The allowlist only protects registration; everything downstream rests on
    // better-auth exact-matching redirect_uri against the stored list. If that
    // ever regressed, the guard would be worthless — so pin it here.
    const { context } = await signUpTestUser("ivy");
    const clientId = await registerOAuthClient();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "https://evil.example/cb",
      response_type: "code",
      scope: "openid profile email",
      state: "s",
      code_challenge: pkcePair().challenge,
      code_challenge_method: "S256",
    });

    const res = await auth.handler(
      new Request(`${AUTH_ORIGIN}/api/auth/mcp/authorize?${params}`, {
        headers: { cookie: cookieOf(context) },
      }),
    );

    // Assert the specific branch, not just "no code anywhere": an unregistered
    // redirect_uri is a hard 400 with no redirect at all.
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still issues a code to a client that omits PKCE", async () => {
    // Deliberate: requiring PKCE turned real connectors away, and our metadata
    // only advertises that we SUPPORT S256. PKCE is still verified when sent
    // (see the wrong-verifier test below).
    const { context } = await signUpTestUser("jack");
    const clientId = await registerOAuthClient();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid profile email",
      state: "s",
    });

    const res = await auth.handler(
      new Request(`${AUTH_ORIGIN}/api/auth/mcp/authorize?${params}`, {
        headers: { cookie: cookieOf(context) },
      }),
    );

    expect(res.headers.get("location") ?? "").toContain("code=");
  });

  it("registers a client as public when it does not say otherwise", async () => {
    // better-auth would default to client_secret_basic, and the secret-less
    // exchange an MCP client performs would then fail with
    // "client_secret is required for confidential clients".
    const res = await auth.handler(
      new Request(`${AUTH_ORIGIN}/api/auth/mcp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "No auth method declared",
          redirect_uris: [REDIRECT_URI],
        }),
      }),
    );

    const body = (await res.json()) as {
      token_endpoint_auth_method: string;
      client_secret?: string;
    };
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.client_secret ?? "").toBe("");
  });

  it("completes a token exchange for a client that never declared itself public", async () => {
    const { context, userId } = await signUpTestUser("kim");
    const registered = await auth.handler(
      new Request(`${AUTH_ORIGIN}/api/auth/mcp/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Connector",
          redirect_uris: [REDIRECT_URI],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      }),
    );
    const { client_id: clientId } = (await registered.json()) as {
      client_id: string;
    };
    const { verifier, challenge } = pkcePair();
    const code = (await authorizeAs(cookieOf(context), clientId, challenge))
      .searchParams.get("code")!;

    const token = await exchangeCode(clientId, code, verifier);

    const grant = await auth.api.getMcpSession({
      headers: new Headers({ authorization: `Bearer ${token.access_token}` }),
    });
    expect(grant?.userId).toBe(userId);
  });

  it("keeps verifying PKCE when the client does send it", async () => {
    const { context } = await signUpTestUser("liam");
    const clientId = await registerOAuthClient();
    const { challenge } = pkcePair();
    const code = (await authorizeAs(cookieOf(context), clientId, challenge))
      .searchParams.get("code")!;

    await expect(
      exchangeCode(clientId, code, "not-the-verifier"),
    ).rejects.toThrow(/token failed/);
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

const bearerContext = (token: string, extra: HeadersInit = {}): ORPCContext => ({
  reqHeaders: new Headers({ authorization: `Bearer ${token}`, ...extra }),
  resHeaders: new Headers(),
});

describe("OAuth access tokens as an auth transport", () => {
  it("authenticates oRPC procedures as the token's user", async () => {
    const { context } = await signUpTestUser("carol");
    const teamId = await createTestTeam(context, "Carol's team");
    const token = await mintOAuthToken(cookieOf(context));

    const teams = await call(teamRouter.list, {}, { context: bearerContext(token) });

    expect(teams.map((t) => t.id)).toContain(teamId);
  });

  it("refuses an expired token", async () => {
    const { context } = await signUpTestUser("dave");
    const token = await mintOAuthToken(cookieOf(context));
    await expireOAuthToken(token);

    await expect(
      call(teamRouter.list, {}, { context: bearerContext(token) }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("does not fall back to the session cookie when the bearer token is bad", async () => {
    const { context } = await signUpTestUser("erin");

    await expect(
      call(teamRouter.list, {}, {
        context: bearerContext("not-a-real-token", { cookie: cookieOf(context) }),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("identifies plain-HTTP callers (files route) by OAuth token", async () => {
    const { context, userId } = await signUpTestUser("frank");
    const token = await mintOAuthToken(cookieOf(context));

    const caller = await resolveHttpCaller(
      new Request("http://localhost/api/files?fileId=x", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(caller).toEqual({ userId, via: "oauth" });
  });
});
