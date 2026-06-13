import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { globalPresenceRouter } from "../src/server/orpc/globalPresence";
import { signUpTestUser } from "./helpers";

/** Drive an async iterator's next() but reject if nothing arrives in time. */
function nextWithin<T>(iter: AsyncIterator<T>, ms: number): Promise<T> {
  return Promise.race([
    iter.next().then((r) => r.value as T),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("no event within timeout")), ms),
    ),
  ]);
}

/** Let a freshly-started subscription reach its publisher.subscribe loop
 *  before we publish, avoiding a race. */
const settle = () => new Promise((r) => setTimeout(r, 40));

describe("globalPresence.subscribe", () => {
  it("yields the current roster immediately, including the caller", async () => {
    const { context } = await signUpTestUser("Solo");

    const ac = new AbortController();
    const iter = await call(globalPresenceRouter.subscribe, undefined, {
      context,
      signal: ac.signal,
    });
    const first = await nextWithin(iter, 2000);
    expect(first.map((v) => v.name)).toContain("Solo");

    ac.abort();
    await iter.return?.(undefined);
  });

  it("notifies an existing subscriber when another user connects", async () => {
    const { context: a } = await signUpTestUser("Ayy");

    const acA = new AbortController();
    const iterA = await call(globalPresenceRouter.subscribe, undefined, {
      context: a,
      signal: acA.signal,
    });
    await nextWithin(iterA, 2000); // consume A's initial snapshot

    const pending = nextWithin(iterA, 2000);
    await settle();

    const { context: b } = await signUpTestUser("Bee");
    const acB = new AbortController();
    const iterB = await call(globalPresenceRouter.subscribe, undefined, {
      context: b,
      signal: acB.signal,
    });
    // Driving B's first next() runs its body (joinGlobalPresence), which is
    // what notifies A — a generator procedure doesn't run until iterated.
    const firstB = nextWithin(iterB, 2000);

    const roster = await pending;
    await firstB;
    expect(roster.map((v) => v.name)).toEqual(
      expect.arrayContaining(["Ayy", "Bee"]),
    );

    acA.abort();
    acB.abort();
    await iterA.return?.(undefined);
    await iterB.return?.(undefined);
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      call(globalPresenceRouter.subscribe, undefined, {
        context: { reqHeaders: new Headers(), resHeaders: new Headers() },
      }),
    ).rejects.toThrow();
  });
});
