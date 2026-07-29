import {
  decryptCredential,
  deriveAgentHandle,
  encryptCredential,
  HttpError,
  validateAgentRpcUrl,
} from "./security";
import { agentHttpError, fetchAgentCard, verifyAgentCredentials } from "./a2a";
import type { Env } from "./types";

const DEFAULT_MANYFOLD_API_BASE = "https://api.manyfold.ai";
const CLIENT_NAME = "Team Agents";
const START_TIMEOUT_MS = 20_000;
const POLL_TIMEOUT_MS = 30_000;

/** Shape returned by Manyfold `POST /api/connect/a2a/start`. */
interface ManyfoldStartResponse {
  requestId: string;
  userCode: string;
  authUrl: string;
  deviceCode: string;
  expiresAt: string;
}

/** One entry of an approved Manyfold `POST /api/connect/a2a/poll`. */
interface ManyfoldPollAgent {
  agentId: string;
  name: string;
  rpcUrl: string;
  cardUrl: string;
  token: string;
  expiresAt: string | null;
}

type ManyfoldPollResponse =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; userEmail: string | null; agents: ManyfoldPollAgent[] };

export interface ConnectedAgentResult {
  id: string;
  name: string;
  handle: string;
  manyfoldAgentId: string;
  created: boolean;
  /**
   * The freshly minted token is probed (never a real turn) before we report
   * success. A false here still means the agent was saved — the credential
   * exists and is revocable from Manyfold, so discarding it would strand it.
   */
  verified: boolean;
  warning?: string;
}

/**
 * Base URL of the Manyfold API. Operator-controlled config, not user input, so
 * it is validated once for shape rather than run through the SSRF host guard
 * that applies to agent-supplied endpoints.
 */
function manyfoldApiBase(env: Env): string {
  const raw = (env.MANYFOLD_API_BASE_URL ?? DEFAULT_MANYFOLD_API_BASE).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(500, "manyfold_misconfigured", "MANYFOLD_API_BASE_URL is not a valid URL.");
  }
  const production = env.ENVIRONMENT === "production";
  if (url.protocol !== "https:" && !(!production && url.protocol === "http:")) {
    throw new HttpError(500, "manyfold_misconfigured", "MANYFOLD_API_BASE_URL must be https.");
  }
  return url.toString().replace(/\/+$/, "");
}

