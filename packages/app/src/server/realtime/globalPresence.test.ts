import { describe, expect, it } from "vitest";
import { globalPresenceSnapshot, joinGlobalPresence } from "./globalPresence";

const viewer = (userId: string, name = userId) => ({
  userId,
  name,
  image: null,
});

describe("globalPresence", () => {
  it("registers a viewer in the snapshot", () => {
    const leave = joinGlobalPresence(viewer("u1"));
    try {
      expect(globalPresenceSnapshot().map((v) => v.userId)).toContain("u1");
    } finally {
      leave();
    }
  });

  it("dedupes multiple connections from the same user to one entry", () => {
    const leaveA = joinGlobalPresence(viewer("dup"));
    const leaveB = joinGlobalPresence(viewer("dup"));
    try {
      const dupEntries = globalPresenceSnapshot().filter(
        (v) => v.userId === "dup",
      );
      expect(dupEntries).toHaveLength(1);
    } finally {
      leaveA();
      leaveB();
    }
  });

  it("keeps the user present until the last connection leaves", () => {
    const leaveA = joinGlobalPresence(viewer("multi"));
    const leaveB = joinGlobalPresence(viewer("multi"));
    leaveA();
    expect(globalPresenceSnapshot().map((v) => v.userId)).toContain("multi");
    leaveB();
    expect(globalPresenceSnapshot().map((v) => v.userId)).not.toContain(
      "multi",
    );
  });

  it("removes the viewer once they leave", () => {
    const leave = joinGlobalPresence(viewer("gone"));
    leave();
    expect(globalPresenceSnapshot().map((v) => v.userId)).not.toContain("gone");
  });

  it("is idempotent if leave is called twice", () => {
    const leaveA = joinGlobalPresence(viewer("same"));
    const leaveB = joinGlobalPresence(viewer("same"));
    leaveA();
    leaveA(); // second call must not evict the still-present second connection
    expect(globalPresenceSnapshot().map((v) => v.userId)).toContain("same");
    leaveB();
  });
});
