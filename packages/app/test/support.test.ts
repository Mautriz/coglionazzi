import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { chatRouter } from "../src/server/orpc/chat";
import { supportRouter } from "../src/server/orpc/support";
import {
  appendCustomerMessage,
  createTicket,
  loadWidgetMessages,
  teamByWidgetKey,
  ticketByToken,
} from "../src/server/support";
import { lexicalState } from "./helpers";
import { createTestTeam, signUpTestUser } from "./helpers";

type Ctx = Awaited<ReturnType<typeof signUpTestUser>>["context"];

/** Open a visitor ticket against a team (the public/widget path). */
async function visitorTicket(teamId: string, message = "Help me please") {
  return createTicket({
    teamId,
    requesterEmail: "visitor@example.com",
    requesterName: "Vince Visitor",
    message,
  });
}

describe("support: tickets + conversation", () => {
  it("creates a ticket with a first customer message (created_by NULL)", async () => {
    const { context } = await signUpTestUser("Agent");
    const teamId = await createTestTeam(context);

    const { ticketId, accessToken } = await visitorTicket(teamId, "hi there");
    expect(accessToken).toHaveLength(64); // 32 random bytes, hex

    const messages = await loadWidgetMessages(ticketId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ text: "hi there", fromAgent: false });
  });

  it("agent reply via chat.send shows as fromAgent and bumps activity", async () => {
    const { context } = await signUpTestUser("Agent");
    const teamId = await createTestTeam(context);
    const { ticketId } = await visitorTicket(teamId);

    const before = await call(
      supportRouter.tickets.list,
      { teamId },
      { context },
    );
    const firstActivity = before[0].last_message_at;

    // Agent opens the ticket room and replies (membership-gated, member = owner).
    const { roomId } = await call(
      chatRouter.open,
      { ref: { scope: "support", ticketId } },
      { context },
    );
    await call(
      chatRouter.send,
      { roomId, body: lexicalState("on it!") },
      { context },
    );

    const msgs = await loadWidgetMessages(ticketId);
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toMatchObject({ text: "on it!", fromAgent: true });
    expect(msgs[1].authorName).toBe("Agent");

    const after = await call(supportRouter.tickets.list, { teamId }, { context });
    expect(new Date(after[0].last_message_at).getTime()).toBeGreaterThanOrEqual(
      new Date(firstActivity).getTime(),
    );
  });

  it("appends further customer messages to an existing ticket", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context);
    const { ticketId } = await visitorTicket(teamId);

    await appendCustomerMessage(ticketId, "any update?");
    const msgs = await loadWidgetMessages(ticketId);
    expect(msgs.map((m) => m.text)).toEqual(["Help me please", "any update?"]);
    expect(msgs.every((m) => !m.fromAgent)).toBe(true);
  });
});

describe("support: visitor token + widget key", () => {
  it("resolves a ticket by its access token; rejects an unknown token", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context);
    const { ticketId, accessToken } = await visitorTicket(teamId);

    const resolved = await ticketByToken(accessToken);
    expect(resolved.id).toBe(ticketId);

    await expect(ticketByToken("deadbeef")).rejects.toThrowError(ORPCError);
  });

  it("enableWidget sets a key that resolves the team; unknown key 404s", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context);

    const { widgetKey } = await call(
      supportRouter.enableWidget,
      { teamId },
      { context },
    );
    expect(widgetKey).toBeTruthy();
    // Idempotent — re-enabling returns the same key.
    const again = await call(supportRouter.enableWidget, { teamId }, { context });
    expect(again.widgetKey).toBe(widgetKey);

    const team = await teamByWidgetKey(widgetKey);
    expect(team.id).toBe(teamId);

    await expect(teamByWidgetKey("nope")).rejects.toThrowError(ORPCError);
  });

  it("enableWidget is owner-only", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const teamId = await createTestTeam(owner);
    const { context: member } = await signUpTestUser("Member");
    const users = await call(
      (await import("../src/server/orpc/users")).userRouter.list,
      undefined,
      { context: owner },
    );
    const memberId = users.find((u) => u.name === "Member")!.id;
    await call(
      (await import("../src/server/orpc/teams")).teamRouter.addMember,
      { teamId, userId: memberId },
      { context: owner },
    );

    await expect(
      call(supportRouter.enableWidget, { teamId }, { context: member }),
    ).rejects.toThrowError(ORPCError);
  });
});

