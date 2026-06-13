import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/authClient";

/** Discord brand glyph (lucide has no brand icons). */
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3c-.21.375-.444.882-.608 1.283a18.27 18.27 0 0 0-5.487 0A12.6 12.6 0 0 0 8.72 3 19.74 19.74 0 0 0 3.83 4.37C.728 8.94-.114 13.39.299 17.78a19.9 19.9 0 0 0 6.012 3.04c.486-.66.92-1.36 1.293-2.096a12.9 12.9 0 0 1-2.036-.973c.17-.124.337-.254.498-.388 3.927 1.81 8.18 1.81 12.06 0 .163.134.33.264.498.388-.65.382-1.334.708-2.04.974.373.735.806 1.435 1.292 2.095a19.84 19.84 0 0 0 6.015-3.038c.485-5.09-.829-9.5-3.474-13.412ZM8.02 15.08c-1.183 0-2.156-1.085-2.156-2.42 0-1.334.952-2.42 2.156-2.42 1.21 0 2.176 1.096 2.156 2.42 0 1.335-.951 2.42-2.156 2.42Zm7.96 0c-1.182 0-2.155-1.085-2.155-2.42 0-1.334.95-2.42 2.155-2.42 1.21 0 2.176 1.096 2.156 2.42 0 1.335-.946 2.42-2.156 2.42Z" />
    </svg>
  );
}

/** "Continue with Discord" — a full-page OAuth redirect (better-auth sets the
 *  session cookie on the callback, then returns to `callbackURL`). Because it's
 *  a hard navigation, the page reloads fresh and the realtime socket re-upgrades
 *  with the new cookie on its own — no `reconnectRealtimeSocket()` needed (unlike
 *  the in-SPA email login/signup). */
export function DiscordSignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-2"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const { error } = await authClient.signIn.social({
          provider: "discord",
          callbackURL: "/home",
        });
        if (error) {
          setPending(false);
          toast("Error", {
            description: error.message ?? "Could not start Discord login",
          });
        }
        // On success the browser is already navigating to Discord.
      }}
    >
      <DiscordIcon className="size-4" />
      Continue with Discord
    </Button>
  );
}

/** "or" divider used between the email form and the social button. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
