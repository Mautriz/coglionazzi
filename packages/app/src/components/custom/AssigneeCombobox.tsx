import { useQuery } from "@tanstack/react-query";
import { UsersIcon, XIcon } from "lucide-react";
import { ComboboxMultiSelect } from "~/components/custom/ComboboxMultiSelect";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { rpc } from "~/lib/rpcClient";

type UserOption = { id: string; name: string; image: string | null };

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
  const { data: users } = useQuery(
    teamId
      ? rpc.team.members.queryOptions({ input: { teamId } })
      : rpc.user.list.queryOptions(),
  );

  const byId = new Map((users ?? []).map((u) => [u.id, u as UserOption]));
  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  return (
    <ComboboxMultiSelect<UserOption>
      selected={selected}
      onToggle={toggle}
      options={(users ?? []) as UserOption[]}
      getKey={(u) => u.id}
      getOptionValue={(u) => u.name}
      icon={<UsersIcon className="size-4" />}
      label={
        selected.length > 0 ? `${selected.length} assigned` : placeholder
      }
      searchPlaceholder="Search people…"
      emptyText="No one found."
      className={className}
      renderChip={(id, remove) => {
        const user = byId.get(id);
        if (!user) return null;
        return (
          <span
            key={id}
            className="flex items-center gap-1.5 rounded-full border border-card-border bg-accent py-0.5 pl-0.5 pr-1.5 text-xs"
          >
            <UserAvatar id={user.id} name={user.name} image={user.image} size="xs" />
            {user.name}
            <button
              type="button"
              aria-label={`Remove ${user.name}`}
              onClick={remove}
              className="text-muted-foreground hover:text-destructive"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        );
      }}
      renderOption={(user) => (
        <>
          <UserAvatar id={user.id} name={user.name} image={user.image} size="xs" />
          <span className="truncate">{user.name}</span>
        </>
      )}
    />
  );
}
