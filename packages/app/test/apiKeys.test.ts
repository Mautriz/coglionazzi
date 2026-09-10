import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { db } from "../src/server/db";
import { resolveApiKey } from "../src/server/apiKeys";
import { resolveHttpCaller } from "../src/server/httpCaller";
import { apiKeyRouter } from "../src/server/orpc/apiKeys";
import { resolveSession } from "../src/server/orpc/base";
import { teamRouter } from "../src/server/orpc/teams";
import type { ORPCContext } from "../src/server/orpc/base";
import { signUpTestUser } from "./helpers";

/** Mint a key for the context's user and return its plaintext token. */
async function mintKey(context: ORPCContext, name = "bot") {
  return call(apiKeyRouter.create, { name }, { context });
}

/** An oRPC context authenticated ONLY by an API key — no cookie. */
const keyContext = (token: string): ORPCContext => ({
  reqHeaders: new Headers({ authorization: `Bearer ${token}` }),
  resHeaders: new Headers(),
});

describe("resolveApiKey", () => {
  it("resolves a freshly minted key to its owner", async () => {
    const { context, userId } = await signUpTestUser("owner");
    const { token } = await mintKey(context);

    await expect(resolveApiKey(token)).resolves.toMatchObject({ userId });
  });

  it("rejects a token that was never issued", async () => {
    await expect(resolveApiKey("ins_nonsense")).resolves.toBeNull();
  });

  it("rejects a revoked key", async () => {
    const { context } = await signUpTestUser("owner");
    const created = await mintKey(context);

    await call(apiKeyRouter.revoke, { id: created.id }, { context });

    await expect(resolveApiKey(created.token)).resolves.toBeNull();
  });

  it("records usage on first use", async () => {
    const { context } = await signUpTestUser("owner");
    const created = await mintKey(context);

    await resolveApiKey(created.token);

    const row = await db
      .selectFrom("api_keys")
      .where("id", "=", created.id)
      .select("last_used_at")
      .executeTakeFirstOrThrow();
    expect(row.last_used_at).not.toBeNull();
  });
});

describe("API keys as an oRPC identity", () => {
  it("resolves a session for a bearer-key request", async () => {
    const { context, userId } = await signUpTestUser("owner");
    const { token } = await mintKey(context);

    const resolved = await resolveSession(keyContext(token));

    expect(resolved?.user.id).toBe(userId);
  });

  it("marks a key-resolved caller as such", async () => {
    const { context } = await signUpTestUser("owner");
    const { token } = await mintKey(context);

    const resolved = await resolveSession(keyContext(token));

    expect(resolved?.viaApiKey).toBe(true);
  });

  it("lets a key call an authenticated procedure as its owner", async () => {
    const { context } = await signUpTestUser("owner");
    await call(teamRouter.create, { name: "Mine" }, { context });
    const { token } = await mintKey(context);

    const teams = await call(teamRouter.list, undefined, {
      context: keyContext(token),
    });

    expect(teams.map((t) => t.name)).toContain("Mine");
  });

  it("refuses an authenticated procedure for a revoked key", async () => {
    const { context } = await signUpTestUser("owner");
    const created = await mintKey(context);
    await call(apiKeyRouter.revoke, { id: created.id }, { context });

    await expect(
      call(teamRouter.list, undefined, { context: keyContext(created.token) }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("sees only the teams its owner belongs to", async () => {
    const { context: strangerCtx } = await signUpTestUser("stranger");
    await call(teamRouter.create, { name: "Not yours" }, { context: strangerCtx });

    const { context } = await signUpTestUser("owner");
    const { token } = await mintKey(context);

    const teams = await call(teamRouter.list, undefined, {
      context: keyContext(token),
    });

    expect(teams.map((t) => t.name)).not.toContain("Not yours");
  });
});

describe("resolveHttpCaller", () => {
  it("resolves a bearer key on a plain HTTP route", async () => {
    const { context, userId } = await signUpTestUser("owner");
    const { token } = await mintKey(context);

    const caller = await resolveHttpCaller(
      new Request("http://localhost/api/files", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(caller).toEqual({ userId, via: "apiKey" });
  });

  it("returns null for an unauthenticated request", async () => {
    const caller = await resolveHttpCaller(
      new Request("http://localhost/api/files"),
    );

    expect(caller).toBeNull();
  });
});

describe("apiKey management", () => {
  it("returns the plaintext token exactly once, at creation", async () => {
    const { context } = await signUpTestUser("owner");
    const created = await mintKey(context);

    expect(created.token.startsWith("ins_")).toBe(true);

    const listed = await call(apiKeyRouter.list, undefined, { context });
    expect(listed[0]).not.toHaveProperty("token");
    expect(listed[0]).not.toHaveProperty("key_hash");
    expect(listed[0]).not.toHaveProperty("keyHash");
  });

  it("lists the caller's keys with their display prefix", async () => {
    const { context } = await signUpTestUser("owner");
    const created = await mintKey(context, "my bot");

    const listed = await call(apiKeyRouter.list, undefined, { context });

    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe("my bot");
    expect(created.token.startsWith(listed[0].prefix)).toBe(true);
  });

  it("never lists another user's keys", async () => {
    const { context: ownerCtx } = await signUpTestUser("owner");
    await mintKey(ownerCtx, "owner key");

    const { context: strangerCtx } = await signUpTestUser("stranger");
    const listed = await call(apiKeyRouter.list, undefined, {
      context: strangerCtx,
    });

    expect(listed).toHaveLength(0);
  });

  it("hides revoked keys from the list", async () => {
    const { context } = await signUpTestUser("owner");
    const created = await mintKey(context);

    await call(apiKeyRouter.revoke, { id: created.id }, { context });

    const listed = await call(apiKeyRouter.list, undefined, { context });
    expect(listed).toHaveLength(0);
  });

  it("refuses to revoke someone else's key", async () => {
    const { context: ownerCtx } = await signUpTestUser("owner");
    const created = await mintKey(ownerCtx);

    const { context: strangerCtx } = await signUpTestUser("stranger");

    await expect(
      call(apiKeyRouter.revoke, { id: created.id }, { context: strangerCtx }),
    ).rejects.toThrow(ORPCError);

    // ...and the key still works for its owner.
    await expect(resolveApiKey(created.token)).resolves.not.toBeNull();
  });

  it("requires a logged-in user to mint a key", async () => {
    await expect(
      call(
        apiKeyRouter.create,
        { name: "x" },
        { context: { reqHeaders: new Headers(), resHeaders: new Headers() } },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
