import { useMutation } from "@tanstack/react-query";
import { ArchiveIcon, ArrowLeftIcon, ArrowRightIcon, LinkIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { TagBadge } from "~/components/boards/TagBadge";
import { AssigneeCombobox } from "~/components/custom/AssigneeCombobox";
import { CommentsSection } from "~/components/custom/CommentsSection";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/classUtils";
import { rpc, type Outputs } from "~/lib/rpcClient";

type BoardCard =
  Outputs["board"]["get"]["columns"][number]["cards"][number];

type RelationKind = "related" | "blocks" | "blocked_by";

const RELATION_LABELS: Record<RelationKind, string> = {
  related: "Related to",
  blocks: "Blocks",
  blocked_by: "Blocked by",
};

/** Edit a card: title, rich description (lexical), tags, assignees,
 *  related cards, attachments, comments. */
export function CardDialog({
  card,
  boardCards,
  teamId,
  onClose,
  onChanged,
}: {
  card: BoardCard;
  /** All cards of the board (for the relation picker). */
  boardCards: { id: string; title: string }[];
  /** The board's team — scopes the assignee picker to its members. */
  teamId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState(card.tags);
  const [assigneeIds, setAssigneeIds] = useState(
    card.assignees.map((a) => a.id),
  );
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

  const { mutate: archiveCard, isPending: isArchiving } = useMutation(
    rpc.board.archiveCard.mutationOptions({
      onSuccess: () => {
        onChanged();
        toast.success("Card archived");
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

  const { mutate: addRelation } = useMutation(
    rpc.board.addRelation.mutationOptions({ onSuccess: onChanged }),
  );

  const { mutate: removeRelation } = useMutation(
    rpc.board.removeRelation.mutationOptions({ onSuccess: onChanged }),
  );

  const [relationKind, setRelationKind] = useState<RelationKind>("related");
  // Cards available for a new relation: not self, not already linked.
  const relatableCards = boardCards.filter(
    (c) =>
      c.id !== card.id && !card.relations.some((r) => r.cardId === c.id),
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
      assigneeIds,
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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            className="text-lg! font-semibold"
            placeholder="Card title"
          />
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <RichTextEditor
            namespace={`card-${card.id}`}
            initialState={card.description ?? undefined}
            onChange={(json) => (descriptionRef.current = json)}
            onSubmit={save}
            placeholder="Details, links, code… (⌘/Ctrl+Enter to save)"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Assignees</Label>
          <AssigneeCombobox
            selected={assigneeIds}
            onChange={setAssigneeIds}
            teamId={teamId}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Related cards</Label>
          {card.relations.length > 0 && (
            <div className="flex flex-col gap-1">
              {card.relations.map((rel) => (
                <div
                  key={rel.cardId}
                  className="group flex items-center gap-2 rounded-md border border-card-border bg-card-background px-2 py-1 text-sm"
                >
                  {rel.kind === "blocks" ? (
                    <ArrowRightIcon className="size-3.5 shrink-0 text-orange1" />
                  ) : rel.kind === "blocked_by" ? (
                    <ArrowLeftIcon className="size-3.5 shrink-0 text-red1" />
                  ) : (
                    <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={cn(
                      "text-xs",
                      rel.kind === "blocked_by"
                        ? "text-red1"
                        : rel.kind === "blocks"
                          ? "text-orange1"
                          : "text-muted-foreground",
                    )}
                  >
                    {RELATION_LABELS[rel.kind]}
                  </span>
                  <span className="truncate">{rel.title}</span>
                  <button
                    type="button"
                    aria-label="Remove relation"
                    onClick={() =>
                      removeRelation({
                        cardId: card.id,
                        relatedCardId: rel.cardId,
                      })
                    }
                    className="invisible ml-auto text-muted-foreground hover:text-destructive group-hover:visible"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {relatableCards.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Select
                value={relationKind}
                onValueChange={(v) => setRelationKind(v as RelationKind)}
              >
                <SelectTrigger className="h-8 w-32.5 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RELATION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value=""
                onValueChange={(relatedCardId) =>
                  addRelation({
                    cardId: card.id,
                    relatedCardId,
                    kind: relationKind,
                  })
                }
              >
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue placeholder="Pick a card…" />
                </SelectTrigger>
                <SelectContent>
                  {relatableCards.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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

        <div className="flex flex-col gap-1.5">
          <Label>Comments</Label>
          <CommentsSection
            entityType="card"
            entityId={card.id}
            onCountChanged={onChanged}
          />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            disabled={isArchiving}
            onClick={() => archiveCard({ cardId: card.id })}
          >
            <ArchiveIcon />
            Archive
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
