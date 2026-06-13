import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

/** The embeddable support widget's content — loaded inside an <iframe> by
 *  `public/widget.js` on third-party sites. No auth: a visitor enters their
 *  email and chats with the team. Talks to the public `/api/support/*`
 *  endpoints (same-origin from inside the iframe, so no CORS needed here).
 *  Plain `fetch` + `EventSource`, NOT oRPC. */
export const Route = createFileRoute("/widget")({
  validateSearch: z.object({ key: z.string().optional() }),
  component: Widget,
});

interface WidgetMessage {
  id: string;
  text: string;
  fromAgent: boolean;
  authorName: string | null;
  createdAt: string;
}
interface Category {
  id: string;
  name: string;
}

function Widget() {
  const { key } = Route.useSearch();
  const storageKey = `support_token_${key ?? ""}`;

  const [teamName, setTeamName] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Start-form fields.
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  // Load config + any resumable ticket token.
  useEffect(() => {
    if (!key) {
      setLoadError("Missing widget key.");
      return;
    }
    fetch(`/api/support/config?widgetKey=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { teamName: string; categories: Category[] }) => {
        setTeamName(data.teamName);
        setCategories(data.categories);
      })
      .catch(() => setLoadError("This support widget is not available."));

    const saved =
      typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    if (saved) setToken(saved);
  }, [key, storageKey]);

  // Load history + open the live stream once we have a ticket token.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`/api/support/messages?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { messages: WidgetMessage[] }) => {
        if (alive) setMessages(data.messages);
      })
      .catch(() => {
        // A stale token (ticket gone) — drop it and return to the form.
        localStorage.removeItem(storageKey);
        if (alive) setToken(null);
      });

    const es = new EventSource(
      `/api/support/stream?token=${encodeURIComponent(token)}`,
    );
    es.onmessage = (e) => {
      const evt = JSON.parse(e.data) as
        | { type: "created"; message: WidgetMessage }
        | { type: "deleted"; id: string };
      if (evt.type === "created") {
        setMessages((prev) =>
          prev.some((m) => m.id === evt.message.id)
            ? prev
            : [...prev, evt.message],
        );
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== evt.id));
      }
    };
    return () => {
      alive = false;
      es.close();
    };
  }, [token, storageKey]);

  // Keep the view pinned to the latest message.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function startTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !draft.trim() || !key) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          widgetKey: key,
          email: email.trim(),
          name: name.trim() || undefined,
          categoryId: categoryId || undefined,
          message: draft.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as {
        accessToken: string;
        messages: WidgetMessage[];
      };
      localStorage.setItem(storageKey, data.accessToken);
      setMessages(data.messages);
      setDraft("");
      setToken(data.accessToken);
    } catch {
      setLoadError("Couldn't start the chat. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !token) return;
    const text = draft.trim();
    setDraft("");
    setSending(true);
    try {
      const res = await fetch(`/api/support/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, message: text }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { message: WidgetMessage };
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id)
          ? prev
          : [...prev, data.message],
      );
    } catch {
      setDraft(text); // restore so the visitor can retry
    } finally {
      setSending(false);
    }
  }

  function reset() {
    localStorage.removeItem(storageKey);
    setToken(null);
    setMessages([]);
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-semibold">{teamName ?? "Support"}</p>
          <p className="text-xs text-muted-foreground">
            {token ? "We usually reply soon" : "Start a conversation"}
          </p>
        </div>
        {token && (
          <button
            type="button"
            onClick={reset}
            className="text-xs text-link hover:underline"
          >
            New chat
          </button>
        )}
      </header>

      {loadError && !token && (
        <p className="m-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {loadError}
        </p>
      )}

      {!token ? (
        <form
          onSubmit={startTicket}
          className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
        >
          <label className="flex flex-col gap-1 text-xs font-medium">
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Name (optional)
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          {categories.length > 0 && (
            <label className="flex flex-col gap-1 text-xs font-medium">
              Topic
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">General</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
            Message
            <textarea
              required
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="How can we help?"
              className="min-h-24 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={sending}
            className="special rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {sending ? "Starting…" : "Start chat"}
          </button>
        </form>
      ) : (
        <>
          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.fromAgent ? "flex justify-start" : "flex justify-end"
                }
              >
                <div
                  className={
                    "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm " +
                    (m.fromAgent
                      ? "bg-card text-card-foreground"
                      : "special")
                  }
                >
                  {m.fromAgent && m.authorName && (
                    <p className="mb-0.5 text-xs font-semibold opacity-70">
                      {m.authorName}
                    </p>
                  )}
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <form
            onSubmit={sendMessage}
            className="flex items-end gap-2 border-t border-border bg-card p-3"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(e);
                }
              }}
              placeholder="Type a message…"
              rows={1}
              className="max-h-32 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="special rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}
