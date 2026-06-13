import { useEffect, useRef } from "react";
import { MessageComposer } from "~/components/custom/MessageComposer";
import { MessageItem } from "~/components/custom/MessageItem";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/classUtils";
import { useChatRoom } from "~/lib/useChatRoom";
import type { RoomRef } from "~/server/orpc/roomAccess";

/** A live message thread for any room ref (a card's discussion, a team's chat,
 *  the global room). History pages back via "Load older"; messages stream in
 *  live. The list is capped at `maxHeightClass` and scrolls; it auto-sticks to
 *  the bottom for new messages unless you've scrolled up to read. */
export function MessageThread({
  roomRef,
  onChanged,
  className,
  composerPlaceholder = "Write a message…",
  emptyText = "No messages yet — say something.",
  maxHeightClass = "max-h-[55vh]",
}: {
  roomRef: RoomRef;
  /** Fired after the caller sends/edits/deletes (e.g. to refresh a count). */
  onChanged?: () => void;
  className?: string;
  composerPlaceholder?: string;
  emptyText?: string;
  maxHeightClass?: string;
}) {
  const chat = useChatRoom(roomRef, onChanged);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastIdRef = useRef<string | undefined>(undefined);
  const didInitRef = useRef(false);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  // Defer to the next frame so the message bodies (Lexical) have laid out
  // before we measure scrollHeight — otherwise the jump lands short.
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  useEffect(() => {
    if (chat.messages.length === 0) return;
    const lastId = chat.messages.at(-1)?.id;
    const appended = lastId !== lastIdRef.current;
    lastIdRef.current = lastId;

    // First non-empty render: always start pinned to the newest message.
    if (!didInitRef.current) {
      didInitRef.current = true;
      scrollToBottom();
      return;
    }
    // After that, only stick to the bottom for NEW messages (last id changes)
    // when already near the bottom — never when paging older (first id only),
    // so we don't yank the reader.
    if (appended && atBottomRef.current) scrollToBottom();
  }, [chat.messages]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn("flex flex-col gap-2 overflow-y-auto pr-1", maxHeightClass)}
      >
        {chat.hasMore && chat.messages.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="self-center text-xs text-muted-foreground"
            disabled={chat.loadingOlder}
            onClick={chat.loadOlder}
          >
            {chat.loadingOlder ? "Loading…" : "Load older"}
          </Button>
        )}

        {chat.messages.length === 0 && !chat.isLoading && (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        )}

        {chat.messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            isMine={!!chat.me && m.createdBy === chat.me}
            onEdit={(body) => chat.edit(m.id, body)}
            onDelete={() => chat.remove(m.id)}
            onReact={(emoji) => chat.react(m.id, emoji)}
          />
        ))}
      </div>

      <MessageComposer
        onSubmit={chat.send}
        placeholder={composerPlaceholder}
        namespace={`thread-${chat.roomId ?? "new"}`}
      />
    </div>
  );
}
