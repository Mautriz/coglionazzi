import { randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { sql } from "kysely";
import { db } from "./db";
import { extractLexicalText, plainTextToLexical } from "./lexicalText";
import {
  publishChat,
  publishSupportChanged,
  type ChatMessagePayload,
} from "./realtime/publisher";
import { resolveRoom } from "./orpc/roomAccess";

/** Shared support logic used by BOTH the agent-facing oRPC router
 *  (`orpc/support.ts`) and the public, unauthenticated widget endpoints
 *  (`routes/api/support/*`). A ticket's conversation is a kind='support' chat
 *  room (owner_id = ticket.id); a message's `created_by IS NULL` is the
 *  customer, a non-null user is an agent (a team member). */

const toIso = (v: unknown) => new Date(v as string | number | Date).toISOString();

/** A message as the widget consumes it — plain text, no Lexical/reactions. */
export interface WidgetMessage {
  id: string;
  text: string;
  fromAgent: boolean;
  authorName: string | null;
  createdAt: string;
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

/** Resolve the team a widget key belongs to (404 on unknown/disabled key). */
export async function teamByWidgetKey(widgetKey: string) {
  const team = await db
    .selectFrom("teams")
    .where("widget_key", "=", widgetKey)
    .select(["id", "name"])
    .executeTakeFirst();
  if (!team) throw new ORPCError("NOT_FOUND", { message: "Unknown widget key" });
  return team;
}

/** Resolve a ticket by its visitor access token (the public read/write gate). */
export async function ticketByToken(token: string) {
  const ticket = await db
    .selectFrom("support_tickets")
    .where("access_token", "=", token)
    .select(["id", "team_id", "status"])
    .executeTakeFirst();
  if (!ticket) throw new ORPCError("NOT_FOUND", { message: "Unknown ticket" });
  return ticket;
}

/** A team's categories, ordered for display. */
export async function listCategories(teamId: string) {
  return db
    .selectFrom("support_categories")
    .where("team_id", "=", teamId)
    .select(["id", "name", "position"])
    .orderBy("position", "asc")
    .orderBy("name", "asc")
    .execute();
}

/** Insert a customer (created_by NULL) message into a support room, stream it to
 *  agents, bump the ticket's activity, and return the widget-shaped message. */
async function insertCustomerMessage(
  ticketId: string,
  roomId: string,
  text: string,
): Promise<WidgetMessage> {
  const body = plainTextToLexical(text);
  const row = await db
    .insertInto("chat_messages")
    .values({
      room_id: roomId,
      body,
      body_text: extractLexicalText(body),
      created_by: null,
      created_at: sql`clock_timestamp()`,
    })
    .returning(["id", "created_at"])
    .executeTakeFirstOrThrow();

  const createdAt = toIso(row.created_at);
  // Wake agents' open threads (same room-keyed channel as chat.send).
  const payload: ChatMessagePayload = {
    id: row.id,
    roomId,
    body,
    author: null,
    authorImage: null,
    createdBy: null,
    createdAt,
    editedAt: null,
    reactions: [],
  };
  publishChat(roomId, { type: "created", message: payload });
  await bumpTicketActivity(ticketId);

  return { id: row.id, text, fromAgent: false, authorName: null, createdAt };
}

/** Bump a ticket's last activity + announce its team's inbox changed. */
export async function bumpTicketActivity(ticketId: string) {
  const row = await db
    .updateTable("support_tickets")
    .set({ last_message_at: sql`now()`, updated_at: sql`now()` })
    .where("id", "=", ticketId)
    .returning("team_id")
    .executeTakeFirst();
  if (row) publishSupportChanged(row.team_id);
}

/** Open a ticket (customer side) + its room + first message. `requesterUserId`
 *  records a logged-in coglionazzi requester for identity ONLY — the message
 *  itself is still stored customer-side (created_by NULL) so the room's
 *  sender convention holds. */
export async function createTicket(input: {
  teamId: string;
  requesterUserId?: string | null;
  requesterEmail?: string | null;
  requesterName?: string | null;
  subject?: string | null;
  categoryId?: string | null;
  message: string;
}) {
  // A category (if given) must belong to the ticket's team.
  if (input.categoryId) {
    const cat = await db
      .selectFrom("support_categories")
      .where("id", "=", input.categoryId)
      .where("team_id", "=", input.teamId)
      .select("id")
      .executeTakeFirst();
    if (!cat) {
      throw new ORPCError("BAD_REQUEST", { message: "Unknown category" });
    }
  }

  const accessToken = newToken();
  const ticket = await db
    .insertInto("support_tickets")
    .values({
      team_id: input.teamId,
      requester_user_id: input.requesterUserId ?? null,
      requester_email: input.requesterEmail ?? null,
      requester_name: input.requesterName ?? null,
      subject: input.subject ?? null,
      category_id: input.categoryId ?? null,
      access_token: accessToken,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const room = await resolveRoom({ scope: "support", ticketId: ticket.id });
  const message = await insertCustomerMessage(ticket.id, room.id, input.message);

  return { ticketId: ticket.id, accessToken, roomId: room.id, messages: [message] };
}

/** Append a customer message to an existing ticket (the public widget path). */
export async function appendCustomerMessage(ticketId: string, text: string) {
  const room = await resolveRoom({ scope: "support", ticketId });
  return insertCustomerMessage(ticketId, room.id, text);
}

/** A ticket's whole conversation, oldest-first, in the widget shape. */
export async function loadWidgetMessages(
  ticketId: string,
): Promise<WidgetMessage[]> {
  const room = await resolveRoom({ scope: "support", ticketId });
  const rows = await db
    .selectFrom("chat_messages")
    .leftJoin("users", "users.id", "chat_messages.created_by")
    .where("chat_messages.room_id", "=", room.id)
    .select([
      "chat_messages.id",
      "chat_messages.body_text",
      "chat_messages.created_by",
      "chat_messages.created_at",
      "users.name as author",
    ])
    .orderBy("chat_messages.created_at", "asc")
    .orderBy("chat_messages.id", "asc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    text: r.body_text,
    fromAgent: r.created_by !== null,
    authorName: r.author,
    createdAt: toIso(r.created_at),
  }));
}

/** Map a streamed chat "created" event to the widget shape (for SSE). */
export function chatMessageToWidget(message: ChatMessagePayload): WidgetMessage {
  return {
    id: message.id,
    text: extractLexicalText(message.body),
    fromAgent: message.createdBy !== null,
    authorName: message.author,
    createdAt: message.createdAt,
  };
}
