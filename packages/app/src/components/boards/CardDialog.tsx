import { useMutation } from "@tanstack/react-query";
import { ArchiveIcon, ArrowLeftIcon, ArrowRightIcon, LinkIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AssigneeCombobox } from "~/components/custom/AssigneeCombobox";
import { TagCombobox } from "~/components/custom/TagCombobox";
import { MessageThread } from "~/components/custom/MessageThread";
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
  const [tags, setTags] = useState(card.tags);
  const [assigneeIds, setAssigneeIds] = useState(
    card.assignees.map((a) => a.id),
  );
  const descriptionRef = useRef<string | null>(card.description);

  const { mutate: updateCard, isPending: isSaving } = useMutation(
    // Auto-save: persist a single field and refresh the board behind the
    // dialog (which stays open). Partial input — see board.updateCard.
    rpc.board.updateCard.mutationOptions({ onSuccess: onChanged }),
  );

  // Title & description are debounced (text fields); tags/assignees/relations/
  // attachments save immediately. Pending debounced fields are flushed when the
  // dialog closes, so nothing typed in the last 2s is lost.
  const pending = useRef<{ title?: string; description?: string | null }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    // Never persist an empty title (the column header would go blank).
    if (patch.title !== undefined && !patch.title.trim()) delete patch.title;
    if (Object.keys(patch).length > 0) updateCard({ cardId: card.id, ...patch });
  }

  function scheduleSave(patch: { title?: string; description?: string | null }) {
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 2000);
  }

  // Flush on unmount so a fast close still saves the last edits.
  useEffect(() => () => flush(), []);

  function close() {
    flush();
    onClose();
  }

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

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Edit card</DialogTitle>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              scheduleSave({ title: e.target.value });
            }}
            onBlur={flush}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                flush();
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
            onChange={(json) => {
              descriptionRef.current = json;
              scheduleSave({ description: json });
            }}
            onSubmit={flush}
            placeholder="Details, links, code… (saves automatically)"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Assignees</Label>
          <AssigneeCombobox
            selected={assigneeIds}
            onChange={(ids) => {
              setAssigneeIds(ids);
              updateCard({ cardId: card.id, assigneeIds: ids });
            }}
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
          <Label>Tags</Label>
          <TagCombobox
            selected={tags}
            onChange={(next) => {
              setTags(next);
              updateCard({ cardId: card.id, tags: next });
            }}
            teamId={teamId}
          />
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
          <MessageThread
            roomRef={{ scope: "card", cardId: card.id }}
            onChanged={onChanged}
            emptyText="No comments yet — start the discussion."
            composerPlaceholder="Write a comment…"
          />
        </div>

        <div className="mt-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            disabled={isArchiving}
            onClick={() => {
              flush();
              archiveCard({ cardId: card.id });
            }}
          >
            <ArchiveIcon />
            Archive
          </Button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground2">
              {isSaving ? "Saving…" : "Changes save automatically"}
            </span>
            <Button type="button" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
