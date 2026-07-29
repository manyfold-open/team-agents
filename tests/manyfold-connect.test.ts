import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApiRequest } from "../worker/api";
import type { Env } from "../worker/types";

const USER_ID = "user-1";
const ORIGIN = "https://team-agents.example.com";
const MANYFOLD = "https://api-staging.manyfold.ai";
const AGENT_RPC = `${MANYFOLD}/api/a2a/agents/agt_x/rpc`;
const AGENT_CARD = `${MANYFOLD}/api/a2a/agents/agt_x/agent-card.json`;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Minimal D1 double: records every prepared statement and replays canned reads.
 * `rows` is keyed by a regex source matched against the SQL.
 */
function createEnv(options: {
  session?: Record<string, unknown> | null;
  connectRow?: Record<string, unknown> | null;
  existingAgent?: Record<string, unknown> | null;
} = {}) {
  const prepared: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => {
      const entry = { sql, binds: [] as unknown[] };
      const statement = {
        bind: (...values: unknown[]) => {
          entry.binds = values;
          prepared.push(entry);
          return statement;
        },
        first: async <T>() => {
          if (/FROM sessions/i.test(sql)) {
            return (options.session === undefined
              ? { id: USER_ID, username: "owner", role: "owner" }
              : options.session) as T;
          }
          if (/FROM manyfold_connect_sessions/i.test(sql)) {
            return (options.connectRow ?? null) as T;
          }
          // freeHandle probe + duplicate lookup both read `agents`.
          if (/SELECT id,handle FROM agents/i.test(sql)) {
            return (options.existingAgent ?? null) as T;
          }
          if (/FROM agents/i.test(sql)) return null as T | null;
          return null as T | null;
        },
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
      };
      // Statements with no binds still need to be recorded.
      Object.defineProperty(statement, "__sql", { value: sql });
      return statement;
    },
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
  } as unknown as D1Database;

  const env: Env = {
    DB: db,
    ASSETS: {} as Fetcher,
    CHANNEL_ROOMS: {} as Env["CHANNEL_ROOMS"],
    AGENT_TASKS: {} as Env["AGENT_TASKS"],
    ENVIRONMENT: "test",
    AUTH_HMAC_KEY: "test-auth-hmac-key-with-at-least-32-characters",
    CREDENTIALS_ENCRYPTION_KEY: "test-credential-key-with-at-least-32-characters",
    MANYFOLD_API_BASE_URL: MANYFOLD,
  };
  return { env, prepared };
}

