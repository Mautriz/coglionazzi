import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { RichTextEditor } from "~/components/editor/RichTextEditor";
import { Button } from "~/components/ui/button";
import { rpc } from "~/lib/rpcClient";

type EntityType = "card";

/** Generic comment thread for any commentable entity (entity/id pattern —
 *  see the comments router). Drop it under cards, puzzles, whatever. */
export function CommentsSection({
  entityType,
  entityId,
  onCountChanged,
}: {
  entityType: EntityType;
  entityId: string;
  onCountChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const input = { entityType, entityId };

  const { data: comments } = useQuery(
    rpc.comment.list.queryOptions({ input }),
  );

  // The editor is uncontrolled; bumping the key remounts it empty after post.
  const [editorKey, setEditorKey] = useState(0);
  const draftRef = useRef<string | null>(null);
  const [hasText, setHasText] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: rpc.comment.list.key({ input }) });
    onCountChanged?.();
  };

  const { mutate: addComment, isPending: isPosting } = useMutation(
    rpc.comment.add.mutationOptions({
      onSuccess: () => {
        draftRef.current = null;
        setHasText(false);
        setEditorKey((k) => k + 1);
        refresh();
      },
    }),
  );

  const { mutate: deleteComment } = useMutation(
    rpc.comment.delete.mutationOptions({ onSuccess: refresh }),
  );

  function post() {
    if (draftRef.current && hasText) {
      addComment({ ...input, body: draftRef.current });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {comments?.map((comment) => (
        <div
          key={comment.id}
          className="group rounded-md border border-card-border bg-card-background p-2.5"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">
              {comment.author ?? "ghost"}
              <span className="ml-2 font-normal text-muted-foreground2">
                {new Date(comment.created_at).toLocaleString()}
              </span>
            </span>
            <button
              type="button"
              aria-label="Delete comment"
              onClick={() => deleteComment({ commentId: comment.id })}
              className="invisible text-muted-foreground hover:text-destructive group-hover:visible"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
          <RichTextEditor
            readOnly
            namespace={`comment-${comment.id}`}
            initialState={comment.body}
            className="text-sm"
          />
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <RichTextEditor
          key={editorKey}
          namespace={`comment-draft-${entityId}`}
          placeholder="Write a comment…"
          onChange={(json) => {
            draftRef.current = json;
            // Cheap "is there any text" check on the serialized state so the
            // button enables/disables without parsing the whole tree.
            setHasText(json.includes('"text":"'));
          }}
        />
        <div>
          <Button
            type="button"
            size="sm"
            disabled={!hasText || isPosting}
            onClick={post}
          >
            <SendIcon />
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