async function manyfoldFetch<T>(
  env: Env,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${manyfoldApiBase(env)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    throw new HttpError(
      502,
      "manyfold_unreachable",
      `Could not reach Manyfold. ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message = (parsed as { error?: { message?: string } } | null)?.error?.message
      ?? `Manyfold returned ${response.status}.`;
    // 429 passes through so the client can back off; other 4xx is a caller
    // problem (bad or expired session) and 5xx is Manyfold's.
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
    throw new HttpError(
      status,
      response.status === 429 ? "manyfold_rate_limited" : "manyfold_rejected",
      message.slice(0, 300),
    );
  }
  return parsed as T;
}

/**
 * Clears this user's earlier sessions. Starting a connect abandons any previous
 * one — the client only ever tracks a single handshake — so leaving old pending
 * rows around would just retain device codes nobody can use.
 */
async function pruneSessions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM manyfold_connect_sessions WHERE user_id=?",
  ).bind(userId).run();
}

/**
 * Opens a Manyfold A2A connect session. The `deviceCode` is the only credential
 * that can redeem the minted tokens, so it stays encrypted on the worker and is
 * never returned to the browser — the client only learns an opaque connect id.
 */
export async function startManyfoldConnect(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  await pruneSessions(env, userId);
  // `clientUrl` is optional and Manyfold requires https, so a local http origin
  // is omitted rather than sent and rejected.
  const origin = new URL(request.url).origin;
  const clientUrl = origin.startsWith("https://") ? origin : undefined;
  const started = await manyfoldFetch<ManyfoldStartResponse>(
    env,
    "/api/connect/a2a/start",
    { clientName: CLIENT_NAME, ...(clientUrl ? { clientUrl } : {}) },
    START_TIMEOUT_MS,
  );
  if (!started?.deviceCode || !started.authUrl || !started.userCode) {
    throw new HttpError(502, "manyfold_rejected", "Manyfold returned an incomplete connect session.");
  }
  // An unparseable expiry would make `expires_at` compare false forever and the
  // session would never age out locally, so fall back to Manyfold's own TTL.
  const remoteExpiry = Date.parse(started.expiresAt ?? "");
  const expiresAt = Number.isFinite(remoteExpiry)
    ? new Date(remoteExpiry).toISOString()
    : new Date(Date.now() + 15 * 60_000).toISOString();
  const encrypted = await encryptCredential(env, started.deviceCode);
  const connectId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO manyfold_connect_sessions
     (id,user_id,request_id,user_code,auth_url,device_code_ciphertext,device_code_iv,
      status,created_at,expires_at)
     VALUES(?,?,?,?,?,?,?, 'pending',?,?)`,
  ).bind(
    connectId,
    userId,
    started.requestId,
    started.userCode,
    started.authUrl,
    encrypted.ciphertext,
    encrypted.iv,
    new Date().toISOString(),
    expiresAt,
  ).run();

  return Response.json({
    connect: { connectId, userCode: started.userCode, authUrl: started.authUrl, expiresAt },
  }, { status: 201 });
}

/** Best-effort card read; a missing description must not fail a connect. */
async function describeFromCard(cardUrl: string): Promise<string> {
  try {
    const card = await fetchAgentCard([cardUrl]);
    return card.description ?? "";
  } catch {
    return "";
  }
}

async function freeHandle(env: Env, base: string): Promise<string> {
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base.slice(0, 31 - `-${suffix}`.length)}-${suffix}`;
    const row = await env.DB.prepare(
      "SELECT id FROM agents WHERE workspace_id='main' AND handle=?",
    ).bind(candidate).first<{ id: string }>();
    if (!row) return candidate;
  }
  throw new HttpError(409, "agent_handle_taken", "Could not derive a free Agent handle.");
}

/**
 * Saves one approved Manyfold agent. Re-connecting an agent that is already in
 * this workspace rotates its token in place instead of creating a duplicate,
 * and clears its A2A conversation state the same way a manual edit does.
 */
async function upsertConnectedAgent(
  env: Env,
  userId: string,
  entry: ManyfoldPollAgent,
): Promise<ConnectedAgentResult> {
  // Manyfold's response is still remote input, so the endpoint goes through the
  // same host guard as a hand-entered one.
  const rpcUrl = validateAgentRpcUrl(entry.rpcUrl, env.ENVIRONMENT === "production");
  const name = (entry.name || "Manyfold agent").slice(0, 60);
  const description = (await describeFromCard(entry.cardUrl)).slice(0, 240);
  const encrypted = await encryptCredential(env, entry.token);
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    "SELECT id,handle FROM agents WHERE workspace_id='main' AND owner_user_id=? AND rpc_url=?",
  ).bind(userId, rpcUrl).first<{ id: string; handle: string }>();

  let agentId: string;
  let handle: string;
  let created: boolean;
  if (existing) {
    agentId = existing.id;
    handle = existing.handle;
    created = false;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE agents SET name=?,description=?,token_ciphertext=?,token_iv=?,
         enabled=1,config_version=config_version+1,updated_at=? WHERE id=?`,
      ).bind(name, description, encrypted.ciphertext, encrypted.iv, now, agentId),
      env.DB.prepare(
        "UPDATE agent_conversations SET context_id=NULL,active_task_id=NULL,updated_at=? WHERE agent_id=?",
      ).bind(now, agentId),
    ]);
  } else {
    agentId = crypto.randomUUID();
    handle = await freeHandle(env, deriveAgentHandle(name));
    created = true;
    await env.DB.prepare(
      `INSERT INTO agents
       (id,workspace_id,owner_user_id,name,handle,description,rpc_url,
        token_ciphertext,token_iv,history_count,enabled,config_version,created_at,updated_at)
       VALUES(?,'main',?,?,?,?,?,?,?,20,1,1,?,?)`,
    ).bind(
      agentId,
      userId,
      name,
      handle,
      description,
      rpcUrl,
      encrypted.ciphertext,
      encrypted.iv,
      now,
      now,
    ).run();
  }

  // Cheap `tasks/get` probe, never a real turn: connecting N agents must not
  // bill N turns. Non-fatal so a transient failure cannot strand a live token.
  let verified = true;
  let warning: string | undefined;
  try {
    await verifyAgentCredentials(rpcUrl, entry.token);
  } catch (error) {
    verified = false;
    try {
      agentHttpError(error, "connect");
    } catch (mapped) {
      warning = mapped instanceof HttpError ? mapped.message : String(mapped);
    }
  }

  return { id: agentId, name, handle, manyfoldAgentId: entry.agentId, created, verified, warning };
}

