import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon, ArrowLeftIcon, HomeIcon } from "lucide-react";
import { Button } from "./ui/button";

export function NotFound({ children }: React.PropsWithChildren) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl border border-card-border bg-card p-6 sm:p-8">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-red1/40 bg-red1/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-red1">
            <AlertTriangleIcon className="size-3.5" />
            404
          </div>

          <div>
            <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-4xl">
              404
            </h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              {children || "This page doesn't exist."}
            </p>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.history.back()}
            className="border-border/80 bg-background/30 font-bold uppercase tracking-wide"
          >
            <ArrowLeftIcon className="size-4" />
            Go back
          </Button>

          <Button
            asChild
            size="sm"
            className="font-bold uppercase tracking-wide"
          >
            <Link to="/">
              <HomeIcon className="size-4" />
              Start over
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
