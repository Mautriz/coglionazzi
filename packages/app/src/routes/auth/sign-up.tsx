import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { LinkWithDescription } from "~/components/custom/linkWithDescription";
import { useAppForm } from "~/components/custom/AppForm";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardTitle } from "~/components/ui/card";
import { rpc } from "~/lib/rpcClient";

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

  const { mutate, isPending } = useMutation(
    rpc.auth.signUp.mutationOptions({
      onSuccess: () => {
        queryClient.removeQueries();
        router.invalidate();
        router.navigate({ to: "/home" });
      },
    }),
  );

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

          <LinkWithDescription
            href="/auth/login"
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
