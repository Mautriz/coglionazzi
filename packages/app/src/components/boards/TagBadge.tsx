import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/classUtils";

/** Stable per-tag color: hash the tag name into a small palette. */
const TAG_PALETTE = [
  "border-primary/40 bg-primary/10 text-primary",
  "border-green1/40 bg-green1/10 text-green1",
  "border-orange1/40 bg-orange1/10 text-orange1",
  "border-blue1/40 bg-blue1/10 text-blue1",
  "border-red1/40 bg-red1/10 text-red1",
  "border-purple/40 bg-purple/10 text-purple",
];

function hashTag(tag: string) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function TagBadge({
  tag,
  className,
  children,
}: React.PropsWithChildren<{
  tag: string;
  className?: string;
}>) {
  return (
    <Badge
      variant="outline"
      className={cn(TAG_PALETTE[hashTag(tag) % TAG_PALETTE.length], className)}
    >
      {tag}
      {children}
    </Badge>
  );
}
