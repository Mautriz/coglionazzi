import { PencilIcon, SmilePlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { MessageComposer } from "~/components/custom/MessageComposer";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { RichTextEditor } from "~/components/editor/RichTextEditor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/classUtils";
import type { ChatMessage } from "~/lib/useChatRoom";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "👀"];

/** One chat/comment message: author + time, body, reaction chips, and (for the
 *  author) edit/delete. Lean by design — small text and icons. */
export function MessageItem({
  message,
  isMine,
  onEdit,
  onDelete,
  onReact,
}: {
  message: ChatMessage;
  isMine: boolean;
  onEdit: (body: string) => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      className={cn(
        "group rounded-md border p-2",
        isMine
          ? "border-primary/30 bg-primary/5"
          : "border-card-border bg-card-background",
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <UserAvatar
          id={message.createdBy ?? "ghost"}
          name={message.author ?? "ghost"}
          size="xs"
        />
        <span className="text-xs font-semibold">
          {message.author ?? "ghost"}
        </span>
        <span className="text-[10px] text-muted-foreground2">
          {new Date(message.createdAt).toLocaleString()}
          {message.editedAt && " · edited"}
        </span>

        <div className="invisible ml-auto flex items-center gap-1.5 text-muted-foreground group-hover:visible">
          <Popover>
            <PopoverTrigger aria-label="React" className="hover:text-foreground">
              <SmilePlusIcon className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent className="flex w-auto gap-1 p-1">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(emoji)}
                  className="rounded p-1 text-base hover:bg-accent"
                >
                  {emoji}
                </button>
              ))}
            </PopoverContent>
          </Popover>
          {isMine && (
            <>
              <button
                type="button"
                aria-label={editing ? "Cancel edit" : "Edit message"}
                onClick={() => setEditing((e) => !e)}
                className="hover:text-foreground"
              >
                {editing ? (
                  <XIcon className="size-3.5" />
                ) : (
                  <PencilIcon className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                aria-label="Delete message"
                onClick={onDelete}
                className="hover:text-destructive"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <MessageComposer
          namespace={`edit-${message.id}`}
          initialState={message.body}
          autoClear={false}
          submitLabel="Save"
          placeholder="Edit message…"
          onSubmit={(body) => {
            onEdit(body);
            setEditing(false);
          }}
        />
      ) : (
        <RichTextEditor
          // Uncontrolled editor reads initialState only at mount — remount on
          // edit (editedAt bumps) so the new body actually shows.
          key={`${message.id}:${message.editedAt ?? ""}`}
          readOnly
          namespace={`msg-${message.id}`}
          initialState={message.body}
          className="text-sm"
        />
      )}

      {message.reactions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {message.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => onReact(r.emoji)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
                r.reactedByMe
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
              )}
            >
              <span>{r.emoji}</span>
              <span>{r.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
