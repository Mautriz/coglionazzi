import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  ArchiveIcon,
  LinkIcon,
  MessageSquareIcon,
  PaperclipIcon,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ArchivedCardDialog } from "~/components/boards/ArchivedCardDialog";
import { TagBadge } from "~/components/boards/TagBadge";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { cardMatchesFilters, isFilterActive } from "~/lib/cardFilters";
import { rpc } from "~/lib/rpcClient";

export const Route = createFileRoute("/home/teams/$teamId/archive")({
  component: RouteComponent,
  // Same filter params as the board view (kept in the URL so filtered archive
  // views are shareable); `card` opens a specific archived card.
  validateSearch: z.object({
    card: z.string().optional(),
    q: z.string().optional(),
    tags: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(
        rpc.archive.list.queryOptions({ input: { teamId: params.teamId } }),
      );
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "FORBIDDEN" || code === "NOT_FOUND") {
        throw redirect({ to: "/home" });
      }
      throw err;
    }
  },
});

function RouteComponent() {
  const { teamId } = Route.useParams();
  const queryClient = useQueryClient();

  const listQuery = rpc.archive.list.queryOptions({ input: { teamId } });
  const { data: cards } = useSuspenseQuery(listQuery);
  const { data: teams } = useQuery(rpc.team.list.queryOptions());
  const teamName = teams?.find((t) => t.id === teamId)?.name;

  const { card: cardParam, ...filters } = Route.useSearch();
  const [openCardId, setOpenCardId] = useState<string | null>(
    cardParam ?? null,
  );

  const visible = isFilterActive(filters)
    ? cards.filter((c) => cardMatchesFilters(c, filters))
    : cards;

  const openCard = cards.find((c) => c.id === openCardId) ?? null;

  return (
    <main className="flex w-full flex-1 flex-col gap-5 p-4 py-6">
      <div className="flex items-baseline gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          <ArchiveIcon className="size-5 text-muted-foreground" />
          Archive
        </h1>
        {teamName && (
          <span className="text-sm text-muted-foreground">{teamName}</span>
        )}
        <span className="text-sm text-muted-foreground">
          {isFilterActive(filters)
            ? `${visible.length}/${cards.length} cards`
            : `${cards.length} card${cards.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          {cards.length === 0
            ? "Nothing archived yet. Archived cards and the cards of deleted columns/boards land here."
            : "No archived cards match the filters."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-card-border overflow-hidden rounded-lg border border-card-border">
          {visible.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => setOpenCardId(card.id)}
                className="flex w-full items-center gap-3 bg-card-background px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium">
                    {card.title}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground2">
                    {card.archived_origin && (
                      <span className="truncate">{card.archived_origin}</span>
                    )}
                    {card.tags.map((tag) => (
                      <TagBadge key={tag} tag={tag} />
                    ))}
                    {card.attachments.length > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <PaperclipIcon className="size-3" />
                        {card.attachments.length}
                      </span>
                    )}
                    {card.commentCount > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <MessageSquareIcon className="size-3" />
                        {card.commentCount}
                      </span>
                    )}
                    {card.relations.length > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <LinkIcon className="size-3" />
                        {card.relations.length}
                      </span>
                    )}
                  </span>
                </span>

                {card.assignees.length > 0 && (
                  <span className="inline-flex shrink-0 -space-x-1.5">
                    {card.assignees.slice(0, 3).map((a) => (
                      <UserAvatar key={a.id} id={a.id} name={a.name} size="xs" />
                    ))}
                  </span>
                )}

                <span className="shrink-0 text-xs text-muted-foreground2">
                  {card.archived_at &&
                    new Date(card.archived_at).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openCard && (
        <ArchivedCardDialog
          card={openCard}
          teamId={teamId}
          onClose={() => setOpenCardId(null)}
          onChanged={() => {
            // Re-fetch after restore/purge/comment changes; a restore also
            // changes board card counts.
            queryClient.invalidateQueries({ queryKey: listQuery.queryKey });
            queryClient.invalidateQueries({ queryKey: rpc.board.list.key() });
          }}
        />
      )}
    </main>
  );
}
