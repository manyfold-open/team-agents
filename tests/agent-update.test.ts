import { describe, expect, it, vi } from "vitest";
import { handleApiRequest } from "../worker/api";
import type { Env } from "../worker/types";

const AGENT_ID = "agent-1";
const USER_ID = "user-1";
const RPC = "https://agents.example.com/a2a/rpc";

/**
 * Records every statement the handler prepares so a test can assert on which
 * writes ran, then replays canned rows for the reads `updateAgent` performs.
 */
function createRecordingEnv(agentRow: Record<string, unknown>) {
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
            return { id: USER_ID, username: "owner", role: "owner" } as T;
          }
          if (/FROM agents/i.test(sql)) return agentRow as T;
          return null as T | null;
        },
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
      };
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
  };
  return { env, prepared };
}

async function seedAgentRow(env: Env, token: string) {
  const { encryptCredential } = await import("../worker/security");
  return encryptCredential(env, token);
}

function patch(body: unknown): Request {
  return new Request(`https://team-agents.test/api/agents/${AGENT_ID}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "https://team-agents.test",
      cookie: "team_agents_session=irrelevant-because-the-lookup-is-stubbed",
    },
    body: JSON.stringify(body),
  });
}

/** Accepts the credential probe without spending a turn. */
function stubProbeOk() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ jsonrpc: "2.0", id: "1", error: { code: -32001, message: "task not found" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  )));
}

/** Rejects the credential probe the way a real A2A server rejects a bad token. */
function stubProbeRejected() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ error: "bad token" }),
    { status: 403, headers: { "content-type": "application/json" } },
  )));
}

async function runPatch(
  body: unknown,
  overrides: Record<string, unknown> = {},
  stub: () => void = stubProbeOk,
) {
  const base = createRecordingEnv({});
  const encrypted = await seedAgentRow(base.env, "stored-token");
  const agentRow = {
    id: AGENT_ID,
    owner_user_id: USER_ID,
    name: "Research Buddy",
    handle: "research-buddy",
    description: "Does research.",
    rpc_url: RPC,
    token_ciphertext: encrypted.ciphertext,
    token_iv: encrypted.iv,
    history_count: 20,
    enabled: 1,
    config_version: 3,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  const { env, prepared } = createRecordingEnv(agentRow);
  stub();
  const response = await handleApiRequest(patch(body), env);
  vi.unstubAllGlobals();

  const update = prepared.find((entry) => /^UPDATE agents SET name=/i.test(entry.sql.trim()));
  const contextReset = prepared.find((entry) => /UPDATE agent_conversations SET context_id=NULL/i.test(entry.sql));
  return { response, update, contextReset };
}

describe("editing an Agent", () => {
  it("keeps channel memory when only metadata changes", async () => {
    const { response, update, contextReset } = await runPatch({
      name: "Research Pal",
      description: "Now with a new blurb.",
      historyCount: 40,
      rpcUrl: RPC,
    });

    expect(response?.status).toBe(200);
    expect(update).toBeDefined();
    // config_version increment is the second-to-last bind before the agent id.
    expect(update?.binds.at(-3)).toBe(0);
    expect(contextReset).toBeUndefined();
  });

  it("resets channel memory when the endpoint changes", async () => {
    const { response, update, contextReset } = await runPatch({
      rpcUrl: "https://agents.example.com/a2a/v2/rpc",
    });

    expect(response?.status).toBe(200);
    expect(update?.binds.at(-3)).toBe(1);
    expect(contextReset).toBeDefined();
  });

  it("resets channel memory when a different token is supplied", async () => {
    const { response, update, contextReset } = await runPatch({
      rpcUrl: RPC,
      bearerToken: "rotated-token",
    });

    expect(response?.status).toBe(200);
    expect(update?.binds.at(-3)).toBe(1);
    expect(contextReset).toBeDefined();
  });

  it("treats re-pasting the same token as no change", async () => {
    const { response, update, contextReset } = await runPatch({
      rpcUrl: RPC,
      bearerToken: "stored-token",
    });

    expect(response?.status).toBe(200);
    expect(update?.binds.at(-3)).toBe(0);
    expect(contextReset).toBeUndefined();
  });

  it("keeps the stored token when the field is omitted", async () => {
    const { response } = await runPatch({ name: "Renamed", rpcUrl: RPC });

    expect(response?.status).toBe(200);
    // A blank token must not wipe the credential: the agent stays usable.
    await expect(response?.json()).resolves.toMatchObject({
      agent: { tokenConfigured: true },
    });
  });

  it("says the token was rejected instead of failing opaquely", async () => {
    const { response, update } = await runPatch(
      { rpcUrl: RPC, bearerToken: "wrong-token" },
      {},
      stubProbeRejected,
    );

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "agent_token_rejected" },
    });
    // A failed verification must not persist the unusable credential.
    expect(update).toBeUndefined();
  });

  it("rejects an edit from a non-owner", async () => {
    const { response } = await runPatch({ name: "Hijack", rpcUrl: RPC }, {
      owner_user_id: "someone-else",
    });

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "agent_owner_required" },
    });
  });
});
