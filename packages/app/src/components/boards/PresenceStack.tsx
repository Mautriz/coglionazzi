import { UserAvatar } from "~/components/custom/UserAvatar";
import { useBoardPresence } from "~/lib/useRealtime";

/** Live overlapping avatar stack of everyone currently viewing this board. */
export function PresenceStack({ boardId }: { boardId: string }) {
  const viewers = useBoardPresence(boardId);
  if (viewers.length === 0) return null;

  const shown = viewers.slice(0, 5);
  const extra = viewers.length - shown.length;

  return (
    <div
      className="flex items-center -space-x-2"
      title={`${viewers.length} viewing`}
    >
      {shown.map((viewer) => (
        <UserAvatar
          key={viewer.userId}
          id={viewer.userId}
          name={viewer.name ?? "Someone"}
          image={viewer.image}
          className="ring-2 ring-background"
        />
      ))}
      {extra > 0 && (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background">
          +{extra}
        </span>
      )}
    </div>
  );
}
