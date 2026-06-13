import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { LinkWithDescription } from "~/components/custom/linkWithDescription";
import { useAppForm } from "~/components/custom/AppForm";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardTitle } from "~/components/ui/card";
import { authClient } from "~/lib/authClient";
import { reconnectRealtimeSocket } from "~/lib/wsClient";

const FormSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

type FormType = z.infer<typeof FormSchema>;

export const Route = createFileRoute("/auth/login")({
  component: RouteComponent,
});

function RouteComponent() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: async (values: FormType) => {
      return await authClient.signIn.email(
        {
          email: values.email,
          password: values.password,
        },
        {
          onSuccess: async () => {
            // Re-upgrade the realtime socket so it carries the new cookie, and
            // wait for it to re-open before issuing oRPC calls (invalidate) —
            // otherwise they race the reconnect gap and throw.
            await reconnectRealtimeSocket();
            queryClient.removeQueries();
            router.invalidate();
            router.navigate({ to: "/home" });
          },
          onError(e) {
            toast("Error", {
              description: e.error.message,
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
        <CardTitle className="mb-8">Welcome back</CardTitle>
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
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
                placeholder="••••••••"
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
                  Log in
                </Button>
              )}
            </form.SubscribeButton>
          </form.AppForm>

          <LinkWithDescription
            href="/auth/sign-up"
            description="Don't have an account?"
            className="text-center"
          >
            Sign up
          </LinkWithDescription>
        </form>
      </CardContent>
    </Card>
  );
}
