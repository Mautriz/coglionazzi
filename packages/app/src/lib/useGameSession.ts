import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { rpc } from "~/lib/rpcClient";

type LiveVotes = {
  matchupId: string;
  leftVotes: number;
  rightVotes: number;
  votedCount: number;
  rosterSize: number;
  deadline: string;
};

/** Seed a game session from `game.sessions.get`, then stream live updates:
 *  - `presence` → live lobby roster
 *  - `votes`    → live tallies + (possibly shortened) deadline for the current
 *                 matchup
 *  - `state`    → a structural change (matchup opened/resolved, game finished)
 *                 → refetch the snapshot and drop the stale vote overlay.
 *  Mirrors the board/chat realtime split: high-frequency votes stream as
 *  deltas, low-frequency transitions signal-and-refetch. */
export function useGameSession(sessionId: string) {
  const queryClient = useQueryClient();
  const getOptions = rpc.game.sessions.get.queryOptions({
    input: { sessionId },
  });
  const sessionQuery = useQuery(getOptions);

  const [players, setPlayers] = useState<
    { userId: string; name: string | null }[] | null
  >(null);
  const [liveVotes, setLiveVotes] = useState<LiveVotes | null>(null);
  const [reveal, setReveal] = useState<{
    matchupId: string;
    winnerCardId: string | null;
  } | null>(null);

  const live = useQuery(
    rpc.game.sessions.subscribe.experimental_liveOptions({
      input: { sessionId },
      retry: true,
    }),
  );

  const updatedAt = live.dataUpdatedAt;
  useEffect(() => {
    const event = live.data;
    if (!event) return;
    if (event.type === "presence") {
      setPlayers(event.players);
    } else if (event.type === "votes") {
      setLiveVotes({
        matchupId: event.matchupId,
        leftVotes: event.leftVotes,
        rightVotes: event.rightVotes,
        votedCount: event.votedCount,
        rosterSize: event.rosterSize,
        deadline: event.deadline,
      });
    } else if (event.type === "resolved") {
      setReveal({
        matchupId: event.matchupId,
        winnerCardId: event.winnerCardId,
      });
    } else if (event.type === "state") {
      // Next matchup opened (or game finished) — drop the reveal + stale votes
      // and refetch the new snapshot.
      setReveal(null);
      setLiveVotes(null);
      queryClient.invalidateQueries({ queryKey: getOptions.queryKey });
    }
    // getOptions.queryKey is stable for a sessionId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt]);

  return { session: sessionQuery.data, players, liveVotes, reveal };
}
