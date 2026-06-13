import { z } from "zod";
import { joinPresence, presenceSnapshot } from "../realtime/presence";
import { publisher, type PresenceViewer } from "../realtime/publisher";
import { authP } from "./base";
import { assertBoardAccess } from "./teamAccess";

export const presenceRouter = {
  /** Live roster of who is currently viewing a board. An Event Iterator: it
   *  registers the caller as a viewer, yields the current roster immediately,
   *  then yields again whenever anyone joins/leaves. The `finally` (run when
   *  the socket closes and oRPC aborts the generator) deregisters the caller. */
  subscribe: authP
    .input(z.object({ boardId: z.uuid() }))
    .handler(async function* (info): AsyncGenerator<PresenceViewer[]> {
      await assertBoardAccess(info.context.user.id, info.input.boardId);

      const leave = joinPresence(info.input.boardId, {
        userId: info.context.user.id,
        name: info.context.user.name ?? null,
        image: info.context.user.image ?? null,
      });
      try {
        yield presenceSnapshot(info.input.boardId);
        for await (const event of publisher.subscribe("presence", {
          signal: info.signal,
        })) {
          if (event.boardId === info.input.boardId) {
            yield event.viewers;
          }
        }
      } finally {
        leave();
      }
    }),
};
