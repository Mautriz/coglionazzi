/** Logging for the MCP endpoint.
 *
 *  Connector UIs report one opaque line ("couldn't reach", "authorization
 *  failed") no matter what actually happened, so the only way to tell a bad
 *  Accept header from a bad credential from a rejected Host is to record what
 *  arrived. Everything here is a pure string builder so it can be tested. */

/** Headers whose VALUES are safe to print in full. Anything not listed is
 *  either irrelevant noise or a secret, so we never print it by accident. */
const SAFE_HEADERS = [
  "accept",
  "content-type",
  "user-agent",
  "origin",
  "referer",
  "host",
  "x-forwarded-host",
  "x-forwarded-proto",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
] as const;

/** Describe the Authorization header WITHOUT leaking the credential: the
 *  scheme, which kind of token it is, and enough of an API key's public
 *  prefix to match it against the key list in the UI. An OAuth access token
 *  has no public part, so only its length is recorded. */
export function describeAuthorization(header: string | null): string {
  if (!header) return "none";

  const [scheme, ...rest] = header.split(" ");
  const token = rest.join(" ").trim();
  if (scheme.toLowerCase() !== "bearer") return `${scheme.toLowerCase()}(?)`;
  if (!token) return "bearer(empty)";
  if (token.startsWith("ins_")) {
    // `ins_` + 8 chars is exactly the prefix stored in clear for the UI.
    return `bearer apiKey ${token.slice(0, 12)}…`;
  }
  return `bearer oauth len=${token.length}`;
}

/** The JSON-RPC method being called, for a body we have already read. Never
 *  logs the params — a create_task call carries user content. */
export function rpcMethodOf(body: string): string {
  if (!body) return "-";
  try {
    const parsed: unknown = JSON.parse(body);
    if (Array.isArray(parsed)) {
      return `batch[${parsed.length}]`;
    }
    if (parsed && typeof parsed === "object" && "method" in parsed) {
      const method = (parsed as { method?: unknown }).method;
      return typeof method === "string" ? method : "?";
    }
    return "-";
  } catch {
    return "unparseable";
  }
}

/** One line describing an incoming request. */
export function describeRequest(
  request: Request,
  body: string,
  verbose: boolean,
): string {
  const shown = SAFE_HEADERS.map((name) => {
    const value = request.headers.get(name);
    return value === null ? null : `${name}=${JSON.stringify(value)}`;
  }).filter(Boolean);

  const extra = verbose
    ? [...request.headers.keys()]
        .filter(
          (name) =>
            !SAFE_HEADERS.includes(name as (typeof SAFE_HEADERS)[number]) &&
            name.toLowerCase() !== "authorization" &&
            name.toLowerCase() !== "cookie",
        )
        .sort()
        .map((name) => `${name}=${JSON.stringify(request.headers.get(name))}`)
    : [];

  return [
    `${request.method} ${new URL(request.url).pathname}`,
    `rpc=${rpcMethodOf(body)}`,
    `auth=${describeAuthorization(request.headers.get("authorization"))}`,
    `cookie=${request.headers.has("cookie") ? "present" : "none"}`,
    ...shown,
    ...extra,
  ].join(" ");
}

/** One line describing what we answered, and why when it went wrong. */
export function describeOutcome(status: number, reason?: string): string {
  return reason ? `-> ${status} (${reason})` : `-> ${status}`;
}

/** Verbose mode dumps every non-secret header. Off by default so normal
 *  traffic stays one line; set MCP_LOG=verbose while debugging a client. */
export function isVerbose(): boolean {
  return process.env.MCP_LOG === "verbose";
}

/** Emit a request/outcome pair. Kept behind one function so the prefix and
 *  destination are consistent and easy to grep for (`[mcp]`). */
export function logMcp(line: string): void {
  console.log(`[mcp] ${line}`);
}
