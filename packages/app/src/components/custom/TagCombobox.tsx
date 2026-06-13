import { useQuery } from "@tanstack/react-query";
import { PlusIcon, TagIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { ComboboxMultiSelect } from "~/components/custom/ComboboxMultiSelect";
import { TagBadge } from "~/components/boards/TagBadge";
import { CommandGroup, CommandItem } from "~/components/ui/command";
import { rpc } from "~/lib/rpcClient";

/** Searchable multi-select of tags. Suggestions are the team's existing tags
 *  (`board.teamTags`); a "Create" row appears ONLY when the typed text matches
 *  no existing tag. Tags are plain strings — "creating" one just adds it to the
 *  selection (it becomes a suggestion once a card with it is saved). Controlled
 *  by the selected string array; chosen tags render as removable chips. */
export function TagCombobox({
  selected,
  onChange,
  teamId,
  placeholder = "Add tags…",
  className,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
  /** Team whose existing tags are suggested. */
  teamId?: string;
  placeholder?: string;
  className?: string;
}) {
  const [search, setSearch] = useState("");

  const { data: known } = useQuery({
    ...rpc.board.teamTags.queryOptions({ input: { teamId: teamId ?? "" } }),
    enabled: Boolean(teamId),
  });

  const toggle = (tag: string) =>
    onChange(
      selected.includes(tag)
        ? selected.filter((t) => t !== tag)
        : [...selected, tag],
    );

  const trimmed = search.trim();
  const options = known ?? [];
  // Offer "Create" only when the query is non-empty, not already a known tag,
  // and not already selected (case-insensitive).
  const lower = trimmed.toLowerCase();
  const canCreate =
    trimmed.length > 0 &&
    !options.some((t) => t.toLowerCase() === lower) &&
    !selected.some((t) => t.toLowerCase() === lower);

  const create = () => {
    toggle(trimmed);
    setSearch("");
  };

  return (
    <ComboboxMultiSelect<string>
      selected={selected}
      onToggle={toggle}
      options={options}
      getKey={(tag) => tag}
      icon={<TagIcon className="size-4" />}
      label={selected.length > 0 ? `${selected.length} tag(s)` : placeholder}
      searchPlaceholder="Search or create a tag…"
      emptyText={canCreate ? undefined : "No tags."}
      search={search}
      onSearchChange={setSearch}
      loop
      className={className}
      chipsClassName="gap-1"
      renderChip={(tag, remove) => (
        <TagBadge key={tag} tag={tag} className="gap-1 pr-1">
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={remove}
            className="text-muted-foreground hover:text-destructive"
          >
            <XIcon className="size-3" />
          </button>
        </TagBadge>
      )}
      renderOption={(tag) => <TagBadge tag={tag} />}
    >
      {canCreate && (
        <CommandGroup>
          <CommandItem value={`__create__${trimmed}`} onSelect={create}>
            <PlusIcon className="size-4" />
            Create “{trimmed}”
          </CommandItem>
        </CommandGroup>
      )}
    </ComboboxMultiSelect>
  );
}
