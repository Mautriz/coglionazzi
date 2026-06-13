import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { rpc } from "~/lib/rpcClient";

/** Subscribe to a board's realtime change stream and refetch `board.get` (and
 *  the sidebar's `board.list` counts) whenever the server signals a change.
 *  Signal-and-refetch: the event carries no payload; it just triggers an
 *  invalidate. `retry: true` re-subscribes across reconnects. */
export function useBoardRealtime(boardId: string) {
  const queryClient = useQueryClient();
  const live = useQuery(
    rpc.board.subscribe.experimental_liveOptions({
      input: { boardId },
      retry: true,
    }),
  );

  const updatedAt = live.dataUpdatedAt;
  useEffect(() => {
    // dataUpdatedAt is 0 until the first event; board.subscribe only yields on
    // an actual change, so every update is a real invalidation trigger.
    if (!updatedAt) return;
    queryClient.invalidateQueries({
      queryKey: rpc.board.get.queryKey({ input: { boardId } }),
    });
    queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
  }, [updatedAt, boardId, queryClient]);
}

/** Subscribe to the caller's workspace and refetch the team-grouped sidebar
 *  (`team.list` + `board.list`) whenever a team they belong to changes its
 *  membership or board set (board added/removed, member added/removed, rename,
 *  delete). Mount wherever the boards sidebar lives. */
export function useWorkspaceRealtime() {
  const queryClient = useQueryClient();
  const live = useQuery(
    rpc.team.subscribe.experimental_liveOptions({ retry: true }),
  );

  const updatedAt = live.dataUpdatedAt;
  useEffect(() => {
    if (!updatedAt) return;
    queryClient.invalidateQueries({ queryKey: rpc.team.list.key() });
    queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
  }, [updatedAt, queryClient]);
}

/** Live roster of who is viewing this board (deduped by user). Returns the
 *  current viewer list, updating as people join/leave. */
export function useBoardPresence(boardId: string) {
  const live = useQuery(
    rpc.presence.subscribe.experimental_liveOptions({
      input: { boardId },
      retry: true,
    }),
  );
  return live.data ?? [];
}
// Card/chat threads stream live via `useChatRoom` (lib/useChatRoom.ts), which
// drives `chat.subscribe` directly — no refetch-on-signal hook needed here.
