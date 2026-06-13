import { cn } from "~/lib/classUtils";

/** A small pulsing green "live" dot — the shared motif for realtime presence
 *  indicators (the topbar online count, the in-game watching badge). */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-green1 opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-green1" />
    </span>
  );
}
