import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  ClockIcon,
  CrownIcon,
  LockIcon,
  Share2Icon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DeckStats } from "~/components/games/DeckStats";
import { UserAvatar } from "~/components/custom/UserAvatar";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/classUtils";
import { rpc, type Outputs } from "~/lib/rpcClient";
import { useGameSession } from "~/lib/useGameSession";

export const Route = createFileRoute("/home/games/$sessionId")({
  component: RouteComponent,
  loader: async ({ context, params }) => {
    try {
      return await context.queryClient.ensureQueryData(
        rpc.game.sessions.get.queryOptions({
          input: { sessionId: params.sessionId },
        }),
      );
    } catch {
      throw redirect({ to: "/home/games" });
    }
  },
});

type Session = Outputs["game"]["sessions"]["get"];

function RouteComponent() {
  const { sessionId } = Route.useParams();
  const { session, players, liveVotes, reveal } = useGameSession(sessionId);

  if (!session) return null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 py-8">
      <Header session={session} />
      {session.status === "lobby" && (
        <Lobby session={session} livePlayers={players} />
      )}
      {session.status === "active" && (
        <ActiveMatchup session={session} liveVotes={liveVotes} reveal={reveal} />
      )}
      {session.status === "finished" && <Finished session={session} />}
    </main>
  );
}

