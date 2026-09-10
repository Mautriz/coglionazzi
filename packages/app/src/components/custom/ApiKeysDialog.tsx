import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, KeyRoundIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { rpc } from "~/lib/rpcClient";

const appOrigin = (): string =>
  import.meta.env.VITE_FRONTEND_URL ?? window.location.origin;

/** The one-liner that points Claude Code at this app. Keeping the whole
 *  command copyable (key included) is the point — connecting should be paste,
 *  not assembly. */
const mcpCommand = (token: string): string =>
  `claude mcp add --transport http insacco ${appOrigin()}/api/mcp --header "Authorization: Bearer ${token}"`;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** Manage API keys for external access (chat bots, and Claude Code over MCP).
 *  A key acts as you across all your teams, so it is as powerful as your
 *  login — the dialog says so plainly. */
export function ApiKeysDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  /** The freshly minted token — shown ONCE, never recoverable afterwards. */
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(
    null,
  );

  const { data: keys } = useQuery(rpc.apiKey.list.queryOptions());

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: rpc.apiKey.list.key() });

  const { mutate: create, isPending } = useMutation(
    rpc.apiKey.create.mutationOptions({
      onSuccess: (key) => {
        setFresh({ name: key.name, token: key.token });
        setName("");
        invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const { mutate: revoke } = useMutation(
    rpc.apiKey.revoke.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4" /> API keys
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Keys let external tools reach Insacco — a chat bot, or Claude Code
          over MCP. A key acts as <strong>you</strong>, in every team you
          belong to.
        </p>

        {fresh ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div>
              <p className="text-sm font-medium">
                “{fresh.name}” created — copy it now
              </p>
              <p className="text-xs text-muted-foreground">
                This is the only time the key is shown.
              </p>
            </div>

            <code className="block overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
              {fresh.token}
            </code>

            <div>
              <Label className="text-xs text-muted-foreground">
                Add it to Claude Code
              </Label>
              <code className="mt-1 block overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs whitespace-pre">
                {mcpCommand(fresh.token)}
              </code>
            </div>

            <div className="flex flex-wrap gap-2">
              <CopyButton value={mcpCommand(fresh.token)} label="Copy command" />
              <CopyButton value={fresh.token} label="Copy key" />
              <Button variant="ghost" size="sm" onClick={() => setFresh(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create({ name: name.trim() });
            }}
          >
            <div className="flex-1">
              <Label htmlFor="api-key-name" className="text-xs">
                New key name
              </Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Claude Code"
                maxLength={100}
              />
            </div>
            <Button type="submit" disabled={isPending || !name.trim()}>
              Create
            </Button>
          </form>
        )}

        <div className="flex flex-col gap-2">
          {keys?.length === 0 && (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          )}
          {keys?.map((key) => (
            <div
              key={key.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{key.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {key.prefix}…{" · "}
                  {key.last_used_at
                    ? `last used ${new Date(key.last_used_at).toLocaleDateString()}`
                    : "never used"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Revoke ${key.name}`}
                onClick={() => revoke({ id: key.id })}
              >
                <Trash2Icon className="text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
