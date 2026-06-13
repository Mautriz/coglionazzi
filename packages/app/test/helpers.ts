import { call } from "@orpc/server";
import { auth } from "../src/server/auth";
import type { ORPCContext } from "../src/server/orpc/base";
import { teamRouter } from "../src/server/orpc/teams";

let userCounter = 0;

/** Create a team owned by the context's user; returns its id. */
export async function createTestTeam(
  context: ORPCContext,
  name = "Test team",
): Promise<string> {
  const { id } = await call(teamRouter.create, { name }, { context });
  return id;
}

/** Sign up a fresh user through better-auth's server API (no HTTP) and
 *  return an oRPC context whose `reqHeaders` carry its session cookie —
 *  exactly what `authP` resolves. Rolled back with the test transaction. */
export async function signUpTestUser(name = "Tester"): Promise<{
  context: ORPCContext;
  email: string;
}> {
  const email = `${name.toLowerCase()}-${userCounter++}@test.local`;
  const { headers } = await auth.api.signUpEmail({
    body: { email, password: "password123", name },
    returnHeaders: true,
  });

  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  return {
    context: {
      reqHeaders: new Headers({ cookie }),
      resHeaders: new Headers(),
    },
    email,
  };
}

/** Minimal serialized Lexical state containing a single paragraph. */
export function lexicalState(text: string): string {
  return JSON.stringify({
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
              type: "text",
              version: 1,
            },
          ],
          direction: null,
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });
}
