import { CrownIcon, FlameIcon } from "lucide-react";
import type { Outputs } from "~/lib/rpcClient";

type Stats = Outputs["game"]["decks"]["stats"];
type Row = Stats["cards"][number];

/** Per-card deck statistics — highlights (most wins / most picked) + a full
 *  table. Shared by the deck stats page and the game's winner screen. */
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
  const mostPicked = [...played].sort((a, b) => b.votes - a.votes)[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Highlight
          icon={<CrownIcon className="size-4" />}
          label="Most wins"
          card={mostWins}
          value={mostWins ? `${mostWins.wins} wins` : "—"}
        />
        <Highlight
          icon={<FlameIcon className="size-4" />}
          label="Most picked"
          card={mostPicked}
          value={mostPicked ? `${mostPicked.votes} votes` : "—"}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-card-border">
        <table className="w-full text-sm">
          <thead className="bg-card-background text-xs text-muted-foreground2">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Image</th>
              <th className="px-3 py-2 text-right font-medium">Wins</th>
              <th className="px-3 py-2 text-right font-medium">Win%</th>
              <th className="px-3 py-2 text-right font-medium">Votes</th>
              <th className="px-3 py-2 text-right font-medium">Rounds</th>
              <th className="px-3 py-2 text-right font-medium">🏆</th>
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
                <td className="px-3 py-2 text-right tabular-nums">
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
