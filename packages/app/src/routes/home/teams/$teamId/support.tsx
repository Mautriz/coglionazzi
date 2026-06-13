import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  LifeBuoyIcon,
  MailIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { MessageThread } from "~/components/custom/MessageThread";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/classUtils";
import { rpc } from "~/lib/rpcClient";
import { useSupportInbox } from "~/lib/useRealtime";

export const Route = createFileRoute("/home/teams/$teamId/support")({
  component: RouteComponent,
  validateSearch: z.object({
    ticket: z.string().optional(),
    status: z.enum(["open", "resolved"]).optional(),
    q: z.string().optional(),
  }),
});

function RouteComponent() {
  const { teamId } = Route.useParams();
  const { ticket: activeId, status, q } = Route.useSearch();
  const navigate = useNavigate();
  useSupportInbox(teamId);

  const { data: tickets } = useQuery(
    rpc.support.tickets.list.queryOptions({
      input: { teamId, status, q: q || undefined },
    }),
  );

  const setSearch = (patch: Record<string, string | undefined>) =>
    navigate({
      to: "/home/teams/$teamId/support",
      params: { teamId },
      search: (prev) => {
        const next = { ...prev, ...patch };
        for (const k of ["ticket", "status", "q"] as const)
          if (!next[k]) delete next[k];
        return next;
      },
      replace: true,
    });

  return (
    <main className="flex w-full flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          <LifeBuoyIcon className="size-6 text-primary" />
          Support
        </h1>
        <ClientSupportLink teamId={teamId} />
      </div>

      <div className="flex min-h-0 flex-1 gap-4 max-md:flex-col">
        {/* Inbox */}
        <div
          className={cn(
            "flex w-full shrink-0 flex-col gap-2 md:w-80",
            activeId && "max-md:hidden",
          )}
        >
          <div className="flex items-center gap-2">
            <Input
              value={q ?? ""}
              onChange={(e) => setSearch({ q: e.target.value || undefined })}
              placeholder="Search tickets…"
              className="h-8 text-sm"
            />
            <Select
              value={status ?? "all"}
              onValueChange={(v) =>
                setSearch({ status: v === "all" ? undefined : v })
              }
            >
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1 overflow-y-auto">
            {tickets?.length === 0 && (
              <p className="px-1 py-4 text-sm text-muted-foreground">
                No tickets {status ? `(${status})` : "yet"}.
              </p>
            )}
            {tickets?.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSearch({ ticket: t.id })}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-md border border-card-border bg-card-background px-3 py-2 text-left hover:bg-accent",
                  t.id === activeId && "ring-2 ring-primary",
                )}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {t.requester_name || t.requester_email || "Visitor"}
                  </span>
                  <StatusDot status={t.status} />
                  {t.categoryName && (
                    <span className="ml-auto shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
                      {t.categoryName}
                    </span>
                  )}
                </div>
                <span className="truncate text-xs text-muted-foreground">
                  {t.subject || t.requester_email}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeId ? (
            <TicketDetail
              key={activeId}
              teamId={teamId}
              ticketId={activeId}
              onBack={() => setSearch({ ticket: undefined })}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground max-md:hidden">
              Select a ticket to view the conversation.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/** The customer-facing link: open the live widget page, or copy it to share /
 *  embed elsewhere. Owners can enable the widget inline if it isn't yet. */
function ClientSupportLink({ teamId }: { teamId: string }) {
  const { data: teams } = useQuery(rpc.team.list.queryOptions());
  const isOwner = teams?.find((t) => t.id === teamId)?.isOwner ?? false;
  const { data: widget, refetch } = useQuery(
    rpc.support.widgetKey.queryOptions({ input: { teamId } }),
  );
  const { mutate: enable, isPending } = useMutation(
    rpc.support.enableWidget.mutationOptions({
      onSuccess: () => refetch(),
      onError: (e) => toast.error(e.message),
    }),
  );
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (widget?.widgetKey) {
    const url = `${origin}/widget?key=${widget.widgetKey}`;
    const snippet = `<script src="${origin}/widget.js" data-widget-key="${widget.widgetKey}" data-position="left"></script>`;
    const copy = (what: "link" | "embed", text: string, label: string) => {
      navigator.clipboard.writeText(text);
      setCopied(what);
      toast.success(label);
      setTimeout(() => setCopied(null), 1500);
    };
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Button asChild size="sm" variant="outline">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLinkIcon className="size-4" />
            Open client chat
          </a>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => copy("link", url, "Client link copied")}
        >
          {copied === "link" ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          Copy link
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => copy("embed", snippet, "Embed snippet copied")}
        >
          {copied === "embed" ? (
            <CheckIcon className="size-4" />
          ) : (
            <CodeIcon className="size-4" />
          )}
          Copy widget
        </Button>
      </div>
    );
  }

  if (isOwner) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => enable({ teamId })}
      >
        {isPending ? "Enabling…" : "Enable client support"}
      </Button>
    );
  }

  return (
    <span className="text-xs text-muted-foreground">
      Client widget not enabled yet.
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "open" ? "bg-green-500" : "bg-muted-foreground/40",
      )}
      title={status}
    />
  );
}

function TicketDetail({
  teamId,
  ticketId,
  onBack,
}: {
  teamId: string;
  ticketId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: ticket } = useQuery(
    rpc.support.tickets.get.queryOptions({ input: { ticketId } }),
  );
  const { data: categories } = useQuery(
    rpc.support.categories.list.queryOptions({ input: { teamId } }),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: rpc.support.tickets.get.queryKey({ input: { ticketId } }),
    });
    queryClient.invalidateQueries({ queryKey: rpc.support.tickets.list.key() });
  };

  const { mutate: setStatus } = useMutation(
    rpc.support.tickets.setStatus.mutationOptions({ onSuccess: invalidate }),
  );
  const { mutate: setCategory } = useMutation(
    rpc.support.tickets.setCategory.mutationOptions({ onSuccess: invalidate }),
  );

  if (!ticket) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-card-border bg-card-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="xs"
          className="md:hidden"
          onClick={onBack}
        >
          ← Back
        </Button>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <MailIcon className="size-3.5 text-muted-foreground" />
            <span className="truncate">
              {ticket.requester_name
                ? `${ticket.requester_name} · ${ticket.requester_email}`
                : ticket.requester_email || "Visitor"}
            </span>
          </p>
          {ticket.subject && (
            <p className="truncate text-xs text-muted-foreground">
              {ticket.subject}
            </p>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Select
            value={ticket.category_id ?? "none"}
            onValueChange={(v) =>
              setCategory({ ticketId, categoryId: v === "none" ? null : v })
            }
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No category</SelectItem>
              {categories?.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            size="sm"
            variant={ticket.status === "open" ? "default" : "outline"}
            onClick={() =>
              setStatus({
                ticketId,
                status: ticket.status === "open" ? "resolved" : "open",
              })
            }
          >
            {ticket.status === "open" ? "Mark resolved" : "Reopen"}
          </Button>
        </div>
      </div>

      <MessageThread
        key={ticketId}
        roomRef={{ scope: "support", ticketId }}
        className="min-h-0 flex-1"
        maxHeightClass="flex-1"
        composerPlaceholder="Reply to the customer… (⌘/Ctrl+Enter to send)"
        emptyText="No messages."
      />
    </div>
  );
}
