import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { sql } from "kysely";
import { z } from "zod";
import { db } from "../db";
import { publisher, publishSupportChanged } from "../realtime/publisher";
import {
  createTicket as createTicketSvc,
  listCategories,
} from "../support";
import { authP } from "./base";
import { assertTeamMember, assertTeamOwner } from "./teamAccess";

/** The agent-facing support API (the team's inbox). The public, unauthenticated
 *  visitor endpoints live in `routes/api/support/*`; shared logic is in
 *  `server/support.ts`. */

const STATUS = z.enum(["open", "resolved"]);

/** Resolve the team a ticket belongs to (NOT_FOUND if gone). */
async function teamIdOfTicket(ticketId: string): Promise<string> {
  const row = await db
    .selectFrom("support_tickets")
    .where("id", "=", ticketId)
    .select("team_id")
    .executeTakeFirst();
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Ticket not found" });
  return row.team_id;
}

/** Resolve the team a category belongs to (NOT_FOUND if gone). */
async function teamIdOfCategory(categoryId: string): Promise<string> {
  const row = await db
    .selectFrom("support_categories")
    .where("id", "=", categoryId)
    .select("team_id")
    .executeTakeFirst();
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Category not found" });
  return row.team_id;
}

export const supportRouter = {
  /** The team's embeddable widget key (members). Null until enabled. */
  widgetKey: authP
    .input(z.object({ teamId: z.uuid() }))
    .handler(async (info) => {
      await assertTeamMember(info.context.user.id, info.input.teamId);
      const row = await db
        .selectFrom("teams")
        .where("id", "=", info.input.teamId)
        .select("widget_key")
        .executeTakeFirst();
      return { widgetKey: row?.widget_key ?? null };
    }),

  /** Generate the widget key if unset (owner-only); returns the current key. */
  enableWidget: authP
    .input(z.object({ teamId: z.uuid() }))
    .handler(async (info) => {
      await assertTeamOwner(info.context.user.id, info.input.teamId);
      const existing = await db
        .selectFrom("teams")
        .where("id", "=", info.input.teamId)
        .select("widget_key")
        .executeTakeFirst();
      if (existing?.widget_key) return { widgetKey: existing.widget_key };
      const widgetKey = randomBytes(16).toString("hex");
      await db
        .updateTable("teams")
        .set({ widget_key: widgetKey })
        .where("id", "=", info.input.teamId)
        .execute();
      return { widgetKey };
    }),

  categories: {
    list: authP
      .input(z.object({ teamId: z.uuid() }))
      .handler(async (info) => {
        await assertTeamMember(info.context.user.id, info.input.teamId);
        return listCategories(info.input.teamId);
      }),

    create: authP
      .input(
        z.object({
          teamId: z.uuid(),
          name: z.string().trim().min(1).max(60),
        }),
      )
      .handler(async (info) => {
        await assertTeamMember(info.context.user.id, info.input.teamId);
        const max = await db
          .selectFrom("support_categories")
          .where("team_id", "=", info.input.teamId)
          .select(({ fn }) => fn.max<number>("position").as("max"))
          .executeTakeFirst();
        try {
          const row = await db
            .insertInto("support_categories")
            .values({
              team_id: info.input.teamId,
              name: info.input.name,
              position: (max?.max ?? -1) + 1,
            })
            .returning(["id", "name", "position"])
            .executeTakeFirstOrThrow();
          return row;
        } catch {
          throw new ORPCError("CONFLICT", {
            message: "A category with that name already exists.",
          });
        }
      }),

    rename: authP
      .input(
        z.object({
          categoryId: z.uuid(),
          name: z.string().trim().min(1).max(60),
        }),
      )
      .handler(async (info) => {
        const teamId = await teamIdOfCategory(info.input.categoryId);
        await assertTeamMember(info.context.user.id, teamId);
        await db
          .updateTable("support_categories")
          .set({ name: info.input.name })
          .where("id", "=", info.input.categoryId)
          .execute();
      }),

    reorder: authP
      .input(z.object({ teamId: z.uuid(), orderedIds: z.array(z.uuid()) }))
      .handler(async (info) => {
        await assertTeamMember(info.context.user.id, info.input.teamId);
        await db.transaction().execute(async (trx) => {
          for (let i = 0; i < info.input.orderedIds.length; i++) {
            await trx
              .updateTable("support_categories")
              .set({ position: i })
              .where("id", "=", info.input.orderedIds[i])
              .where("team_id", "=", info.input.teamId)
              .execute();
          }
        });
      }),

    /** Owner-only. Tickets keep their `category_id` cleared via FK SET NULL. */
    delete: authP
      .input(z.object({ categoryId: z.uuid() }))
      .handler(async (info) => {
        const teamId = await teamIdOfCategory(info.input.categoryId);
        await assertTeamOwner(info.context.user.id, teamId);
        await db
          .deleteFrom("support_categories")
          .where("id", "=", info.input.categoryId)
          .execute();
        publishSupportChanged(teamId);
      }),
  },

  tickets: {
    /** A team's inbox, newest-active first, with optional status/category/text
     *  filters. */
    list: authP
      .input(
        z.object({
          teamId: z.uuid(),
          status: STATUS.optional(),
          categoryId: z.uuid().optional(),
          q: z.string().trim().optional(),
        }),
      )
      .handler(async (info) => {
        await assertTeamMember(info.context.user.id, info.input.teamId);
        let q = db
          .selectFrom("support_tickets as t")
          .leftJoin("support_categories as c", "c.id", "t.category_id")
          .where("t.team_id", "=", info.input.teamId)
          .select([
            "t.id",
            "t.subject",
            "t.status",
            "t.category_id",
            "c.name as categoryName",
            "t.requester_email",
            "t.requester_name",
            "t.created_at",
            "t.last_message_at",
          ]);
        if (info.input.status) q = q.where("t.status", "=", info.input.status);
        if (info.input.categoryId)
          q = q.where("t.category_id", "=", info.input.categoryId);
        if (info.input.q) {
          const like = `%${info.input.q}%`;
          q = q.where((eb) =>
            eb.or([
              eb("t.subject", "ilike", like),
              eb("t.requester_email", "ilike", like),
              eb("t.requester_name", "ilike", like),
            ]),
          );
        }
        return q
          .orderBy("t.last_message_at", "desc")
          .limit(200)
          .execute();
      }),

    /** A single ticket's full detail (the thread is loaded via `chat.open`). */
    get: authP
      .input(z.object({ ticketId: z.uuid() }))
      .handler(async (info) => {
        const teamId = await teamIdOfTicket(info.input.ticketId);
        await assertTeamMember(info.context.user.id, teamId);
        const row = await db
          .selectFrom("support_tickets as t")
          .leftJoin("support_categories as c", "c.id", "t.category_id")
          .where("t.id", "=", info.input.ticketId)
          .select([
            "t.id",
            "t.team_id",
            "t.subject",
            "t.status",
            "t.category_id",
            "c.name as categoryName",
            "t.requester_email",
            "t.requester_name",
            "t.requester_user_id",
            "t.created_at",
            "t.last_message_at",
            "t.resolved_at",
          ])
          .executeTakeFirst();
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Ticket not found" });
        return row;
      }),

    /** In-app requester path: a logged-in user opens a ticket against a team.
     *  Membership is NOT required (the requester is a customer). */
    create: authP
      .input(
        z.object({
          teamId: z.uuid(),
          subject: z.string().trim().max(140).optional(),
          categoryId: z.uuid().optional(),
          message: z.string().trim().min(1).max(5000),
        }),
      )
      .handler(async (info) => {
        const team = await db
          .selectFrom("teams")
          .where("id", "=", info.input.teamId)
          .select("id")
          .executeTakeFirst();
        if (!team) throw new ORPCError("NOT_FOUND", { message: "Team not found" });
        const { ticketId } = await createTicketSvc({
          teamId: info.input.teamId,
          requesterUserId: info.context.user.id,
          requesterEmail: info.context.user.email ?? null,
          requesterName: info.context.user.name ?? null,
          subject: info.input.subject ?? null,
          categoryId: info.input.categoryId ?? null,
          message: info.input.message,
        });
        return { ticketId };
      }),

    setStatus: authP
      .input(z.object({ ticketId: z.uuid(), status: STATUS }))
      .handler(async (info) => {
        const teamId = await teamIdOfTicket(info.input.ticketId);
        await assertTeamMember(info.context.user.id, teamId);
        await db
          .updateTable("support_tickets")
          .set({
            status: info.input.status,
            resolved_at:
              info.input.status === "resolved" ? sql`now()` : null,
            updated_at: sql`now()`,
          })
          .where("id", "=", info.input.ticketId)
          .execute();
        publishSupportChanged(teamId);
      }),

    setCategory: authP
      .input(
        z.object({ ticketId: z.uuid(), categoryId: z.uuid().nullable() }),
      )
      .handler(async (info) => {
        const teamId = await teamIdOfTicket(info.input.ticketId);
        await assertTeamMember(info.context.user.id, teamId);
        if (info.input.categoryId) {
          const catTeam = await teamIdOfCategory(info.input.categoryId);
          if (catTeam !== teamId) {
            throw new ORPCError("BAD_REQUEST", {
              message: "Category belongs to a different team.",
            });
          }
        }
        await db
          .updateTable("support_tickets")
          .set({ category_id: info.input.categoryId, updated_at: sql`now()` })
          .where("id", "=", info.input.ticketId)
          .execute();
        publishSupportChanged(teamId);
      }),

    setSubject: authP
      .input(
        z.object({ ticketId: z.uuid(), subject: z.string().trim().max(140) }),
      )
      .handler(async (info) => {
        const teamId = await teamIdOfTicket(info.input.ticketId);
        await assertTeamMember(info.context.user.id, teamId);
        await db
          .updateTable("support_tickets")
          .set({ subject: info.input.subject, updated_at: sql`now()` })
          .where("id", "=", info.input.ticketId)
          .execute();
        publishSupportChanged(teamId);
      }),
  },

  /** Live inbox: yields whenever the given team's support inbox changes.
   *  Membership is resolved ONCE; events are filtered in-process by teamId. */
  subscribe: authP
    .input(z.object({ teamId: z.uuid() }))
    .handler(async function* (info): AsyncGenerator<{ teamId: string }> {
      await assertTeamMember(info.context.user.id, info.input.teamId);
      for await (const event of publisher.subscribe("support", {
        signal: info.signal,
      })) {
        if (event.teamId === info.input.teamId) yield { teamId: event.teamId };
      }
    }),
};
