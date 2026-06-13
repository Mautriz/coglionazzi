import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
} from "../../../server/http";
import { createTicket, teamByWidgetKey } from "../../../server/support";

const bodySchema = z.object({
  widgetKey: z.string().min(1),
  email: z.string().email(),
  name: z.string().trim().max(120).optional(),
  categoryId: z.uuid().optional(),
  message: z.string().trim().min(1).max(5000),
});

/** Public: a visitor opens a new ticket. Returns the ticket id + the visitor's
 *  access token (the widget stores it to resume / post further messages). */
export const Route = createFileRoute("/api/support/tickets")({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),
      POST: async ({ request }) => {
        try {
          const parsed = bodySchema.safeParse(await request.json());
          if (!parsed.success) {
            return jsonResponse({ error: "Invalid request" }, 400);
          }
          const { widgetKey, email, name, categoryId, message } = parsed.data;
          const team = await teamByWidgetKey(widgetKey);
          // Categories are validated loosely — a bad one is just ignored.
          const { ticketId, accessToken, messages } = await createTicket({
            teamId: team.id,
            requesterEmail: email,
            requesterName: name ?? null,
            categoryId: categoryId ?? null,
            message,
          });
          return jsonResponse({ ticketId, accessToken, messages });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});
