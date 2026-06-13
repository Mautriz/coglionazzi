import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GlobeIcon, LockIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { rpc } from "~/lib/rpcClient";

/** Create a Versus game from a deck. Public games show in the lobby list and
 *  anyone can join via the link; private games are scoped to a team — the link
 *  only works for that team's members. */
export function NewGameDialog({
  deckId,
  onClose,
}: {
  deckId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data: teams } = useQuery(rpc.team.list.queryOptions());
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [teamId, setTeamId] = useState("");

  const { mutate: create, isPending } = useMutation(
    rpc.game.sessions.create.mutationOptions({
      onSuccess: ({ id }) =>
        navigate({ to: "/home/games/$sessionId", params: { sessionId: id } }),
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex flex-col gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Versus game</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <VisibilityOption
            active={visibility === "public"}
            onClick={() => setVisibility("public")}
            icon={<GlobeIcon className="size-4" />}
            title="Public"
            subtitle="Anyone can join"
          />
          <VisibilityOption
            active={visibility === "private"}
            onClick={() => setVisibility("private")}
            icon={<LockIcon className="size-4" />}
            title="Private"
            subtitle="Unlisted · link only"
          />
        </div>

        {visibility === "private" && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              Who can open the link?
            </Label>
            <Select
              value={teamId || "none"}
              onValueChange={(v) => setTeamId(v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Anyone with the link</SelectItem>
                {teams?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} members only
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              create({
                deckId,
                visibility,
                teamId:
                  visibility === "private" && teamId ? teamId : undefined,
              })
            }
          >
            Create lobby
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VisibilityOption({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-colors",
        active ? "border-primary" : "border-card-border hover:border-primary/40",
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        {icon}
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </button>
  );
}