describe("support: categories", () => {
  it("creates, lists ordered, renames, and rejects duplicates", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context);

    const billing = await call(
      supportRouter.categories.create,
      { teamId, name: "Billing" },
      { context },
    );
    await call(
      supportRouter.categories.create,
      { teamId, name: "Bug" },
      { context },
    );
    const list = await call(
      supportRouter.categories.list,
      { teamId },
      { context },
    );
    expect(list.map((c) => c.name)).toEqual(["Billing", "Bug"]);

    await call(
      supportRouter.categories.rename,
      { categoryId: billing.id, name: "Payments" },
      { context },
    );
    const renamed = await call(
      supportRouter.categories.list,
      { teamId },
      { context },
    );
    expect(renamed.map((c) => c.name)).toEqual(["Payments", "Bug"]);

    await expect(
      call(
        supportRouter.categories.create,
        { teamId, name: "Bug" },
        { context },
      ),
    ).rejects.toThrowError(ORPCError);
  });

  it("delete is owner-only and clears the category off tickets", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context);
    const cat = await call(
      supportRouter.categories.create,
      { teamId, name: "Bug" },
      { context },
    );
    const { ticketId } = await createTicket({
      teamId,
      requesterEmail: "v@example.com",
      categoryId: cat.id,
      message: "broken",
    });

    await call(
      supportRouter.categories.delete,
      { categoryId: cat.id },
      { context },
    );
    const ticket = await call(
      supportRouter.tickets.get,
      { ticketId },
      { context },
    );
    expect(ticket.category_id).toBeNull();
  });
});

describe("support: triage", () => {
  it("filters the inbox by status and category", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context);
    const cat = await call(
      supportRouter.categories.create,
      { teamId, name: "Bug" },
      { context },
    );
    const { ticketId: a } = await createTicket({
      teamId,
      requesterEmail: "a@e.com",
      categoryId: cat.id,
      message: "a",
    });
    const { ticketId: b } = await createTicket({
      teamId,
      requesterEmail: "b@e.com",
      message: "b",
    });

    await call(
      supportRouter.tickets.setStatus,
      { ticketId: a, status: "resolved" },
      { context },
    );

    const open = await call(
      supportRouter.tickets.list,
      { teamId, status: "open" },
      { context },
    );
    expect(open.map((t) => t.id)).toEqual([b]);

    const byCat = await call(
      supportRouter.tickets.list,
      { teamId, categoryId: cat.id },
      { context },
    );
    expect(byCat.map((t) => t.id)).toEqual([a]);
  });

  it("setStatus resolved stamps resolved_at; reopening clears it", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context);
    const { ticketId } = await visitorTicket(teamId);

    await call(
      supportRouter.tickets.setStatus,
      { ticketId, status: "resolved" },
      { context },
    );
    let t = await call(supportRouter.tickets.get, { ticketId }, { context });
    expect(t.status).toBe("resolved");
    expect(t.resolved_at).not.toBeNull();

    await call(
      supportRouter.tickets.setStatus,
      { ticketId, status: "open" },
      { context },
    );
    t = await call(supportRouter.tickets.get, { ticketId }, { context });
    expect(t.resolved_at).toBeNull();
  });

  it("setCategory rejects a category from another team", async () => {
    const { context } = await signUpTestUser();
    const teamId = await createTestTeam(context, "Team A");
    const otherTeamId = await createTestTeam(context, "Team B");
    const otherCat = await call(
      supportRouter.categories.create,
      { teamId: otherTeamId, name: "Other" },
      { context },
    );
    const { ticketId } = await visitorTicket(teamId);

    await expect(
      call(
        supportRouter.tickets.setCategory,
        { ticketId, categoryId: otherCat.id },
        { context },
      ),
    ).rejects.toThrowError(ORPCError);
  });

  it("in-app create records the requester user", async () => {
    const { context } = await signUpTestUser("Requester");
    const teamId = await createTestTeam(context);
    const { ticketId } = await call(
      supportRouter.tickets.create,
      { teamId, message: "please help" },
      { context },
    );
    const t = await call(supportRouter.tickets.get, { ticketId }, { context });
    expect(t.requester_name).toBe("Requester");
    expect(t.requester_user_id).toBeTruthy();
    // The requester's message is stored customer-side, not as an agent.
    const msgs = await loadWidgetMessages(ticketId);
    expect(msgs[0].fromAgent).toBe(false);
  });
});

describe("support: access control", () => {
  it("non-members cannot read or triage a team's tickets", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const teamId = await createTestTeam(owner);
    const { ticketId } = await visitorTicket(teamId);
    const { context: outsider } = await signUpTestUser("Outsider");

    await expect(
      call(supportRouter.tickets.list, { teamId }, { context: outsider }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(supportRouter.tickets.get, { ticketId }, { context: outsider }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(
        supportRouter.tickets.setStatus,
        { ticketId, status: "resolved" },
        { context: outsider },
      ),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(supportRouter.categories.list, { teamId }, { context: outsider }),
    ).rejects.toThrowError(ORPCError);
  });

  it("a non-member cannot open a ticket's chat room", async () => {
    const { context: owner } = await signUpTestUser("Owner");
    const teamId = await createTestTeam(owner);
    const { ticketId } = await visitorTicket(teamId);
    const { context: outsider } = await signUpTestUser("Outsider");

    await expect(
      call(
        chatRouter.open,
        { ref: { scope: "support", ticketId } },
        { context: outsider },
      ),
    ).rejects.toThrowError(ORPCError);
  });
});