/**
 * Polls Manyfold for the connect session and, once approved, materialises every
 * authorised agent into this workspace. Manyfold hands the tokens over exactly
 * once, so an approved poll is consumed here and the session row is dropped.
 */
export async function pollManyfoldConnect(
  env: Env,
  userId: string,
  connectId: string,
): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id,user_id,device_code_ciphertext,device_code_iv,expires_at,status
     FROM manyfold_connect_sessions WHERE id=?`,
  ).bind(connectId).first<{
    id: string;
    user_id: string;
    device_code_ciphertext: string;
    device_code_iv: string;
    expires_at: string;
    status: string;
  }>();
  if (!row || row.user_id !== userId) {
    throw new HttpError(404, "connect_session_not_found", "Connect session not found.");
  }
  if (row.status !== "pending") {
    return Response.json({ status: "expired" });
  }
  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare(
      "UPDATE manyfold_connect_sessions SET status='expired' WHERE id=?",
    ).bind(connectId).run();
    return Response.json({ status: "expired" });
  }

  const deviceCode = await decryptCredential(env, row.device_code_ciphertext, row.device_code_iv);
  const result = await manyfoldFetch<ManyfoldPollResponse>(
    env,
    "/api/connect/a2a/poll",
    { deviceCode },
    POLL_TIMEOUT_MS,
  );

  if (result.status !== "approved") {
    if (result.status !== "pending") {
      await env.DB.prepare(
        "UPDATE manyfold_connect_sessions SET status=? WHERE id=?",
      ).bind(result.status, connectId).run();
    }
    return Response.json({ status: result.status });
  }

  // Tokens are handed over once. Burn the session before consuming them so a
  // retry cannot re-enter this block, and drop the now-spent device code rather
  // than leaving a dead credential in the row. The guard on `status` keeps two
  // concurrent polls from both proceeding; Manyfold's poll is single-use too,
  // so the loser would in any case only ever see `expired`.
  await env.DB.prepare(
    `UPDATE manyfold_connect_sessions
     SET status='exchanged', device_code_ciphertext='', device_code_iv=''
     WHERE id=? AND status='pending'`,
  ).bind(connectId).run();

  const agents: ConnectedAgentResult[] = [];
  const failed: Array<{ manyfoldAgentId: string; name: string; error: string }> = [];
  for (const entry of result.agents ?? []) {
    try {
      agents.push(await upsertConnectedAgent(env, userId, entry));
    } catch (error) {
      failed.push({
        manyfoldAgentId: entry?.agentId ?? "unknown",
        name: entry?.name ?? "unknown",
        error: error instanceof HttpError ? error.message : String(error),
      });
    }
  }

  // The row stays as a spent marker so a retried poll gets `expired` instead of
  // a 404; `pruneSessions` clears it on this user's next connect.
  return Response.json({
    status: "approved",
    userEmail: result.userEmail ?? null,
    agents,
    failed,
  });
}

/** Lets the user abandon a session without waiting out the Manyfold TTL. */
export async function cancelManyfoldConnect(
  env: Env,
  userId: string,
  connectId: string,
): Promise<Response> {
  await env.DB.prepare(
    "DELETE FROM manyfold_connect_sessions WHERE id=? AND user_id=?",
  ).bind(connectId, userId).run();
  return Response.json({ ok: true });
}
