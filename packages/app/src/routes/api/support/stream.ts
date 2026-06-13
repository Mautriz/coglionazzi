import { createFileRoute } from "@tanstack/react-router";
import {
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  preflightResponse,
} from "../../../server/http";
import { resolveRoom } from "../../../server/orpc/roomAccess";
import { chatPublisher } from "../../../server/realtime/publisher";
import { chatMessageToWidget, ticketByToken } from "../../../server/support";

/** Public: a Server-Sent Events stream of a ticket's new messages (agent
 *  replies, mostly) so the widget updates live. Authed by the access token;
 *  subscribes the room-keyed chat publisher and closes on disconnect. */
export const Route = createFileRoute("/api/support/stream")({
  server: {
    handlers: {
      OPTIONS: () => preflightResponse(),
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token");
        if (!token) return jsonResponse({ error: "Missing token" }, 400);

        let roomId: string;
        try {
          const ticket = await ticketByToken(token);
          roomId = (await resolveRoom({ scope: "support", ticketId: ticket.id }))
            .id;
        } catch (err) {
          return errorResponse(err);
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: unknown) =>
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
              );
            controller.enqueue(encoder.encode(": connected\n\n"));
            try {
              for await (const event of chatPublisher.subscribe(roomId, {
                signal: request.signal,
              })) {
                if (event.type === "created") {
                  send({ type: "created", message: chatMessageToWidget(event.message) });
                } else if (event.type === "deleted") {
                  send({ type: "deleted", id: event.messageId });
                }
              }
            } catch {
              // client disconnected / aborted
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
