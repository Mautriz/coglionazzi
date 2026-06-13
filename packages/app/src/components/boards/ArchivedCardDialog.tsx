import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  LinkIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TagBadge } from "~/components/boards/TagBadge";
import { CommentsSection } from "~/components/custom/CommentsSection";
import { FilePreview } from "~/components/custom/FileUploads";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { RichTextEditor } from "~/components/editor/RichTextEditor";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
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

type ArchivedCard = Outputs["archive"]["list"][number];

const RELATION_LABELS = {
  related: "Related to",
  blocks: "Blocks",
  blocked_by: "Blocked by",
} as const;

/** Read-only view of an archived card — fields are frozen, but the comment
 *  thread stays active. Footer: restore back onto a board (into its original
 *  column when that survives, otherwise a picked destination) or permanently
 *  delete. */
export function ArchivedCardDialog({
  card,
  teamId,
  onClose,
  onChanged,
}: {
  card: ArchivedCard;
  teamId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Original column gone (board/column deleted) → the user must pick where to
  // restore. column_id survives an in-place archive.
  const originGone = card.column_id == null;
  const [destination, setDestination] = useState<string | undefined>();

  const { data: targets } = useQuery({
    ...rpc.archive.restoreTargets.queryOptions({ input: { teamId } }),
    enabled: originGone,
  });

  const { mutate: restore, isPending: isRestoring } = useMutation(
    rpc.archive.restore.mutationOptions({
      onSuccess: () => {
        onChanged();
        toast.success("Card restored");
        onClose();
      },
    }),
  );

  const { mutate: purge, isPending: isPurging } = useMutation(
    rpc.archive.purge.mutationOptions({
      onSuccess: () => {
        onChanged();
        toast.success("Card permanently deleted");
        onClose();
      },
    }),
  );

  function handleRestore() {
    if (originGone) {
      if (!destination) return;
      restore({ cardId: card.id, destinationColumnId: destination });
    } else {
      restore({ cardId: card.id });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {card.title}
          </DialogTitle>
          {card.archived_origin && (
            <p className="text-xs text-muted-foreground">
              Archived from {card.archived_origin}
            </p>
          )}
        </DialogHeader>

        {card.description && (
          <div className="flex flex-col gap-1.5">
            <Label>Description</Label>
            <RichTextEditor
              namespace={`archived-card-${card.id}`}
              initialState={card.description}
              readOnly
            />
          </div>
        )}

        {card.assignees.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Assignees</Label>
            <div className="flex flex-wrap items-center gap-2">
              {card.assignees.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 text-sm"
                >
                  <UserAvatar id={a.id} name={a.name} size="xs" />
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {card.relations.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Related cards</Label>
            <div className="flex flex-col gap-1">
              {card.relations.map((rel) => (
                <div
                  key={rel.cardId}
                  className="flex items-center gap-2 rounded-md border border-card-border bg-card-background px-2 py-1 text-sm"
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
                </div>
              ))}
            </div>
          </div>
        )}

        {card.tags.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {card.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} />
              ))}
            </div>
          </div>
        )}

        {card.attachments.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Attachments</Label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {card.attachments.map((att) => (
                <a
                  key={att.id}
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                  className="aspect-square overflow-hidden rounded-md border border-card-border bg-card-background"
                >
                  <FilePreview url={att.url} metadata={att.metadata} />
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label>Comments</Label>
          <CommentsSection
            entityType="card"
            entityId={card.id}
            onCountChanged={onChanged}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={isPurging}
            onClick={() => {
              if (
                window.confirm(
                  `Permanently delete "${card.title}"? This cannot be undone.`,
                )
              ) {
                purge({ cardId: card.id });
              }
            }}
          >
            <Trash2Icon />
            Delete forever
          </Button>

          <div className="flex items-center gap-2">
            {originGone && (
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger className="h-9 w-52 text-xs">
                  <SelectValue placeholder="Restore into…" />
                </SelectTrigger>
                <SelectContent>
                  {targets?.map((t) => (
                    <SelectItem
                      key={t.columnId}
                      value={t.columnId}
                      className="text-xs"
                    >
                      {t.boardName} / {t.columnName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              disabled={isRestoring || (originGone && !destination)}
              onClick={handleRestore}
            >
              <RotateCcwIcon />
              Restore
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
