import { cn } from "~/lib/classUtils";

const AVATAR_PALETTE = [
  "bg-primary/20 text-primary",
  "bg-green1/20 text-green1",
  "bg-orange1/20 text-orange1",
  "bg-blue1/20 text-blue1",
  "bg-red1/20 text-red1",
  "bg-purple/20 text-purple",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

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
        AVATAR_PALETTE[hash(id) % AVATAR_PALETTE.length],
        className,
      )}
    >
      {teamInitials(name)}
    </span>
  );
}
