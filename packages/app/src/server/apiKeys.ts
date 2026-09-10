import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";

/** Marks a token as ours, so we never hash an unrelated bearer credential. */
export const API_KEY_PREFIX = "ins_";

/** Characters of the token kept in clear for display (`ins_` + 8). */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

/** How stale `last_used_at` may get. Without this every external request
 *  would turn a read into a write. */
const LAST_USED_THROTTLE_MS = 60_000;

/** SHA-256, hex. Deliberately NOT a password hash: the token is 256 bits of
 *  randomness rather than something guessable, so key-stretching buys nothing,
 *  and this runs on every external request. The unique index on `key_hash`
 *  makes verification a single indexed lookup. */
export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint a new key. The token is returned ONCE — only its hash is stored. */
export function generateApiKey(): {
  token: string;
  hash: string;
  prefix: string;
} {
  const token = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    hash: hashApiKey(token),
    prefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

/** Pull one of OUR bearer tokens out of an Authorization header. Returns null
 *  for a missing header, a different scheme, or a bearer token that isn't
 *  ours (so an unrelated credential is never hashed and looked up). */
export function bearerToken(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;

  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer") return null;

  const token = rest.join(" ").trim();
  if (!token.startsWith(API_KEY_PREFIX)) return null;

  return token;
}

/** Resolve a token to its owner, or null when unknown or revoked. */
export async function resolveApiKey(
  token: string,
): Promise<{ keyId: string; userId: string } | null> {
  const row = await db
    .selectFrom("api_keys")
    .where("key_hash", "=", hashApiKey(token))
    .where("revoked_at", "is", null)
    .select(["id", "user_id", "last_used_at"])
    .executeTakeFirst();

  if (!row) return null;

  await touchLastUsed(row.id, row.last_used_at);

  return { keyId: row.id, userId: row.user_id };
}

/** Record usage at most once a minute per key. */
async function touchLastUsed(
  keyId: string,
  lastUsedAt: Date | null,
): Promise<void> {
  const stale =
    !lastUsedAt || Date.now() - lastUsedAt.getTime() > LAST_USED_THROTTLE_MS;
  if (!stale) return;

  await db
    .updateTable("api_keys")
    .set({ last_used_at: new Date() })
    .where("id", "=", keyId)
    .execute();
}
