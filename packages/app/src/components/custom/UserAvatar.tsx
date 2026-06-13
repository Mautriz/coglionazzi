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

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Initials avatar, hash-colored per user id so it's stable everywhere. When
 *  the user has a profile picture (`image`, e.g. from Discord), render that
 *  instead; fall back to initials only when it's absent. */
export function UserAvatar({
  id,
  name,
  image,
  size = "sm",
  className,
}: {
  id: string;
  name: string;
  image?: string | null;
  size?: "xs" | "sm";
  className?: string;
}) {
  const sizeClass = size === "xs" ? "size-5" : "size-6";

  if (image) {
    return (
      <img
        src={image}
        alt={name}
        title={name}
        className={cn(
          "inline-block shrink-0 rounded-full object-cover select-none",
          sizeClass,
          className,
        )}
      />
    );
  }

  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        sizeClass,
        size === "xs" ? "text-[9px]" : "text-[10px]",
        AVATAR_PALETTE[hash(id) % AVATAR_PALETTE.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
