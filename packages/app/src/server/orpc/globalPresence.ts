import {
  globalPresenceSnapshot,
  joinGlobalPresence,
} from "../realtime/globalPresence";
import { publisher, type PresenceViewer } from "../realtime/publisher";
import { authP } from "./base";

export const globalPresenceRouter = {
  /** Live roster of everyone connected to the app right now. An Event Iterator:
   *  it registers the caller, yields the current roster immediately, then
   *  yields again whenever anyone connects/disconnects. The `finally` (run when
   *  the socket closes and oRPC aborts the generator) deregisters the caller.
   *  Any logged-in user may watch — no per-entity access check, just `authP`. */
  subscribe: authP.handler(async function* (
    info,
  ): AsyncGenerator<PresenceViewer[]> {
    const leave = joinGlobalPresence({
      userId: info.context.user.id,
      name: info.context.user.name ?? null,
      image: info.context.user.image ?? null,
    });
    try {
      yield globalPresenceSnapshot();
      for await (const event of publisher.subscribe("globalPresence", {
        signal: info.signal,
      })) {
        yield event.viewers;
      }
    } finally {
      leave();
    }
  }),
};
