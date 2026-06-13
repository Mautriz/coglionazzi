import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { client, rpc, type Outputs } from "~/lib/rpcClient";
import type { ChatEvent } from "~/server/realtime/publisher";
import type { RoomRef } from "~/server/orpc/roomAccess";

export type ChatMessage = Outputs["chat"]["open"]["messages"][number];

const PAGE = 30;

/** Apply one streamed event to the local message list (append/patch/remove;
 *  reaction deltas recompute counts and `reactedByMe` for the viewer). */
function applyEvent(
  list: ChatMessage[],
  event: ChatEvent,
  me: string | undefined,
): ChatMessage[] {
  switch (event.type) {
    case "created": {
      if (list.some((m) => m.id === event.message.id)) return list; // dedupe
      return [...list, event.message];
    }
    case "updated":
      return list.map((m) =>
        m.id === event.messageId
          ? { ...m, body: event.body, editedAt: event.editedAt }
          : m,
      );
    case "deleted":
      return list.filter((m) => m.id !== event.messageId);
    case "reaction":
      return list.map((m) => {
        if (m.id !== event.messageId) return m;
        const reactions = [...m.reactions];
        const i = reactions.findIndex((r) => r.emoji === event.emoji);
        const mine = event.userId === me;
        if (i === -1) {
          if (event.added)
            reactions.push({ emoji: event.emoji, count: 1, reactedByMe: mine });
        } else {
          const count = reactions[i].count + (event.added ? 1 : -1);
          if (count <= 0) reactions.splice(i, 1);
          else
            reactions[i] = {
              ...reactions[i],
              count,
              reactedByMe: mine ? event.added : reactions[i].reactedByMe,
            };
        }
        return { ...m, reactions };
      });
  }
}

/** Open a chat room and keep it live: seeds from `chat.open`, streams changes
 *  over the WebSocket (auto-resubscribing on reconnect and refetching the
 *  latest page to fill any gap), and exposes the mutations + history paging. */
export function useChatRoom(ref: RoomRef, onChanged?: () => void) {
  const { data: session } = useQuery(rpc.auth.getSession.queryOptions());
  const me = session?.user?.id;

  const openQuery = useQuery(
    rpc.chat.open.queryOptions({ input: { ref, limit: PAGE } }),
  );
  const roomId = openQuery.data?.roomId;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Seed (and re-seed after a reconnect refetch) from the latest page, merging
  // so we don't clobber older pages already scrolled in.
  useEffect(() => {
    const page = openQuery.data?.messages;
    if (!page) return;
    setMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      const fresh = page.filter((m) => !known.has(m.id));
      return fresh.length ? [...prev, ...fresh].sort(byTime) : prev;
    });
    if (page.length < PAGE) setHasMore(false);
  }, [openQuery.data]);

  // Live stream. Loop resubscribes across reconnects; on each (re)subscribe we
  // refetch the latest page to recover anything missed while disconnected.
  const applyRef = useRef(applyEvent);
  applyRef.current = applyEvent;
  useEffect(() => {
    if (!roomId) return;
    let active = true;
    const ac = new AbortController();
    (async () => {
      let first = true;
      while (active) {
        if (!first) await openQuery.refetch();
        first = false;
        try {
          const iter = await client.chat.subscribe(
            { roomId },
            { signal: ac.signal },
          );
          for await (const event of iter) {
            setMessages((prev) => applyRef.current(prev, event, me));
          }
        } catch {
          // socket dropped — fall through to resubscribe.
        }
        if (active) await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => {
      active = false;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, me]);

  const send = useMutation(
    rpc.chat.send.mutationOptions({ onSuccess: onChanged }),
  );
  const edit = useMutation(
    rpc.chat.editMessage.mutationOptions({ onSuccess: onChanged }),
  );
  const remove = useMutation(
    rpc.chat.deleteMessage.mutationOptions({ onSuccess: onChanged }),
  );
  const react = useMutation(rpc.chat.react.mutationOptions());

  const loadOlder = useCallback(async () => {
    if (!roomId || !hasMore || loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const older = await client.chat.history({
        roomId,
        before: { createdAt: oldest.createdAt, id: oldest.id },
        limit: PAGE,
      });
      if (older.length < PAGE) setHasMore(false);
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !known.has(m.id)), ...prev].sort(byTime);
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [roomId, hasMore, loadingOlder, messages]);

  return {
    me,
    roomId,
    messages,
    isLoading: openQuery.isLoading,
    hasMore,
    loadingOlder,
    loadOlder,
    send: (body: string) => roomId && send.mutate({ roomId, body }),
    edit: (messageId: string, body: string) =>
      edit.mutate({ messageId, body }),
    remove: (messageId: string) => remove.mutate({ messageId }),
    react: (messageId: string, emoji: string) =>
      react.mutate({ messageId, emoji }),
  };
}

function byTime(a: ChatMessage, b: ChatMessage) {
  return a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
      ? 1
      : a.id < b.id
        ? -1
        : 1;
}
