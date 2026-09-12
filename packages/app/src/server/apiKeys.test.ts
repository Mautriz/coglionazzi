import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  bearerToken,
  generateApiKey,
  hashApiKey,
} from "./apiKeys";

describe("generateApiKey", () => {
  it("issues a token carrying the app's recognisable prefix", () => {
    const { token } = generateApiKey();

    expect(token.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("issues a different token every time", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateApiKey().token),
    );

    expect(tokens.size).toBe(50);
  });

  it("returns the SHA-256 of the token as its hash", () => {
    const { token, hash } = generateApiKey();

    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("returns a display prefix that is a leading slice of the token", () => {
    const { token, prefix } = generateApiKey();

    expect(token.startsWith(prefix)).toBe(true);
    expect(prefix.length).toBeLessThan(token.length);
  });

  it("carries at least 256 bits of entropy in the random part", () => {
    const { token } = generateApiKey();
    const random = token.slice(API_KEY_PREFIX.length);

    // base64url: 4 chars per 3 bytes, so 32 bytes ⇒ 43 chars unpadded.
    expect(random.length).toBeGreaterThanOrEqual(43);
  });
});

describe("hashApiKey", () => {
  it("is stable for the same token", () => {
    expect(hashApiKey("ins_abc")).toBe(hashApiKey("ins_abc"));
  });

  it("differs for different tokens", () => {
    expect(hashApiKey("ins_abc")).not.toBe(hashApiKey("ins_abd"));
  });
});

describe("bearerToken", () => {
  it("reads a bearer token out of the Authorization header", () => {
    const headers = new Headers({ authorization: "Bearer ins_secret" });

    expect(bearerToken(headers)).toBe("ins_secret");
  });

  it("accepts the scheme case-insensitively", () => {
    const headers = new Headers({ authorization: "bearer ins_secret" });

    expect(bearerToken(headers)).toBe("ins_secret");
  });

  it("returns null when there is no Authorization header", () => {
    expect(bearerToken(new Headers())).toBeNull();
  });

  it("ignores a non-bearer scheme", () => {
    const headers = new Headers({ authorization: "Basic abc123" });

    expect(bearerToken(headers)).toBeNull();
  });

  it("returns a bearer token that is not one of ours (OAuth tokens too)", () => {
    const headers = new Headers({ authorization: "Bearer oauth_opaque_xyz" });

    expect(bearerToken(headers)).toBe("oauth_opaque_xyz");
  });

  it("ignores an empty bearer token", () => {
    const headers = new Headers({ authorization: "Bearer   " });

    expect(bearerToken(headers)).toBeNull();
  });
});