const post = (path: string, body?: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      cookie: "team_agents_session=token",
      origin: ORIGIN,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/manyfold/connect", () => {
  it("stores the device code encrypted and never returns it", async () => {
    const started = {
      requestId: "acs_1",
      userCode: "9WRU-K9K6",
      authUrl: "https://app-staging.manyfold.ai/connect/a2a?request=acs_1&code=9WRU-K9K6",
      deviceCode: "mf_cnx_super-secret-device-code",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
    const fetchMock = vi.fn(async () => jsonResponse(started, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { env, prepared } = createEnv();

    const response = await handleApiRequest(post("/api/manyfold/connect"), env);
    expect(response?.status).toBe(201);
    const payload = await response!.json() as { connect: Record<string, unknown> };

    expect(payload.connect.userCode).toBe("9WRU-K9K6");
    expect(payload.connect.authUrl).toBe(started.authUrl);
    expect(payload.connect).not.toHaveProperty("deviceCode");
    // Nothing anywhere in the response body may echo the credential.
    expect(JSON.stringify(payload)).not.toContain("mf_cnx_");

    const insert = prepared.find((entry) => /INSERT INTO manyfold_connect_sessions/i.test(entry.sql));
    expect(insert).toBeDefined();
    expect(insert!.binds).not.toContain(started.deviceCode);
    expect(insert!.binds.some((bind) => String(bind).includes("mf_cnx_"))).toBe(false);
  });

  it("calls the configured Manyfold origin with the client identity", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      requestId: "acs_1",
      userCode: "AAAA-BBBB",
      authUrl: "https://app-staging.manyfold.ai/connect/a2a?request=acs_1&code=AAAA-BBBB",
      deviceCode: "mf_cnx_x",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createEnv();

    await handleApiRequest(post("/api/manyfold/connect"), env);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${MANYFOLD}/api/connect/a2a/start`);
    expect(JSON.parse(String(init.body))).toEqual({
      clientName: "Team Agents",
      clientUrl: ORIGIN,
    });
  });

  it("rejects an unauthenticated caller before reaching Manyfold", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createEnv({ session: null });

    const response = await handleApiRequest(post("/api/manyfold/connect"), env);
    expect(response?.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/manyfold/connect/:id/poll", () => {
  const pendingRow = (overrides: Record<string, unknown> = {}) => ({
    id: "connect-1",
    user_id: USER_ID,
    device_code_ciphertext: "",
    device_code_iv: "",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    status: "pending",
    ...overrides,
  });

  /**
   * Builds an env whose connect row carries a real encrypted device code, the
   * way `startManyfoldConnect` would have stored it.
   */
  async function envWithSession(
    row: Record<string, unknown>,
    options: { existingAgent?: Record<string, unknown> | null } = {},
  ) {
    const scoped = createEnv({ connectRow: row, ...options });
    const { encryptCredential } = await import("../worker/security");
    const encrypted = await encryptCredential(scoped.env, "mf_cnx_stored-device-code");
    row.device_code_ciphertext = encrypted.ciphertext;
    row.device_code_iv = encrypted.iv;
    return scoped;
  }

  it("relays a pending poll without touching the agent table", async () => {
    const { env, prepared } = await envWithSession(pendingRow());
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: "pending" })));

    const response = await handleApiRequest(post("/api/manyfold/connect/connect-1/poll"), env);
    expect(await response!.json()).toEqual({ status: "pending" });
    expect(prepared.some((e) => /INSERT INTO agents/i.test(e.sql))).toBe(false);
    expect(prepared.some((e) => /SET status='exchanged'/i.test(e.sql))).toBe(false);
  });

  it("forwards the stored device code to Manyfold", async () => {
    const { env } = await envWithSession(pendingRow());
    const fetchMock = vi.fn(async () => jsonResponse({ status: "pending" }));
    vi.stubGlobal("fetch", fetchMock);

    await handleApiRequest(post("/api/manyfold/connect/connect-1/poll"), env);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${MANYFOLD}/api/connect/a2a/poll`);
    expect(JSON.parse(String(init.body))).toEqual({ deviceCode: "mf_cnx_stored-device-code" });
  });

  it("creates an agent from an approved poll and encrypts the token", async () => {
    const { env, prepared } = await envWithSession(pendingRow());

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/connect/a2a/poll")) {
        return jsonResponse({
          status: "approved",
          userEmail: "owner@example.com",
          agents: [{
            agentId: "agt_x",
            name: "Travel Ticket Theme Codex",
            rpcUrl: AGENT_RPC,
            cardUrl: AGENT_CARD,
            token: "nca_minted_secret",
            expiresAt: null,
          }],
        });
      }
      if (url === AGENT_CARD) {
        return jsonResponse({
          protocolVersion: "0.3.0",
          name: "Travel Ticket Theme Codex",
          description: "A Manyfold-hosted agent callable over A2A.",
          url: AGENT_RPC,
          capabilities: { streaming: true },
        });
      }
      // The credential probe: a JSON-RPC error proves the bearer reached dispatch.
      return jsonResponse({ jsonrpc: "2.0", id: "1", error: { code: -32001, message: "not found" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleApiRequest(post("/api/manyfold/connect/connect-1/poll"), env);
    const payload = await response!.json() as {
      status: string;
      agents: Array<Record<string, unknown>>;
      failed: unknown[];
    };

    expect(payload.status).toBe("approved");
    expect(payload.failed).toEqual([]);
    expect(payload.agents).toHaveLength(1);
    expect(payload.agents[0].handle).toBe("travel-ticket-theme-codex");
    expect(payload.agents[0].created).toBe(true);
    expect(payload.agents[0].verified).toBe(true);
    // The minted bearer must never be echoed back to the browser.
    expect(JSON.stringify(payload)).not.toContain("nca_minted_secret");

    const insert = prepared.find((entry) => /INSERT INTO agents/i.test(entry.sql));
    expect(insert).toBeDefined();
    expect(insert!.binds).not.toContain("nca_minted_secret");
    expect(insert!.binds).toContain(AGENT_RPC);
    // Session is burned before the tokens are consumed, and the spent device
    // code is wiped rather than left behind.
    const burn = prepared.find((e) => /SET status='exchanged'/i.test(e.sql));
    expect(burn).toBeDefined();
    expect(burn!.sql).toMatch(/device_code_ciphertext=''/);
    expect(burn!.sql).toMatch(/WHERE id=\? AND status='pending'/);
  });

  it("rotates the token in place when the agent is already connected", async () => {
    const { env, prepared } = await envWithSession(pendingRow(), {
      existingAgent: { id: "existing-agent", handle: "travel-ticket-theme-codex" },
    });

    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/connect/a2a/poll")) {
        return jsonResponse({
          status: "approved",
          userEmail: null,
          agents: [{
            agentId: "agt_x",
            name: "Travel Ticket Theme Codex",
            rpcUrl: AGENT_RPC,
            cardUrl: AGENT_CARD,
            token: "nca_rotated",
            expiresAt: null,
          }],
        });
      }
      if (url === AGENT_CARD) return jsonResponse({ name: "x", url: AGENT_RPC, protocolVersion: "0.3.0" });
      return jsonResponse({ jsonrpc: "2.0", id: "1", result: {} });
    }));

    const response = await handleApiRequest(post("/api/manyfold/connect/connect-1/poll"), env);
    const payload = await response!.json() as { agents: Array<Record<string, unknown>> };

    expect(payload.agents[0].created).toBe(false);
    expect(payload.agents[0].id).toBe("existing-agent");
    expect(prepared.some((e) => /INSERT INTO agents/i.test(e.sql))).toBe(false);
    // Rotating credentials must reset A2A conversation state, as a manual edit does.
    expect(prepared.some((e) => /UPDATE agent_conversations SET context_id=NULL/i.test(e.sql))).toBe(true);
  });

  it("refuses to poll another user's session", async () => {
    const { env } = createEnv({ connectRow: pendingRow({ user_id: "someone-else" }) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleApiRequest(post("/api/manyfold/connect/connect-1/poll"), env);
    expect(response?.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an expired session without calling Manyfold", async () => {
    const { env } = createEnv({
      connectRow: pendingRow({ expires_at: new Date(Date.now() - 1_000).toISOString() }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleApiRequest(post("/api/manyfold/connect/connect-1/poll"), env);
    expect(await response!.json()).toEqual({ status: "expired" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an already-consumed session as expired so tokens are never re-fetched", async () => {
    const { env } = createEnv({ connectRow: pendingRow({ status: "exchanged" }) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleApiRequest(post("/api/manyfold/connect/connect-1/poll"), env);
    expect(await response!.json()).toEqual({ status: "expired" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an endpoint that fails the outbound host guard", async () => {
    const { env } = await envWithSession(pendingRow());
    env.ENVIRONMENT = "production";

    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      if (String(input).endsWith("/connect/a2a/poll")) {
        return jsonResponse({
          status: "approved",
          userEmail: null,
          // A compromised or buggy upstream must not steer us at an internal host.
          agents: [{
            agentId: "agt_x",
            name: "Evil",
            rpcUrl: "http://169.254.169.254/latest/meta-data",
            cardUrl: AGENT_CARD,
            token: "nca_x",
            expiresAt: null,
          }],
        });
      }
      return jsonResponse({});
    }));

    const response = await handleApiRequest(post("/api/manyfold/connect/connect-1/poll"), env);
    const payload = await response!.json() as { agents: unknown[]; failed: unknown[] };
    expect(payload.agents).toEqual([]);
    expect(payload.failed).toHaveLength(1);
  });
});
