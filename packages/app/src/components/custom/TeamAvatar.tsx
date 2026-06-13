import { cn } from "~/lib/classUtils";
import { AVATAR_PALETTE, pickByHash } from "~/lib/colorUtils";

function teamInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

/** Discord-style rounded-square team "bubble": initials, hash-colored per team
 *  id so it's stable everywhere. The sibling of `<UserAvatar>` (round) for the
 *  team rail and the home teams grid. */
export function TeamAvatar({
  id,
  name,
  size = "lg",
  className,
}: {
  id: string;
  name: string;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl font-bold select-none",
        size === "md" ? "size-9 text-xs" : "size-11 text-sm",
        pickByHash(id, AVATAR_PALETTE),
        className,
      )}
    >
      {teamInitials(name)}
    </span>
  );
}
