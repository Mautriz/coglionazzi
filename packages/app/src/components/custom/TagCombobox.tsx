import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon, PlusIcon, TagIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { TagBadge } from "~/components/boards/TagBadge";
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
import { CheckIcon } from "lucide-react";
import { cn } from "~/lib/classUtils";
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
  const [open, setOpen] = useState(false);
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((tag) => (
            <TagBadge key={tag} tag={tag} className="gap-1 pr-1">
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => toggle(tag)}
                className="text-muted-foreground hover:text-destructive"
              >
                <XIcon className="size-3" />
              </button>
            </TagBadge>
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
              <TagIcon className="size-4" />
              {selected.length > 0 ? `${selected.length} tag(s)` : placeholder}
            </span>
            <ChevronsUpDownIcon className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command loop>
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search or create a tag…"
              className="h-9"
            />
            <CommandList>
              {!canCreate && <CommandEmpty>No tags.</CommandEmpty>}
              {canCreate && (
                <CommandGroup>
                  <CommandItem value={`__create__${trimmed}`} onSelect={create}>
                    <PlusIcon className="size-4" />
                    Create “{trimmed}”
                  </CommandItem>
                </CommandGroup>
              )}
              {options.length > 0 && (
                <CommandGroup>
                  {options.map((tag) => {
                    const active = selected.includes(tag);
                    return (
                      <CommandItem
                        key={tag}
                        value={tag}
                        onSelect={() => toggle(tag)}
                        className="gap-2"
                      >
                        <TagBadge tag={tag} />
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
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
