import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { LinkWithDescription } from "~/components/custom/linkWithDescription";
import { useAppForm } from "~/components/custom/AppForm";
import { AuthDivider, DiscordSignInButton } from "~/components/custom/SocialAuth";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardTitle } from "~/components/ui/card";
import { authClient } from "~/lib/authClient";
import {
  continueOAuthFlow,
  continueOAuthIfSignedIn,
  useOAuthContinueUrl,
} from "~/lib/oauthLogin";
import { reconnectRealtimeSocket } from "~/lib/wsClient";

const FormSchema = z.object({
  name: z.string().min(1, "Pick a name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

type FormType = z.infer<typeof FormSchema>;

export const Route = createFileRoute("/auth/sign-up")({
  component: RouteComponent,
});

function RouteComponent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  /** Non-null when an OAuth client (claude.ai / Claude Code) sent us here. */
  const continueUrl = useOAuthContinueUrl();

  // Signup goes over HTTP (better-auth sets the session cookie via Set-Cookie,
  // which WS frames can't carry). autoSignIn logs the new user straight in.
  const { mutate, isPending } = useMutation({
    mutationFn: async (values: FormType) => {
      return await authClient.signUp.email(
        {
          email: values.email,
          password: values.password,
          name: values.name,
        },
        {
          onSuccess: async () => {
            if (continueUrl) {
              // An OAuth client is waiting for its code — hand the browser to
              // the authorize endpoint instead of entering the app.
              continueOAuthFlow(continueUrl);
              return;
            }
            // Re-upgrade the realtime socket so it carries the new cookie, and
            // wait for it to re-open before issuing oRPC calls (invalidate) —
            // otherwise they race the reconnect gap and throw.
            await reconnectRealtimeSocket();
            queryClient.removeQueries();
            router.invalidate();
            router.navigate({ to: "/home" });
          },
          async onError(e) {
            // The mcp plugin's after-login hook answers this very request
            // with a cross-origin redirect; fetch follows it but can't read
            // the response, so a successful login surfaces here as an error
            // (see lib/oauthLogin.ts).
            if (continueUrl && (await continueOAuthIfSignedIn(continueUrl))) {
              return;
            }
            toast("Error", {
              description: e.error?.message ?? "Could not sign up",
            });
          },
        },
      );
    },
  });

  const form = useAppForm({
    validators: {
      onChange: FormSchema,
    },
    defaultValues: {
      name: "",
      email: "",
      password: "",
    } as FormType,
    onSubmit(props) {
      mutate(props.value);
    },
  });

  return (
    <Card className="w-full max-w-[440px]">
      <CardContent>
        <CardTitle className="mb-8">Join the crew</CardTitle>

        {continueUrl && (
          <p className="-mt-4 mb-6 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Sign up to connect Claude to Insacco. Claude will act as this new
            account, in every team it belongs to.
          </p>
        )}
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <form.AppField name="name">
            {(f) => (
              <f.TextField label="Name" placeholder="Your name in the crew" />
            )}
          </form.AppField>

          <form.AppField name="email">
            {(f) => (
              <f.TextField
                label="Email"
                type="email"
                placeholder="you@example.com"
              />
            )}
          </form.AppField>

          <form.AppField name="password">
            {(f) => (
              <f.TextField
                label="Password"
                type="password"
                placeholder="At least 8 characters"
              />
            )}
          </form.AppField>

          <form.AppForm>
            <form.SubscribeButton>
              {(canSubmit) => (
                <Button
                  type="submit"
                  className="mt-2"
                  disabled={!canSubmit || isPending}
                >
                  Sign up
                </Button>
              )}
            </form.SubscribeButton>
          </form.AppForm>

          <AuthDivider />
          <DiscordSignInButton callbackURL={continueUrl ?? "/home"} />

          <LinkWithDescription
            href="/auth/login"
            preserveSearch
            description="Already have an account?"
            className="text-center"
          >
            Log in
          </LinkWithDescription>
        </form>
      </CardContent>
    </Card>
  );
}