function Header({ session }: { session: Session }) {
  function share() {
    navigator.clipboard.writeText(window.location.href);
    toast("Link copied — send it to your friends");
  }
  return (
    <div className="flex items-center gap-3">
      <h1 className="font-display text-2xl font-bold">{session.deckName}</h1>
      <span className="rounded-full border border-card-border px-2 py-0.5 text-xs text-muted-foreground">
        Versus
      </span>
      {session.visibility === "private" && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground2">
          <LockIcon className="size-3" />
          private
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto text-muted-foreground"
        onClick={share}
      >
        <Share2Icon />
        Share
      </Button>
    </div>
  );
}

function Lobby({
  session,
  livePlayers,
}: {
  session: Session;
  livePlayers: { userId: string; name: string | null }[] | null;
}) {
  const players = livePlayers ?? session.players;
  const [cardCount, setCardCount] = useState(
    session.validSizes.at(-1)?.toString() ?? "",
  );

  const { mutate: start, isPending } = useMutation(
    rpc.game.versus.start.mutationOptions({
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-card-border bg-card-background p-5">
        <h2 className="flex items-center gap-2 font-display font-semibold">
          <UsersIcon className="size-4 text-primary" />
          In the lobby ({players.length})
        </h2>
        <div className="flex flex-wrap gap-3">
          {players.map((p) => (
            <span key={p.userId} className="flex items-center gap-1.5 text-sm">
              <UserAvatar id={p.userId} name={p.name ?? "?"} />
              {p.name ?? "Someone"}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground2">
          Everyone here when the host starts is locked in as a voter. Share the
          link to pull more people in.
        </p>
      </section>

      {session.isHost ? (
        session.validSizes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This deck needs at least 2 images before you can play. Add more in
            the deck editor.
          </p>
        ) : (
          <div className="flex items-end gap-3 rounded-lg border border-card-border bg-card-background p-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                How many images?
              </span>
              <Select value={cardCount} onValueChange={setCardCount}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {session.validSizes.map((n) => (
                    <SelectItem key={n} value={n.toString()}>
                      {n} cards · {Math.log2(n)} rounds
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              disabled={isPending || !cardCount}
              onClick={() =>
                start({ sessionId: session.id, cardCount: Number(cardCount) })
              }
            >
              Start game
            </Button>
          </div>
        )
      ) : (
        <p className="animate-pulse text-sm text-muted-foreground">
          Waiting for {session.hostName ?? "the host"} to start the game…
        </p>
      )}
    </div>
  );
}

/** Seconds remaining until an ISO deadline, ticking each second. */
function useCountdown(deadline: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

function ActiveMatchup({
  session,
  liveVotes,
  reveal,
}: {
  session: Session;
  liveVotes: ReturnType<typeof useGameSession>["liveVotes"];
  reveal: ReturnType<typeof useGameSession>["reveal"];
}) {
  const current = session.currentMatchup;
  const [localVote, setLocalVote] = useState<{
    matchupId: string;
    choice: "left" | "right";
  } | null>(null);

  const { mutate: vote } = useMutation(
    rpc.game.versus.vote.mutationOptions({
      onError: (e) => toast.error(e.message),
    }),
  );

  // Merge live deltas over the snapshot when they're for THIS matchup.
  const fresh = current && liveVotes?.matchupId === current.id ? liveVotes : null;
  const seconds = useCountdown(fresh?.deadline ?? current?.deadline);

  // Just resolved → reveal the winning card (zoom) until the next matchup opens.
  if (reveal && current && reveal.matchupId === current.id) {
    const winner =
      reveal.winnerCardId === current.left?.id
        ? current.left
        : reveal.winnerCardId === current.right?.id
          ? current.right
          : null;
    if (winner) return <WinnerReveal card={winner} />;
  }

  if (!current) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Setting up the next matchup…
      </p>
    );
  }

  const leftVotes = fresh?.leftVotes ?? current.leftVotes;
  const rightVotes = fresh?.rightVotes ?? current.rightVotes;
  const votedCount = fresh?.votedCount ?? current.votedCount;
  const rosterSize = fresh?.rosterSize ?? current.rosterSize;
  const myVote =
    localVote?.matchupId === current.id ? localVote.choice : current.myVote;

  function cast(choice: "left" | "right") {
    if (!session.canVote) return;
    setLocalVote({ matchupId: current!.id, choice });
    vote({ matchupId: current!.id, choice });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Round {current.round}
          {session.totalRounds ? ` of ${session.totalRounds}` : ""}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-2 font-mono text-3xl font-bold tabular-nums",
            seconds === null
              ? "text-muted-foreground2"
              : seconds <= 10
                ? "animate-pulse text-destructive"
                : "text-foreground",
          )}
        >
          <ClockIcon className="size-6" />
          {seconds === null ? "—" : `0:${seconds.toString().padStart(2, "0")}`}
        </span>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <UsersIcon className="size-4" />
          {votedCount}/{rosterSize}
        </span>
      </div>

      <div className="relative grid grid-cols-2 gap-3 sm:gap-5">
        <Contender
          side="left"
          card={current.left}
          votes={leftVotes}
          total={leftVotes + rightVotes}
          picked={myVote === "left"}
          canVote={session.canVote}
          onPick={() => cast("left")}
        />
        <Contender
          side="right"
          card={current.right}
          votes={rightVotes}
          total={leftVotes + rightVotes}
          picked={myVote === "right"}
          canVote={session.canVote}
          onPick={() => cast("right")}
        />
        {/* Center clash badge (brand gradient). */}
        <span className="special pointer-events-none absolute left-1/2 top-1/2 z-10 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-display text-lg font-black shadow-xl ring-4 ring-background">
          VS
        </span>
      </div>

      {session.canVote ? (
        <p className="text-center text-xs text-muted-foreground2">
          Tap an image to vote — change it any time before the timer ends.
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground2">
          You're spectating — only players who were in the lobby at start can
          vote.
        </p>
      )}
    </div>
  );
}

const SIDE = {
  left: {
    border: "border-blue1",
    ring: "ring-blue1",
    tint: "from-blue1/50",
    bar: "bg-blue1",
    badge: "text-blue1",
    glow: "shadow-[0_0_35px_-5px] shadow-blue1/60",
  },
  right: {
    border: "border-red1",
    ring: "ring-red1",
    tint: "from-red1/50",
    bar: "bg-red1",
    badge: "text-red1",
    glow: "shadow-[0_0_35px_-5px] shadow-red1/60",
  },
} as const;

function Contender({
  side,
  card,
  votes,
  total,
  picked,
  canVote,
  onPick,
}: {
  side: "left" | "right";
  card: { id: string; title: string; description: string | null; url: string } | null;
  votes: number;
  total: number;
  picked: boolean;
  canVote: boolean;
  onPick: () => void;
}) {
  if (!card) return <div />;
  const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
  const s = SIDE[side];
  return (
    <button
      type="button"
      disabled={!canVote}
      onClick={onPick}
      className={cn(
        "group relative aspect-4/5 overflow-hidden rounded-2xl border-2 text-left transition-all duration-200",
        picked ? cn(s.border, "ring-4", s.ring, s.glow) : "border-card-border",
        canVote && "cursor-pointer hover:-translate-y-1 hover:shadow-2xl",
      )}
    >
      <img
        src={card.url}
        alt={card.title}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
      {/* side color wash + readability scrim */}
      <div
        className={cn(
          "absolute inset-0 bg-linear-to-t to-transparent opacity-70 mix-blend-overlay",
          s.tint,
        )}
      />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-black/90 via-black/40 to-transparent" />

      <span
        className={cn(
          "absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 font-mono text-xl font-black tabular-nums backdrop-blur-sm",
          s.badge,
        )}
      >
        {votes}
      </span>
      {picked && (
        <span
          className={cn(
            "absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-bold backdrop-blur-sm",
            s.badge,
          )}
        >
          <CheckCircle2Icon className="size-3.5" />
          your pick
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-4">
        <span className="font-display text-xl font-bold text-white drop-shadow-lg sm:text-2xl">
          {card.title}
        </span>
        {card.description && (
          <span className="line-clamp-2 text-xs text-white/75">
            {card.description}
          </span>
        )}
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className={cn("h-full rounded-full transition-all duration-500", s.bar)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="w-9 text-right text-xs font-bold tabular-nums text-white">
            {pct}%
          </span>
        </div>
      </div>
    </button>
  );
}

/** Mount-scale flag for zoom-in reveals. */
function useZoomIn() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return shown;
}

/** A round's winning card zooming in, shown between matchups. */
function WinnerReveal({ card }: { card: { title: string; url: string } }) {
  const shown = useZoomIn();
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-primary">
        <SparklesIcon className="size-4" />
        Winner
      </span>
      <div
        className={cn(
          "aspect-4/5 w-60 max-w-full overflow-hidden rounded-2xl border-2 border-primary shadow-2xl transition-all duration-500 ease-out",
          shown ? "scale-100 opacity-100" : "scale-50 opacity-0",
        )}
      >
        <img
          src={card.url}
          alt={card.title}
          className="h-full w-full object-cover"
        />
      </div>
      <span className="font-display text-2xl font-bold">{card.title}</span>
    </div>
  );
}

function Finished({ session }: { session: Session }) {
  const navigate = useNavigate();
  const cardById = new Map(session.cards.map((c) => [c.id, c]));
  const shown = useZoomIn();
  const { data: stats } = useQuery(
    rpc.game.decks.stats.queryOptions({ input: { deckId: session.deckId } }),
  );

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col items-center gap-4 rounded-2xl border border-primary/40 bg-card-background p-8">
        <span className="inline-flex items-center gap-2 font-display text-xl font-black text-primary">
          <CrownIcon className="size-7" />
          Champion
        </span>
        {session.winner && (
          <>
            <div
              className={cn(
                "aspect-4/5 w-64 max-w-full overflow-hidden rounded-2xl border-2 border-primary shadow-2xl transition-all duration-700 ease-out",
                shown ? "scale-100 opacity-100" : "scale-75 opacity-0",
              )}
            >
              <img
                src={session.winner.url}
                alt={session.winner.title}
                className="h-full w-full object-cover"
              />
            </div>
            <span className="font-display text-2xl font-bold">
              {session.winner.title}
            </span>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: "/home/games" })}
        >
          Back to games
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold">Deck stats</h2>
        {stats ? (
          <DeckStats stats={stats} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading stats…</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display font-semibold">This game</h2>
        <ul className="flex flex-col gap-1.5">
          {session.matchups.map((m) => {
            const left = cardById.get(m.leftCardId);
            const right = cardById.get(m.rightCardId);
            return (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-md border border-card-border bg-card-background px-3 py-2 text-sm"
              >
                <span className="text-xs text-muted-foreground2">
                  R{m.round}
                </span>
                <span
                  className={cn(
                    "flex-1 truncate text-right",
                    m.winnerCardId === m.leftCardId && "font-semibold text-primary",
                  )}
                >
                  {left?.title ?? "?"} ({m.leftVotes})
                </span>
                <span className="text-xs text-muted-foreground2">vs</span>
                <span
                  className={cn(
                    "flex-1 truncate",
                    m.winnerCardId === m.rightCardId &&
                      "font-semibold text-primary",
                  )}
                >
                  ({m.rightVotes}) {right?.title ?? "?"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
