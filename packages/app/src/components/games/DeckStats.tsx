import { CrownIcon, FlameIcon, SwordsIcon } from "lucide-react";
import type { Outputs } from "~/lib/rpcClient";

type Stats = Outputs["game"]["decks"]["stats"];
type Row = Stats["cards"][number];

/** Per-card deck statistics. Two distinct "win" notions are tracked side by
 *  side: **1v1 wins** = head-to-head matchups (duels) won, and **titles** =
 *  whole games won (bracket champion). Highlights + a full table; shared by
 *  the deck stats page and the game's winner screen. */
export function DeckStats({ stats }: { stats: Stats }) {
  if (stats.gamesPlayed === 0) {
    return (
      <p className="rounded-lg border border-dashed border-card-border p-6 text-center text-sm text-muted-foreground">
        No completed games yet — play a Versus on this deck to see stats.
      </p>
    );
  }

  const played = stats.cards.filter((c) => c.appearances > 0);
  const mostWins = [...played].sort((a, b) => b.wins - a.wins)[0];
  const champion = [...played].sort(
    (a, b) => b.championships - a.championships,
  )[0];
  const mostPicked = [...played].sort((a, b) => b.votes - a.votes)[0];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground2">
        {stats.gamesPlayed} game{stats.gamesPlayed === 1 ? "" : "s"} played ·{" "}
        <span className="font-medium text-muted-foreground">1v1 wins</span> are
        head-to-head matchups won · <span className="font-medium text-muted-foreground">titles</span>{" "}
        are whole games won (bracket champion).
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Highlight
          icon={<SwordsIcon className="size-4" />}
          label="Most 1v1 wins"
          card={mostWins}
          value={mostWins ? `${mostWins.wins} duels won` : "—"}
        />
        <Highlight
          icon={<CrownIcon className="size-4" />}
          label="Most titles"
          card={champion && champion.championships > 0 ? champion : undefined}
          value={
            champion && champion.championships > 0
              ? `${champion.championships} title${champion.championships === 1 ? "" : "s"}`
              : "—"
          }
        />
        <Highlight
          icon={<FlameIcon className="size-4" />}
          label="Most picked"
          card={mostPicked}
          value={mostPicked ? `${mostPicked.votes} votes` : "—"}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-card-border">
        <table className="w-full text-sm">
          <thead className="bg-card-background text-xs text-muted-foreground2">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Image</th>
              <th
                className="px-3 py-2 text-right font-medium"
                title="Head-to-head matchups (duels) won"
              >
                1v1 wins
              </th>
              <th
                className="px-3 py-2 text-right font-medium"
                title="Share of this image's duels that it won"
              >
                Win%
              </th>
              <th className="px-3 py-2 text-right font-medium">Votes</th>
              <th
                className="px-3 py-2 text-right font-medium"
                title="Matchups this image appeared in"
              >
                Rounds
              </th>
              <th
                className="px-3 py-2 text-right font-medium"
                title="Whole games won — bracket champion"
              >
                Titles 🏆
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {stats.cards.map((c) => (
              <tr key={c.id} className="bg-card-background/40">
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <img
                      src={c.url}
                      alt={c.title}
                      loading="lazy"
                      className="size-9 shrink-0 rounded object-cover"
                    />
                    <span className="truncate">{c.title}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {c.wins}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {c.appearances ? Math.round(c.winRate * 100) : 0}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {c.votes}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground2">
                  {c.appearances}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {c.championships || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Highlight({
  icon,
  label,
  card,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  card: Row | undefined;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-card-border bg-card-background p-3">
      {card ? (
        <img
          src={card.url}
          alt={card.title}
          className="size-12 shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="size-12 shrink-0 rounded-md bg-muted" />
      )}
      <div className="flex min-w-0 flex-col">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground2">
          {icon}
          {label}
        </span>
        <span className="truncate font-medium">{card?.title ?? "—"}</span>
        <span className="text-xs text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}
