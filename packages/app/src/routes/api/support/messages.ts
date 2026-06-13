import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
} from "../../../server/http";
import {
  appendCustomerMessage,
  loadWidgetMessages,
  ticketByToken,
} from "../../../server/support";

const postSchema = z.object({
  token: z.string().min(1),
  message: z.string().trim().min(1).max(5000),
});

/** Public: read a ticket's conversation (GET ?token=) or append a visitor
 *  message (POST {token, message}). Authed by the ticket's access token. */
export const Route = createFileRoute("/api/support/messages")({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),
      GET: async ({ request }) => {
        try {
          const token = new URL(request.url).searchParams.get("token");
          if (!token) return jsonResponse({ error: "Missing token" }, 400);
          const ticket = await ticketByToken(token);
          const messages = await loadWidgetMessages(ticket.id);
          return jsonResponse({ status: ticket.status, messages });
        } catch (err) {
          return errorResponse(err);
        }
      },
      POST: async ({ request }) => {
        try {
          const parsed = postSchema.safeParse(await request.json());
          if (!parsed.success) {
            return jsonResponse({ error: "Invalid request" }, 400);
          }
          const ticket = await ticketByToken(parsed.data.token);
          const message = await appendCustomerMessage(
            ticket.id,
            parsed.data.message,
          );
          return jsonResponse({ message });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
