import { FilterIcon } from "lucide-react";
import { AssigneeCombobox } from "~/components/custom/AssigneeCombobox";
import { DatePicker } from "~/components/custom/DatePicker";
import { TagCombobox } from "~/components/custom/TagCombobox";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { isFilterActive, type CardFilters } from "~/lib/cardFilters";

/** The card filter controls — one shared, stacked panel used by both the board
 *  view and the archive view (rendered in the team panel for both, so
 *  filtering looks identical everywhere). Same filters (text / tags /
 *  assignees / created range) over the same `CardFilters` search params. The
 *  parent owns the search-param state; `onPatch` receives a partial to merge
 *  (see `mergeFilters`). */
export function CardFiltersPanel({
  filters,
  onPatch,
  teamId,
}: {
  filters: CardFilters;
  onPatch: (patch: Partial<CardFilters>) => void;
  teamId: string | undefined;
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

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-sidebar-border pt-4">
      <div className="flex items-center justify-between px-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground2">
          <FilterIcon className="size-3" />
          Filters
        </h2>
        {active && (
          <Button
            variant="link"
            size="xs"
            className="text-link"
            onClick={clear}
          >
            clear
          </Button>
        )}
      </div>

      <Input
        value={filters.q ?? ""}
        onChange={(e) => onPatch({ q: e.target.value || undefined })}
        placeholder="Filter by text…"
        className="h-7 text-sm"
      />

      <div className="flex flex-col gap-1.5 px-1">
        <Label className="text-xs text-muted-foreground">Tags</Label>
        <TagCombobox
          selected={filters.tags ?? []}
          onChange={(tags) => onPatch({ tags: tags.length ? tags : undefined })}
          teamId={teamId}
          placeholder="Filter by tags…"
        />
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
