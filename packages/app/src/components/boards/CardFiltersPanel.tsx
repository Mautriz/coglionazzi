import { FilterIcon } from "lucide-react";
import { AssigneeCombobox } from "~/components/custom/AssigneeCombobox";
import { DatePicker } from "~/components/custom/DatePicker";
import { TagCombobox } from "~/components/custom/TagCombobox";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
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
  teamId,
  layout,
}: {
  filters: CardFilters;
  onPatch: (patch: Partial<CardFilters>) => void;
  teamId: string | undefined;
  layout: "rail" | "bar";
}) {
  const active = isFilterActive(filters);

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

  const tagFilter = (
    <TagCombobox
      selected={filters.tags ?? []}
      onChange={(tags) => onPatch({ tags: tags.length ? tags : undefined })}
      teamId={teamId}
      placeholder="Filter by tags…"
    />
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

        <div className="flex flex-col gap-1.5 px-1">
          <Label className="text-xs text-muted-foreground">Tags</Label>
          {tagFilter}
        </div>

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
        <Label className="text-xs text-muted-foreground">Tags</Label>
        <div className="w-56">{tagFilter}</div>
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
    </div>
  );
}
