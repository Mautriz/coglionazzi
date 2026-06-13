import { call, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { boardRouter } from "../src/server/orpc/boards";
import { chatRouter } from "../src/server/orpc/chat";
import { searchRouter } from "../src/server/orpc/search";
import { teamRouter } from "../src/server/orpc/teams";
import { userRouter } from "../src/server/orpc/users";
import { createTestTeam, signUpTestUser } from "./helpers";

describe("teams", () => {
  it("creates a team with the creator as owner member", async () => {
    const { context } = await signUpTestUser("Owner");
    const teamId = await createTestTeam(context, "My team");

    const teams = await call(teamRouter.list, undefined, { context });
    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe(teamId);
    expect(teams[0].isOwner).toBe(true);
    expect(teams[0].memberCount).toBe(1);

    const members = await call(teamRouter.members, { teamId }, { context });
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
  });

  it("list shows only teams you belong to", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    await createTestTeam(alice, "Alice team");

    expect(await call(teamRouter.list, undefined, { context: bob })).toHaveLength(
      0,
    );
  });

  it("a member can add another user, who then sees the team", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const teamId = await createTestTeam(alice, "Crew");
    const users = await call(userRouter.list, undefined, { context: alice });
    const bobId = users.find((u) => u.name === "Bob")!.id;

    await call(teamRouter.addMember, { teamId, userId: bobId }, { context: alice });

    const bobTeams = await call(teamRouter.list, undefined, { context: bob });
    expect(bobTeams.map((t) => t.id)).toContain(teamId);
    expect(bobTeams[0].isOwner).toBe(false);
  });

  it("non-members can't read a team's members", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const teamId = await createTestTeam(alice);

    await expect(
      call(teamRouter.members, { teamId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
  });

  it("only the owner can rename/delete; members can't", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const teamId = await createTestTeam(alice);
    const users = await call(userRouter.list, undefined, { context: alice });
    const bobId = users.find((u) => u.name === "Bob")!.id;
    await call(teamRouter.addMember, { teamId, userId: bobId }, { context: alice });

    await expect(
      call(teamRouter.rename, { teamId, name: "Nope" }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(teamRouter.delete, { teamId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);

    // Owner can.
    await call(teamRouter.rename, { teamId, name: "Renamed" }, { context: alice });
    const teams = await call(teamRouter.list, undefined, { context: alice });
    expect(teams[0].name).toBe("Renamed");
  });

  it("a member can leave; the owner can't", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const teamId = await createTestTeam(alice);
    const users = await call(userRouter.list, undefined, { context: alice });
    const bobId = users.find((u) => u.name === "Bob")!.id;
    await call(teamRouter.addMember, { teamId, userId: bobId }, { context: alice });

    await call(teamRouter.leave, { teamId }, { context: bob });
    expect(await call(teamRouter.list, undefined, { context: bob })).toHaveLength(
      0,
    );

    await expect(
      call(teamRouter.leave, { teamId }, { context: alice }),
    ).rejects.toThrowError(ORPCError);
  });
});

describe("board access control", () => {
  async function boardInTeam(context: Awaited<ReturnType<typeof signUpTestUser>>["context"]) {
    const teamId = await createTestTeam(context);
    const { id: boardId } = await call(
      boardRouter.create,
      { teamId, name: "Secret board" },
      { context },
    );
    const board = await call(boardRouter.get, { boardId }, { context });
    return { teamId, boardId, columnId: board.columns[0].id };
  }

  it("board.list only returns boards from your teams", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    await boardInTeam(alice);

    expect(await call(boardRouter.list, undefined, { context: bob })).toHaveLength(
      0,
    );
    const aliceBoards = await call(boardRouter.list, undefined, { context: alice });
    expect(aliceBoards).toHaveLength(1);
    expect(aliceBoards[0].teamName).toBe("Test team");
  });

  it("a non-member can't get, mutate, or open a card's thread", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const { boardId, columnId } = await boardInTeam(alice);
    const { id: cardId } = await call(
      boardRouter.createCard,
      { columnId, title: "card" },
      { context: alice },
    );

    await expect(
      call(boardRouter.get, { boardId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(boardRouter.createCard, { columnId, title: "x" }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(boardRouter.updateCard, { cardId, title: "x" }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(boardRouter.deleteBoard, { boardId }, { context: bob }),
    ).rejects.toThrowError(ORPCError);
    await expect(
      call(
        chatRouter.open,
        { ref: { scope: "card", cardId } },
        { context: bob },
      ),
    ).rejects.toThrowError(ORPCError);
  });

  it("once added to the team, the user gains access", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const { teamId, boardId } = await boardInTeam(alice);
    const users = await call(userRouter.list, undefined, { context: alice });
    const bobId = users.find((u) => u.name === "Bob")!.id;

    await call(teamRouter.addMember, { teamId, userId: bobId }, { context: alice });

    const board = await call(boardRouter.get, { boardId }, { context: bob });
    expect(board.name).toBe("Secret board");
  });

  it("search only surfaces results from your teams", async () => {
    const { context: alice } = await signUpTestUser("Alice");
    const { context: bob } = await signUpTestUser("Bob");
    const { columnId } = await boardInTeam(alice);
    await call(
      boardRouter.createCard,
      { columnId, title: "uniquetoken party" },
      { context: alice },
    );

    const aliceHits = await call(
      searchRouter.global,
      { query: "uniquetoken" },
      { context: alice },
    );
    expect(aliceHits.cards.length).toBeGreaterThan(0);

    const bobHits = await call(
      searchRouter.global,
      { query: "uniquetoken" },
      { context: bob },
    );
    expect(bobHits.cards).toHaveLength(0);
  });
});
