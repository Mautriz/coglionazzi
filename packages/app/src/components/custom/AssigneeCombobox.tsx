import { useQuery } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, UsersIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/classUtils";
import { rpc } from "~/lib/rpcClient";

/** Searchable multi-select of people. Scoped to a team's members when
 *  `teamId` is given (assignees, filters on a board); falls back to all
 *  users otherwise. Controlled by the selected user-id array; selected
 *  users render as removable avatar chips above the trigger. */
export function AssigneeCombobox({
  selected,
  onChange,
  teamId,
  placeholder = "Assign people…",
  className,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Limit options to this team's members. */
  teamId?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: users } = useQuery(
    teamId
      ? rpc.team.members.queryOptions({ input: { teamId } })
      : rpc.user.list.queryOptions(),
  );

  const byId = new Map(users?.map((u) => [u.id, u]));
  const chosen = selected.map((id) => byId.get(id)).filter(Boolean) as {
    id: string;
    name: string;
  }[];

  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((user) => (
            <span
              key={user.id}
              className="flex items-center gap-1.5 rounded-full border border-card-border bg-accent py-0.5 pl-0.5 pr-1.5 text-xs"
            >
              <UserAvatar id={user.id} name={user.name} size="xs" />
              {user.name}
              <button
                type="button"
                aria-label={`Remove ${user.name}`}
                onClick={() => toggle(user.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 justify-between font-normal text-muted-foreground"
          >
            <span className="flex items-center gap-2">
              <UsersIcon className="size-4" />
              {chosen.length > 0 ? `${chosen.length} assigned` : placeholder}
            </span>
            <ChevronsUpDownIcon className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search people…" className="h-9" />
            <CommandList>
              <CommandEmpty>No one found.</CommandEmpty>
              <CommandGroup>
                {users?.map((user) => {
                  const active = selected.includes(user.id);
                  return (
                    <CommandItem
                      key={user.id}
                      value={user.name}
                      onSelect={() => toggle(user.id)}
                      className="gap-2"
                    >
                      <UserAvatar id={user.id} name={user.name} size="xs" />
                      <span className="truncate">{user.name}</span>
                      <CheckIcon
                        className={cn(
                          "ml-auto size-4 text-primary",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
