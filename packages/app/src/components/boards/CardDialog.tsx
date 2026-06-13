import { useMutation } from "@tanstack/react-query";
import { Trash2Icon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { TagBadge } from "~/components/boards/TagBadge";
import {
  FilePreview,
  UploadButton,
} from "~/components/custom/FileUploads";
import { RichTextEditor } from "~/components/editor/RichTextEditor";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { rpc, type Outputs } from "~/lib/rpcClient";

type BoardCard =
  Outputs["board"]["get"]["columns"][number]["cards"][number];

/** Edit a card: title, rich description (lexical), tags, attachments. */
export function CardDialog({
  card,
  onClose,
  onChanged,
}: {
  card: BoardCard;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState(card.tags);
  // Description JSON is captured on every editor change but only persisted
  // on Save, like the rest of the card.
  const descriptionRef = useRef<string | null>(card.description);

  const { mutate: updateCard, isPending: isSaving } = useMutation(
    rpc.board.updateCard.mutationOptions({
      onSuccess: () => {
        onChanged();
        toast.success("Card saved");
        onClose();
      },
    }),
  );

  const { mutate: deleteCard, isPending: isDeleting } = useMutation(
    rpc.board.deleteCard.mutationOptions({
      onSuccess: () => {
        onChanged();
        onClose();
      },
    }),
  );

  const { mutate: addAttachment } = useMutation(
    rpc.board.addAttachment.mutationOptions({ onSuccess: onChanged }),
  );

  const { mutate: removeAttachment } = useMutation(
    rpc.board.removeAttachment.mutationOptions({ onSuccess: onChanged }),
  );

  function addTag() {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput("");
  }

  function save() {
    if (!title.trim()) return;
    updateCard({
      cardId: card.id,
      title,
      tags,
      description: descriptionRef.current,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Edit card</DialogTitle>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="!text-lg font-semibold"
            placeholder="Card title"
          />
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <RichTextEditor
            namespace={`card-${card.id}`}
            initialState={card.description ?? undefined}
            onChange={(json) => (descriptionRef.current = json)}
            placeholder="Details, links, code…"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="card-tags">Tags</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <TagBadge key={tag} tag={tag} className="gap-1 pr-1">
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={() => setTags(tags.filter((t) => t !== tag))}
                  className="opacity-60 hover:opacity-100"
                >
                  <XIcon className="size-3" />
                </button>
              </TagBadge>
            ))}
            <Input
              id="card-tags"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
              placeholder="Add tag + Enter"
              className="h-7 w-36 text-xs"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Attachments</Label>
          {card.attachments.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {card.attachments.map((att) => (
                <div
                  key={att.id}
                  className="group relative aspect-square overflow-hidden rounded-md border border-card-border bg-card-background"
                >
                  <a href={att.url} target="_blank" rel="noreferrer">
                    <FilePreview url={att.url} metadata={att.metadata} />
                  </a>
                  <button
                    type="button"
                    aria-label="Remove attachment"
                    onClick={() =>
                      removeAttachment({ cardId: card.id, fileId: att.id })
                    }
                    className="absolute right-1 top-1 hidden rounded-md bg-background/80 p-1 text-destructive group-hover:block"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div>
            <UploadButton
              size="sm"
              onUploaded={(file) =>
                addAttachment({ cardId: card.id, fileId: file.id })
              }
            />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={isDeleting}
            onClick={() => deleteCard({ cardId: card.id })}
          >
            <Trash2Icon />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!title.trim() || isSaving}
              onClick={save}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
