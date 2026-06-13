import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { rpc } from "~/lib/rpcClient";

/** The Support section of the team settings dialog: triage categories +
 *  the embeddable widget snippet. */
export function SupportSettings({
  teamId,
  isOwner,
}: {
  teamId: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const refreshCats = () =>
    queryClient.invalidateQueries({
      queryKey: rpc.support.categories.list.key({ input: { teamId } }),
    });

  const { data: categories } = useQuery(
    rpc.support.categories.list.queryOptions({ input: { teamId } }),
  );
  const { data: widget, refetch: refetchKey } = useQuery(
    rpc.support.widgetKey.queryOptions({ input: { teamId } }),
  );

  const [newCat, setNewCat] = useState("");

  const { mutate: createCat } = useMutation(
    rpc.support.categories.create.mutationOptions({
      onSuccess: () => {
        setNewCat("");
        refreshCats();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const { mutate: deleteCat } = useMutation(
    rpc.support.categories.delete.mutationOptions({
      onSuccess: refreshCats,
      onError: (e) => toast.error(e.message),
    }),
  );
  const { mutate: enableWidget, isPending: enabling } = useMutation(
    rpc.support.enableWidget.mutationOptions({
      onSuccess: () => refetchKey(),
      onError: (e) => toast.error(e.message),
    }),
  );

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const snippet = widget?.widgetKey
    ? `<script src="${origin}/widget.js" data-widget-key="${widget.widgetKey}"></script>`
    : null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <span className="text-sm font-semibold">Support</span>

      {/* Categories */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Categories</label>
        <div className="flex flex-wrap gap-1.5">
          {categories?.map((c) => (
            <span
              key={c.id}
              className="group flex items-center gap-1 rounded-full border border-card-border bg-accent py-0.5 pl-2.5 pr-1 text-xs"
            >
              {c.name}
              {isOwner && (
                <button
                  type="button"
                  aria-label={`Delete ${c.name}`}
                  onClick={() => deleteCat({ categoryId: c.id })}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon className="size-3" />
                </button>
              )}
            </span>
          ))}
          {categories?.length === 0 && (
            <span className="text-xs text-muted-foreground">None yet.</span>
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newCat.trim()) createCat({ teamId, name: newCat.trim() });
          }}
        >
          <Input
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            placeholder="New category…"
            className="h-7 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!newCat.trim()}>
            Add
          </Button>
        </form>
      </div>

      {/* Widget */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Embeddable widget</label>
        {snippet ? (
          <SnippetBox snippet={snippet} />
        ) : isOwner ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={enabling}
            onClick={() => enableWidget({ teamId })}
            className="self-start"
          >
            {enabling ? "Enabling…" : "Enable support widget"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            The widget hasn’t been enabled by an owner yet.
          </span>
        )}
      </div>
    </div>
  );
}

function SnippetBox({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border border-card-border bg-muted/40 p-2">
      <code className="flex-1 break-all text-[11px] leading-relaxed">
        {snippet}
      </code>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() => {
          navigator.clipboard.writeText(snippet);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </Button>
    </div>
  );
}
