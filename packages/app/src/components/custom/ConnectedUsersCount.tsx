import { useQuery } from "@tanstack/react-query";
import { LiveDot } from "~/components/custom/LiveDot";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { rpc } from "~/lib/rpcClient";

/** Live app-wide "who's online" indicator for the topbar: a pulsing green dot
 *  + the count of connected (logged-in) users, deduped by user. Hovering
 *  reveals the roster (avatars + names). Streams the full roster from
 *  `globalPresence.subscribe` — see CLAUDE.md Realtime → Presence. */
export function ConnectedUsersCount() {
  const live = useQuery(
    rpc.globalPresence.subscribe.experimental_liveOptions({ retry: true }),
  );
  const viewers = live.data;

  // Until the stream seeds, render an inert placeholder (no count, no flash).
  const count = viewers?.length ?? 0;

  return (
    <div className="group relative">
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground"
        aria-label={`${count} ${count === 1 ? "user" : "users"} online`}
      >
        <LiveDot />
        <span className="tabular-nums">{viewers ? count : "–"}</span>
      </span>

      {viewers && viewers.length > 0 && (
        <div className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden min-w-44 max-w-64 flex-col gap-1.5 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md group-hover:flex">
          <p className="px-0.5 text-xs font-medium text-muted-foreground">
            Online now
          </p>
          {viewers.map((v) => (
            <span
              key={v.userId}
              className="flex items-center gap-2 truncate text-sm"
            >
              <UserAvatar
                id={v.userId}
                name={v.name ?? "Someone"}
                image={v.image}
                size="xs"
              />
              <span className="truncate">{v.name ?? "Someone"}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
