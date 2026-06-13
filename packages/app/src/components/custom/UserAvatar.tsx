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

/** Initials avatar, hash-colored per user id so it's stable everywhere. */
export function UserAvatar({
  id,
  name,
  size = "sm",
  className,
}: {
  id: string;
  name: string;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        size === "xs" ? "size-5 text-[9px]" : "size-6 text-[10px]",
        AVATAR_PALETTE[hash(id) % AVATAR_PALETTE.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
