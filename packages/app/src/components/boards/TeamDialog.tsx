import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOutIcon, Trash2Icon, UserPlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { SupportSettings } from "~/components/teams/SupportSettings";
import { rpc, type Outputs } from "~/lib/rpcClient";

type Team = Outputs["team"]["list"][number];

/** Team settings: rename (owner), member list with add/remove, and the
 *  destructive actions (owner deletes the team; members leave). */
export function TeamDialog({
  team,
  onClose,
}: {
  team: Team;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isOwner = team.isOwner;

  const { data: members } = useQuery(
    rpc.team.members.queryOptions({ input: { teamId: team.id } }),
  );
  const { data: allUsers } = useQuery(rpc.user.list.queryOptions());

  const [name, setName] = useState(team.name);
  const [addOpen, setAddOpen] = useState(false);

  const refreshTeams = () =>
    queryClient.invalidateQueries({ queryKey: rpc.team.list.key() });
  const refreshMembers = () =>
    queryClient.invalidateQueries({
      queryKey: rpc.team.members.key({ input: { teamId: team.id } }),
    });

  const { mutate: rename } = useMutation(
    rpc.team.rename.mutationOptions({
      onSuccess: () => {
        refreshTeams();
        toast.success("Team renamed");
      },
    }),
  );
  const { mutate: addMember } = useMutation(
    rpc.team.addMember.mutationOptions({
      onSuccess: () => {
        refreshMembers();
        refreshTeams();
      },
    }),
  );
  const { mutate: removeMember } = useMutation(
    rpc.team.removeMember.mutationOptions({
      onSuccess: () => {
        refreshMembers();
        refreshTeams();
      },
    }),
  );
  const { mutate: leave } = useMutation(
    rpc.team.leave.mutationOptions({
      onSuccess: () => {
        refreshTeams();
        queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
        onClose();
      },
    }),
  );
  const { mutate: deleteTeam } = useMutation(
    rpc.team.delete.mutationOptions({
      onSuccess: () => {
        refreshTeams();
        queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
        onClose();
      },
    }),
  );

  const memberIds = new Set(members?.map((m) => m.id));
  const addable = allUsers?.filter((u) => !memberIds.has(u.id)) ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Team settings</DialogTitle>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              value={name}
              disabled={!isOwner}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {isOwner && name.trim() && name !== team.name && (
            <Button
              type="button"
              size="sm"
              onClick={() => rename({ teamId: team.id, name })}
            >
              Save
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              Members ({members?.length ?? 0})
            </span>
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button type="button" size="sm" variant="outline">
                  <UserPlusIcon />
                  Add
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search people…" className="h-9" />
                  <CommandList>
                    <CommandEmpty>No one to add.</CommandEmpty>
                    <CommandGroup>
                      {addable.map((user) => (
                        <CommandItem
                          key={user.id}
                          value={user.name}
                          onSelect={() => {
                            addMember({ teamId: team.id, userId: user.id });
                            setAddOpen(false);
                          }}
                          className="gap-2"
                        >
                          <UserAvatar
                            id={user.id}
                            name={user.name}
                            image={user.image}
                            size="xs"
                          />
                          {user.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex flex-col gap-1">
            {members?.map((member) => (
              <div
                key={member.id}
                className="group flex items-center gap-2 rounded-md px-1 py-1 text-sm"
              >
                <UserAvatar id={member.id} name={member.name} image={member.image} size="sm" />
                <span className="truncate">{member.name}</span>
                {member.role === "owner" && (
                  <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    owner
                  </span>
                )}
                {isOwner && member.role !== "owner" && (
                  <button
                    type="button"
                    aria-label={`Remove ${member.name}`}
                    onClick={() =>
                      removeMember({ teamId: team.id, userId: member.id })
                    }
                    className="invisible ml-auto text-muted-foreground hover:text-destructive group-hover:visible"
                  >
                    <XIcon className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <SupportSettings teamId={team.id} isOwner={isOwner} />

        <div className="mt-2 border-t border-border pt-3">
          {isOwner ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete team "${team.name}" and all its boards?`,
                  )
                ) {
                  deleteTeam({ teamId: team.id });
                }
              }}
            >
              <Trash2Icon />
              Delete team
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => leave({ teamId: team.id })}
            >
              <LogOutIcon />
              Leave team
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
