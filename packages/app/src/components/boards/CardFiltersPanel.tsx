import { FilterIcon } from "lucide-react";
import { TagBadge } from "~/components/boards/TagBadge";
import { AssigneeCombobox } from "~/components/custom/AssigneeCombobox";
import { DatePicker } from "~/components/custom/DatePicker";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/classUtils";
import { isFilterActive, type CardFilters } from "~/lib/cardFilters";

/** The card filter controls, shared by the board view and the archive view.
 *  Same filters (text / tags / assignees / created range) over the same
 *  `CardFilters` search params — only the layout differs:
 *  - `"rail"`: stacked, compact, for the narrow boards sidebar.
 *  - `"bar"`: horizontal, labelled, for the full-width archive header.
 *  The parent owns the search-param state; `onPatch` receives a partial to
 *  merge (see `mergeFilters`). */
export function CardFiltersPanel({
  filters,
  onPatch,
  allTags,
  teamId,
  layout,
}: {
  filters: CardFilters;
  onPatch: (patch: Partial<CardFilters>) => void;
  allTags: string[];
  teamId: string | undefined;
  layout: "rail" | "bar";
}) {
  const active = isFilterActive(filters);

  const toggleTag = (tag: string) => {
    const tags = filters.tags ?? [];
    onPatch({
      tags: tags.includes(tag)
        ? tags.filter((t) => t !== tag)
        : [...tags, tag],
    });
  };

  const clear = () =>
    onPatch({
      q: undefined,
      tags: undefined,
      assignees: undefined,
      from: undefined,
      to: undefined,
    });

  const clearButton = active && (
    <Button
      variant="link"
      size={layout === "rail" ? "xs" : "sm"}
      className="text-link"
      onClick={clear}
    >
      clear
    </Button>
  );

  const tagChips = allTags.length > 0 && (
    <div className="flex flex-wrap gap-1">
      {allTags.map((tag) => (
        <button key={tag} type="button" onClick={() => toggleTag(tag)}>
          <TagBadge
            tag={tag}
            className={cn(
              "cursor-pointer",
              !filters.tags?.includes(tag) && "opacity-50",
            )}
          />
        </button>
      ))}
    </div>
  );

  if (layout === "rail") {
    return (
      <div className="mt-5 flex flex-col gap-3 border-t border-sidebar-border pt-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground2">
            <FilterIcon className="size-3" />
            Filters
          </h2>
          {clearButton}
        </div>

        <Input
          value={filters.q ?? ""}
          onChange={(e) => onPatch({ q: e.target.value || undefined })}
          placeholder="Filter by text…"
          className="h-7 text-sm"
        />

        {tagChips && (
          <div className="flex flex-col gap-1.5 px-1">
            <Label className="text-xs text-muted-foreground">Tags</Label>
            {tagChips}
          </div>
        )}

        <div className="flex flex-col gap-1.5 px-1">
          <Label className="text-xs text-muted-foreground">Assignees</Label>
          <AssigneeCombobox
            selected={filters.assignees ?? []}
            onChange={(ids) => onPatch({ assignees: ids })}
            teamId={teamId}
            placeholder="Filter by assignee…"
          />
        </div>

        <div className="flex flex-col gap-1.5 px-1">
          <Label className="text-xs text-muted-foreground">Created</Label>
          {/* Stacked — two pickers + arrow don't fit the narrow rail. */}
          <div className="flex flex-col gap-1.5">
            <DatePicker
              value={filters.from}
              onChange={(v) => onPatch({ from: v })}
              placeholder="From date"
              className="w-full"
            />
            <DatePicker
              value={filters.to}
              onChange={(v) => onPatch({ to: v })}
              placeholder="To date"
              className="w-full"
            />
          </div>
        </div>
      </div>
    );
  }

  // layout === "bar"
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-card-border bg-card-background p-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Text</Label>
        <Input
          value={filters.q ?? ""}
          onChange={(e) => onPatch({ q: e.target.value || undefined })}
          placeholder="Filter by text…"
          className="h-8 w-48 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Assignees</Label>
        <div className="w-56">
          <AssigneeCombobox
            selected={filters.assignees ?? []}
            onChange={(ids) => onPatch({ assignees: ids })}
            teamId={teamId}
            placeholder="Filter by assignee…"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Created from</Label>
        <DatePicker
          value={filters.from}
          onChange={(v) => onPatch({ from: v })}
          placeholder="From date"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Created to</Label>
        <DatePicker
          value={filters.to}
          onChange={(v) => onPatch({ to: v })}
          placeholder="To date"
        />
      </div>
      {clearButton}
      {tagChips && <div className="w-full">{tagChips}</div>}
    </div>
  );
}
