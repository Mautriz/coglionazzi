import { describe, expect, it } from "vitest";
import {
  describeAuthorization,
  describeRequest,
  rpcMethodOf,
} from "./log";

const req = (headers: Record<string, string>) =>
  new Request("http://localhost/api/mcp", { method: "POST", headers });

describe("describeAuthorization", () => {
  it("says none when the header is absent", () => {
    expect(describeAuthorization(null)).toBe("none");
  });

  it("shows an API key's public prefix and nothing more", () => {
    const token = "ins_11acNuPnT2-CyKLb0K_QZiP9kFN6";

    const described = describeAuthorization(`Bearer ${token}`);

    expect(described).toBe("bearer apiKey ins_11acNuPn…");
    expect(described).not.toContain("CyKLb0K");
  });

  it("never prints an OAuth token, only its length", () => {
    const token = "aBcDeFgHiJkLmNoPqRsTuVwXyZabcdef";

    const described = describeAuthorization(`Bearer ${token}`);

    expect(described).toBe("bearer oauth len=32");
    expect(described).not.toContain(token);
  });

  it("flags a non-bearer scheme without echoing the credential", () => {
    const described = describeAuthorization("Basic c2VjcmV0OnBhc3M=");

    expect(described).toBe("basic(?)");
    expect(described).not.toContain("c2VjcmV0");
  });

  it("flags a bearer with an empty token", () => {
    expect(describeAuthorization("Bearer   ")).toBe("bearer(empty)");
  });
});

describe("rpcMethodOf", () => {
  it("reads the method out of a JSON-RPC call", () => {
    expect(rpcMethodOf('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')).toBe(
      "tools/list",
    );
  });

  it("reports a batch by size", () => {
    expect(rpcMethodOf('[{"method":"a"},{"method":"b"}]')).toBe("batch[2]");
  });

  it("says so when the body is not JSON", () => {
    expect(rpcMethodOf("<html>nope</html>")).toBe("unparseable");
  });

  it("handles an empty body", () => {
    expect(rpcMethodOf("")).toBe("-");
  });

  it("never echoes the params", () => {
    const body = JSON.stringify({
      method: "tools/call",
      params: { name: "create_task", arguments: { title: "SECRET PLAN" } },
    });

    expect(rpcMethodOf(body)).toBe("tools/call");
  });
});

describe("describeRequest", () => {
  it("records the headers that explain a client's behaviour", () => {
    const line = describeRequest(
      req({
        accept: "*/*",
        "user-agent": "claude-ai/1.0",
        origin: "https://claude.ai",
      }),
      '{"method":"initialize"}',
      false,
    );

    expect(line).toContain("POST /api/mcp");
    expect(line).toContain("rpc=initialize");
    expect(line).toContain('accept="*/*"');
    expect(line).toContain('user-agent="claude-ai/1.0"');
    expect(line).toContain('origin="https://claude.ai"');
  });

  it("notes whether a cookie was sent without printing it", () => {
    const line = describeRequest(
      req({ cookie: "session=super-secret-value" }),
      "",
      false,
    );

    expect(line).toContain("cookie=present");
    expect(line).not.toContain("super-secret-value");
  });

  it("omits headers that were not sent", () => {
    const line = describeRequest(req({ accept: "*/*" }), "", false);

    expect(line).not.toContain("origin=");
  });

  it("dumps unknown headers only in verbose mode, still hiding secrets", () => {
    const request = req({
      accept: "*/*",
      "x-weird-client-header": "hello",
      authorization: "Bearer ins_supersecrettoken",
      cookie: "a=b",
    });

    const quiet = describeRequest(request, "", false);
    const loud = describeRequest(request, "", true);

    expect(quiet).not.toContain("x-weird-client-header");
    expect(loud).toContain('x-weird-client-header="hello"');
    expect(loud).not.toContain("supersecrettoken");
    expect(loud).not.toContain("a=b");
  });
});
