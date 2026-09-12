import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/** One live MCP session: the SDK server + transport pair, plus who owns it. */
export interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  /** The user whose credential created this session. A session is bound to
   *  them: presenting someone else's session id must not borrow their tools. */
  userId: string;
  lastUsedAt: number;
}

/** Drop a session after this long without a request. Clients reconnect by
 *  running `initialize` again, so expiry costs a handshake, not a failure. */
export const SESSION_IDLE_MS = 60 * 60 * 1000;

/** In-memory session registry.
 *
 *  Sessions are RAM-only and therefore single-instance, exactly like the
 *  realtime event bus and the presence registries (see CLAUDE.md → Realtime).
 *  A restart drops them and clients re-handshake.
 *
 *  Why be stateful at all: in stateless mode the SDK returns no
 *  `Mcp-Session-Id`, and a client that treats the session as required never
 *  gets past `initialize` — it just retries the handshake forever. */
const sessions = new Map<string, McpSession>();

export function putSession(id: string, session: McpSession): void {
  sessions.set(id, session);
}

/** Fetch a session for `userId`, touching its idle timer.
 *
 *  Returns `wrongUser` rather than the session when the id belongs to someone
 *  else — the caller answers 404, so a guessed id cannot even confirm that it
 *  exists, and never runs a tool as its owner. */
export function getSession(
  id: string,
  userId: string,
): { kind: "found"; session: McpSession } | { kind: "missing" } | { kind: "wrongUser" } {
  const session = sessions.get(id);
  if (!session) return { kind: "missing" };
  if (session.userId !== userId) return { kind: "wrongUser" };

  session.lastUsedAt = Date.now();
  return { kind: "found", session };
}

/** Close and forget one session. Safe to call for an unknown id. */
export async function dropSession(id: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  await session.server.close().catch(() => {});
}

/** Close every session idle for longer than `idleMs`. Called opportunistically
 *  on each new session rather than on a timer, so an idle server does no work
 *  and tests need no fake clock. */
export async function reapIdleSessions(
  now = Date.now(),
  idleMs = SESSION_IDLE_MS,
): Promise<number> {
  const expired = [...sessions.entries()].filter(
    ([, session]) => now - session.lastUsedAt > idleMs,
  );
  for (const [id] of expired) await dropSession(id);
  return expired.length;
}

/** Live session count — for tests and diagnostics. */
export function sessionCount(): number {
  return sessions.size;
}

/** Drop everything. Tests only. */
export async function __clearSessions(): Promise<void> {
  for (const id of [...sessions.keys()]) await dropSession(id);
}
