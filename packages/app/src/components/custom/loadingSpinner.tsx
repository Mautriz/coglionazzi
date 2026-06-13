import { Loader2Icon } from "lucide-react";

export function Spinner({ size = 48 }: { size?: number }) {
  return (
    <div className="-translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2 absolute">
      <Loader2Icon className="animate-spin stroke-[1px]" size={size} />
    </div>
  );
}
