import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAgentCard, probeAgentAuth } from "../worker/a2a";
import { agentCardCandidates, deriveAgentHandle } from "../worker/security";

const MANYFOLD_CARD = {
  protocolVersion: "0.3.0",
  name: "travel-ticket-theme-codex",
  description: "travel-ticket-theme-codex — a Manyfold-hosted agent callable over A2A.",
  url: "https://api.manyfold.ai/api/a2a/agents/agt_x/rpc",
  preferredTransport: "JSONRPC",
  capabilities: { streaming: true },
  skills: [{ id: "general-chat", name: "General Chat", description: "Send a prompt.", tags: ["chat"] }],
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Agent Card URL resolution", () => {
  it("uses an explicit card URL as-is", () => {
    expect(agentCardCandidates("https://api.manyfold.ai/api/a2a/agents/agt_x/agent-card.json", true))
      .toEqual(["https://api.manyfold.ai/api/a2a/agents/agt_x/agent-card.json"]);
  });

  it("derives card URLs from a pasted RPC URL", () => {
    expect(agentCardCandidates("https://api.manyfold.ai/api/a2a/agents/agt_x/rpc", true)).toEqual([
      "https://api.manyfold.ai/api/a2a/agents/agt_x/.well-known/agent-card.json",
      "https://api.manyfold.ai/api/a2a/agents/agt_x/agent-card.json",
    ]);
  });

  it("derives card URLs from an A2A base URL with a trailing slash", () => {
    expect(agentCardCandidates("https://api.manyfold.ai/api/a2a/agents/agt_x/", true)).toEqual([
      "https://api.manyfold.ai/api/a2a/agents/agt_x/.well-known/agent-card.json",
      "https://api.manyfold.ai/api/a2a/agents/agt_x/agent-card.json",
    ]);
  });

  it("applies the same host guard as the RPC URL", () => {
    expect(() => agentCardCandidates("https://10.1.2.3/agents/x", true)).toThrow();
    expect(() => agentCardCandidates("http://agents.example.com/x", true)).toThrow();
  });
});

describe("handle derivation", () => {
  it.each([
    ["travel-ticket-theme-codex", "travel-ticket-theme-codex"],
    ["Research Buddy", "research-buddy"],
    ["  Spaced   Name  ", "spaced-name"],
    ["--Leading Dashes--", "leading-dashes"],
  ])("derives %s → %s", (name, expected) => {
    expect(deriveAgentHandle(name)).toBe(expected);
  });

  it("always produces a handle the API accepts", () => {
    for (const name of ["A", "研究助手", "!!!", "x".repeat(80)]) {
      expect(deriveAgentHandle(name)).toMatch(/^[a-z0-9][a-z0-9_-]{1,30}$/);
    }
  });
});

describe("Agent Card fetching", () => {
  it("summarizes a v0.3 card and reads the RPC endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(MANYFOLD_CARD)));

    const card = await fetchAgentCard(["https://api.manyfold.ai/api/a2a/agents/agt_x/agent-card.json"]);

    expect(card).toMatchObject({
      name: "travel-ticket-theme-codex",
      rpcUrl: "https://api.manyfold.ai/api/a2a/agents/agt_x/rpc",
      protocolVersion: "0.3.0",
      streaming: true,
      skills: ["General Chat"],
    });
    expect(card.description).toContain("Manyfold-hosted agent");
  });

  it("falls through to the next candidate on 404", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("nope", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(MANYFOLD_CARD));
    vi.stubGlobal("fetch", fetchMock);

    const card = await fetchAgentCard([
      "https://api.manyfold.ai/api/a2a/agents/agt_x/.well-known/agent-card.json",
      "https://api.manyfold.ai/api/a2a/agents/agt_x/agent-card.json",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(card.name).toBe("travel-ticket-theme-codex");
  });

  it("reads the endpoint from additionalInterfaces when url is absent", async () => {
    const { url, ...withoutUrl } = MANYFOLD_CARD;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ...withoutUrl,
      additionalInterfaces: [
        { url: "https://example.test/grpc", transport: "GRPC" },
        { url, transport: "JSONRPC" },
      ],
    })));

    await expect(fetchAgentCard(["https://x.test/agent-card.json"]))
      .resolves.toMatchObject({ rpcUrl: url });
  });

  it("rejects a card with no endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...MANYFOLD_CARD, url: undefined })));

    await expect(fetchAgentCard(["https://x.test/agent-card.json"]))
      .rejects.toThrow(/no JSON-RPC endpoint/i);
  });

  it("never sends an Authorization header — cards are public", async () => {
    let seen: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      seen = init;
      return jsonResponse(MANYFOLD_CARD);
    }));

    await fetchAgentCard(["https://x.test/agent-card.json"]);

    const headers = (seen?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("authorization");
  });
});

describe("credential probe", () => {
  it("accepts a token when tasks/get returns a task-not-found error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      jsonrpc: "2.0",
      id: "1",
      error: { code: -32001, message: "task not found" },
    })));

    await expect(probeAgentAuth("https://x.test/rpc", "token")).resolves.toBe(true);
  });

  it("rejects a token the endpoint refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "token is not an external A2A client token for this agent" }),
      { status: 403 },
    )));

    await expect(probeAgentAuth("https://x.test/rpc", "token"))
      .rejects.toThrow(/HTTP 403/);
  });

  it("reports inconclusive when tasks/get is unimplemented, so the caller falls back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      jsonrpc: "2.0",
      id: "1",
      error: { code: -32601, message: "method not found" },
    })));

    await expect(probeAgentAuth("https://x.test/rpc", "token")).resolves.toBe(false);
  });

  it("spends no agent turn — it never calls message/send or message/stream", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      methods.push(JSON.parse(String(init?.body)).method);
      return jsonResponse({
        jsonrpc: "2.0",
        id: "1",
        error: { code: -32001, message: "task not found" },
      });
    }));

    await probeAgentAuth("https://x.test/rpc", "token");

    expect(methods).toEqual(["tasks/get"]);
  });
});
