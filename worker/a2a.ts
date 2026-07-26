import { decryptCredential, redactSecret } from "./security";
import { getPublicMessage, recordChannelEvent } from "./data";
import type { AgentQueueMessage, Env } from "./types";

type TaskState =
  | "submitted"
  | "working"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected"
  | "input-required"
  | "auth-required"
  | "";

interface AgentRecord {
  id: string;
  name: string;
  handle: string;
  rpc_url: string;
  token_ciphertext: string;
  token_iv: string;
  history_count: number;
  config_version: number;
  enabled: number;
}

interface RunRecord {
  id: string;
  agent_id: string;
  channel_id: string;
  thread_root_id: number | null;
  trigger_message_id: number;
  response_message_id: number;
  status: "queued" | "running" | "input-required" | "completed" | "failed" | "canceled";
  remote_task_id: string | null;
  remote_context_id: string | null;
  attempt: number;
  created_at: string;
}

interface ConversationRecord {
  id: string;
  context_id: string | null;
  active_task_id: string | null;
  config_version: number;
}

interface StreamSnapshot {
  taskId: string | null;
  contextId: string | null;
  state: TaskState;
  text: string;
  terminal: boolean;
  interrupted: boolean;
}

interface StreamAccumulator {
  taskId: string | null;
  contextId: string | null;
  state: TaskState;
  artifacts: Map<string, string>;
  order: string[];
  directText: string;
  statusText: string;
  finalEventSeen: boolean;
}

class A2AError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(redactSecret(message));
    this.name = "A2AError";
  }
}

const TERMINAL = new Set<TaskState>([
  "completed",
  "failed",
  "canceled",
  "rejected",
  "input-required",
  "auth-required",
]);
const STREAM_SEGMENT_MS = 9 * 60_000;
const RUN_LIMIT_MS = 2 * 60 * 60_000;

export async function testAgentStream(
  rpcUrl: string,
  bearerToken: string,
): Promise<{ ok: true; contextId: string | null; state: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let received = false;
  let taskId: string | null = null;
  try {
    const snapshot = await consumeStream({
      rpcUrl,
      bearerToken,
      method: "message/stream",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: crypto.randomUUID(),
          parts: [{
            kind: "text",
            text: "Connection test from Team Agents. Reply briefly to confirm streaming works.",
          }],
        },
        configuration: { acceptedOutputModes: ["text/plain"] },
      },
      signal: controller.signal,
      stopAfterFirstEvent: true,
      onSnapshot(snapshotValue) {
        received = true;
        taskId = snapshotValue.taskId;
      },
    });
    if (!received) throw new A2AError("The endpoint returned no A2A streaming events.", false);
    return { ok: true, contextId: snapshot.contextId, state: snapshot.state || "connected" };
  } catch (error) {
    if (received) return { ok: true, contextId: null, state: taskId ? "submitted" : "connected" };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleAgentTaskBatch(
  batch: MessageBatch<AgentQueueMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await handleAgentTask(message.body, env);
      message.ack();
    } catch (error) {
      console.error("Agent queue task failed:", redactSecret(
        error instanceof Error ? error.message : String(error),
      ));
      message.retry({ delaySeconds: Math.min(60, 2 ** Math.min(message.attempts, 5)) });
    }
  }
}

async function handleAgentTask(job: AgentQueueMessage, env: Env): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT r.*,a.name,a.handle,a.rpc_url,a.token_ciphertext,a.token_iv,
      a.history_count,a.config_version,a.enabled
     FROM agent_runs r JOIN agents a ON a.id=r.agent_id
     WHERE r.id=?`,
  ).bind(job.runId).first<RunRecord & AgentRecord>();
  if (!row || ["completed", "failed", "canceled"].includes(row.status)) return;
  const run = row;
  if (!row.enabled) {
    await failRun(env, row, "Agent is disabled.");
    return;
  }
  if (Date.now() - Date.parse(row.created_at) > RUN_LIMIT_MS) {
    await failRun(env, row, "Agent run exceeded the two-hour limit.");
    return;
  }
  if (job.kind === "cancel") {
    await cancelRemoteRun(env, row);
    return;
  }

  const earlier = await env.DB.prepare(
    `SELECT id FROM agent_runs
     WHERE agent_id=? AND channel_id=? AND COALESCE(thread_root_id,0)=?
       AND status IN ('queued','running') AND created_at<? AND id<>?
     ORDER BY created_at ASC LIMIT 1`,
  ).bind(
    row.agent_id,
    row.channel_id,
    row.thread_root_id ?? 0,
    row.created_at,
    row.id,
  ).first<{ id: string }>();
  if (earlier) {
    await env.AGENT_TASKS.send(job, { delaySeconds: 2 });
    return;
  }

  const token = await decryptCredential(env, row.token_ciphertext, row.token_iv);
  const conversation = await getConversation(env, row);
  if (conversation.config_version !== row.config_version) {
    await env.DB.prepare(
      `UPDATE agent_conversations SET context_id=NULL,active_task_id=NULL,
       config_version=?,updated_at=? WHERE id=?`,
    ).bind(row.config_version, new Date().toISOString(), conversation.id).run();
    conversation.context_id = null;
    conversation.active_task_id = null;
    conversation.config_version = row.config_version;
  }

  await setRunState(env, row, "running");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_SEGMENT_MS);
  let latestText = "";
  let lastPersistedAt = 0;
  let snapshot: StreamSnapshot | null = null;
  try {
    if (job.kind === "resume" && row.remote_task_id) {
      const current = await getTaskSnapshot(row.rpc_url, token, row.remote_task_id);
      snapshot = current;
      if (!current.terminal) {
        snapshot = await consumeStream({
          rpcUrl: row.rpc_url,
          bearerToken: token,
          method: "tasks/resubscribe",
          params: { id: row.remote_task_id },
          signal: controller.signal,
          seed: current,
          onSnapshot: persist,
        });
      }
    } else {
      const prompt = await buildAgentPrompt(env, row);
      snapshot = await consumeStream({
        rpcUrl: row.rpc_url,
        bearerToken: token,
        method: "message/stream",
        params: {
          message: {
            kind: "message",
            role: "user",
            messageId: `team-agents-${row.id}`,
            ...(conversation.context_id ? { contextId: conversation.context_id } : {}),
            ...(conversation.active_task_id ? { taskId: conversation.active_task_id } : {}),
            parts: [{ kind: "text", text: prompt }],
          },
          configuration: { acceptedOutputModes: ["text/plain"] },
        },
        signal: controller.signal,
        onSnapshot: persist,
      });
    }

    if (snapshot.taskId || snapshot.contextId) {
      await rememberRemoteIds(env, row, conversation.id, snapshot);
    }
    if (snapshot.text && snapshot.text !== latestText) {
      await persist(snapshot, true);
    }
    if (snapshot.terminal) {
      await finishRun(env, row, conversation.id, snapshot);
      return;
    }
    await env.AGENT_TASKS.send(
      { kind: "resume", runId: row.id, queuedAt: new Date().toISOString() },
      { delaySeconds: 2 },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && row.remote_task_id) {
      await env.AGENT_TASKS.send(
        { kind: "resume", runId: row.id, queuedAt: new Date().toISOString() },
        { delaySeconds: 1 },
      );
      return;
    }
    const failure = normalizeA2AError(error);
    const canResume = Boolean(row.remote_task_id) && failure.retryable;
    if (canResume) {
      await env.AGENT_TASKS.send(
        { kind: "resume", runId: row.id, queuedAt: new Date().toISOString() },
        { delaySeconds: failure.retryAfterSeconds ?? 3 },
      );
      return;
    }
    if (!row.remote_task_id && failure.retryable && row.attempt < 2) {
      await env.DB.prepare("UPDATE agent_runs SET attempt=attempt+1,last_error=? WHERE id=?")
        .bind(failure.message, row.id).run();
      await env.AGENT_TASKS.send(
        { kind: "start", runId: row.id, queuedAt: new Date().toISOString() },
        { delaySeconds: failure.retryAfterSeconds ?? 2 },
      );
      return;
    }
    await failRun(env, row, failure.message);
  } finally {
    clearTimeout(timer);
  }

  async function persist(value: StreamSnapshot, force = false): Promise<void> {
    if (value.taskId || value.contextId) {
      run.remote_task_id = value.taskId;
      run.remote_context_id = value.contextId;
      await rememberRemoteIds(env, run, conversation.id, value);
    }
    if (!value.text || value.text === latestText) return;
    const now = Date.now();
    if (!force && now - lastPersistedAt < 350) return;
    latestText = value.text.slice(0, 200_000);
    lastPersistedAt = now;
    await env.DB.prepare(
      "UPDATE messages SET content=?,status='streaming',updated_at=? WHERE id=?",
    ).bind(latestText, new Date().toISOString(), run.response_message_id).run();
    const message = await getPublicMessage(env, run.response_message_id, "");
    if (message) await recordChannelEvent(env, run.channel_id, "message.updated", message);
  }
}

async function getConversation(
  env: Env,
  run: RunRecord & AgentRecord,
): Promise<ConversationRecord> {
  const threadKey = run.thread_root_id ? String(run.thread_root_id) : "main";
  const existing = await env.DB.prepare(
    `SELECT id,context_id,active_task_id,config_version
     FROM agent_conversations WHERE agent_id=? AND channel_id=? AND thread_key=?`,
  ).bind(run.agent_id, run.channel_id, threadKey).first<ConversationRecord>();
  if (existing) return existing;
  const created: ConversationRecord = {
    id: crypto.randomUUID(),
    context_id: null,
    active_task_id: null,
    config_version: run.config_version,
  };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_conversations
      (id,agent_id,channel_id,thread_key,context_id,active_task_id,config_version,updated_at)
     VALUES(?,?,?,?,NULL,NULL,?,?)`,
  ).bind(
    created.id,
    run.agent_id,
    run.channel_id,
    threadKey,
    run.config_version,
    new Date().toISOString(),
  ).run();
  return await env.DB.prepare(
    `SELECT id,context_id,active_task_id,config_version
     FROM agent_conversations WHERE agent_id=? AND channel_id=? AND thread_key=?`,
  ).bind(run.agent_id, run.channel_id, threadKey).first<ConversationRecord>() ?? created;
}

async function buildAgentPrompt(env: Env, run: RunRecord & AgentRecord): Promise<string> {
  const joined = await env.DB.prepare(
    "SELECT joined_at FROM channel_agents WHERE channel_id=? AND agent_id=?",
  ).bind(run.channel_id, run.agent_id).first<{ joined_at: string }>();
  if (!joined) throw new A2AError("Agent is no longer a member of this channel.", false);

  const historyCount = Math.min(100, Math.max(0, Number(run.history_count) || 0));
  type TranscriptRow = {
    id: number;
    sender_type: "user" | "agent" | "system";
    content: string;
    created_at: string;
    username: string | null;
    agent_name: string | null;
    agent_handle: string | null;
  };
  let history: TranscriptRow[] = [];
  if (historyCount > 0) {
    if (run.thread_root_id) {
      const root = await env.DB.prepare(
        `SELECT m.id,m.sender_type,m.content,m.created_at,u.username,
          a.name AS agent_name,a.handle AS agent_handle
         FROM messages m
         LEFT JOIN users u ON u.id=m.sender_user_id
         LEFT JOIN agents a ON a.id=m.sender_agent_id
         WHERE m.id=? AND m.channel_id=? AND m.created_at>=?`,
      ).bind(run.thread_root_id, run.channel_id, joined.joined_at).first<TranscriptRow>();
      const replies = await env.DB.prepare(
        `SELECT m.id,m.sender_type,m.content,m.created_at,u.username,
          a.name AS agent_name,a.handle AS agent_handle
         FROM messages m
         LEFT JOIN users u ON u.id=m.sender_user_id
         LEFT JOIN agents a ON a.id=m.sender_agent_id
         WHERE m.channel_id=? AND m.thread_root_id=? AND m.id<? AND m.created_at>=?
         ORDER BY m.id DESC LIMIT ?`,
      ).bind(
        run.channel_id,
        run.thread_root_id,
        run.trigger_message_id,
        joined.joined_at,
        historyCount,
      ).all<TranscriptRow>();
      history = [...(root ? [root] : []), ...replies.results.reverse()];
    } else {
      const rows = await env.DB.prepare(
        `SELECT m.id,m.sender_type,m.content,m.created_at,u.username,
          a.name AS agent_name,a.handle AS agent_handle
         FROM messages m
         LEFT JOIN users u ON u.id=m.sender_user_id
         LEFT JOIN agents a ON a.id=m.sender_agent_id
         WHERE m.channel_id=? AND m.thread_root_id IS NULL
           AND m.id<? AND m.created_at>=?
         ORDER BY m.id DESC LIMIT ?`,
      ).bind(
        run.channel_id,
        run.trigger_message_id,
        joined.joined_at,
        historyCount,
      ).all<TranscriptRow>();
      history = rows.results.reverse();
    }
  }
  const trigger = await env.DB.prepare(
    `SELECT m.id,m.sender_type,m.content,m.created_at,u.username,
      a.name AS agent_name,a.handle AS agent_handle
     FROM messages m
     LEFT JOIN users u ON u.id=m.sender_user_id
     LEFT JOIN agents a ON a.id=m.sender_agent_id
     WHERE m.id=? AND m.channel_id=?`,
  ).bind(run.trigger_message_id, run.channel_id).first<TranscriptRow>();
  if (!trigger) throw new A2AError("The triggering message no longer exists.", false);

  const transcript = [...history, trigger].map((message) => {
    const actor = message.sender_type === "user"
      ? `@${message.username ?? "member"} (person)`
      : message.sender_type === "agent"
        ? `@${message.agent_handle ?? "agent"} (${message.agent_name ?? "Agent"})`
        : "Team Agents (system)";
    return `[${message.created_at}] ${actor}: ${message.content}`;
  }).join("\n\n").slice(-80_000);

  return [
    "You are participating in a Team Agents channel with people and other agents.",
    "Respond to the final message as a helpful teammate. Use the language requested by the sender.",
    "Do not claim to have seen messages outside the transcript. Do not mention hidden credentials.",
    "",
    "--- Authorized conversation transcript ---",
    transcript,
    "--- End transcript ---",
  ].join("\n");
}

async function rememberRemoteIds(
  env: Env,
  run: RunRecord,
  conversationId: string,
  snapshot: Pick<StreamSnapshot, "taskId" | "contextId">,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE agent_runs SET remote_task_id=COALESCE(?,remote_task_id),remote_context_id=COALESCE(?,remote_context_id) WHERE id=?",
    ).bind(snapshot.taskId, snapshot.contextId, run.id),
    env.DB.prepare(
      `UPDATE agent_conversations SET
       context_id=COALESCE(?,context_id),active_task_id=COALESCE(?,active_task_id),updated_at=?
       WHERE id=?`,
    ).bind(snapshot.contextId, snapshot.taskId, new Date().toISOString(), conversationId),
  ]);
}

async function setRunState(
  env: Env,
  run: RunRecord,
  state: "running",
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE agent_runs SET status=?,started_at=COALESCE(started_at,?) WHERE id=? AND status IN ('queued','running')",
    ).bind(state, now, run.id),
    env.DB.prepare(
      "UPDATE messages SET status='streaming',updated_at=? WHERE id=?",
    ).bind(now, run.response_message_id),
  ]);
  await recordChannelEvent(env, run.channel_id, "agent.run.updated", {
    id: run.id,
    status: state,
    responseMessageId: run.response_message_id,
  });
}

async function finishRun(
  env: Env,
  run: RunRecord,
  conversationId: string,
  snapshot: StreamSnapshot,
): Promise<void> {
  const now = new Date().toISOString();
  const state = snapshot.state;
  const runStatus = state === "completed"
    ? "completed"
    : state === "input-required" || state === "auth-required"
      ? "input-required"
      : state === "canceled"
        ? "canceled"
        : "failed";
  const messageStatus = runStatus === "completed"
    ? "sent"
    : runStatus === "input-required"
      ? "input-required"
      : runStatus;
  const text = snapshot.text
    || (runStatus === "input-required"
      ? "The agent needs more information."
      : runStatus === "failed"
        ? "The agent could not complete this request."
        : "The agent run was canceled.");
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE agent_runs SET status=?,remote_task_id=COALESCE(?,remote_task_id),
       remote_context_id=COALESCE(?,remote_context_id),completed_at=? WHERE id=?`,
    ).bind(runStatus, snapshot.taskId, snapshot.contextId, now, run.id),
    env.DB.prepare(
      "UPDATE messages SET content=?,status=?,updated_at=? WHERE id=?",
    ).bind(text.slice(0, 200_000), messageStatus, now, run.response_message_id),
    env.DB.prepare(
      `UPDATE agent_conversations SET context_id=COALESCE(?,context_id),
       active_task_id=?,updated_at=? WHERE id=?`,
    ).bind(
      snapshot.contextId,
      runStatus === "input-required" ? snapshot.taskId : null,
      now,
      conversationId,
    ),
  ]);
  const message = await getPublicMessage(env, run.response_message_id, "");
  if (message) await recordChannelEvent(env, run.channel_id, "message.updated", message);
  await recordChannelEvent(env, run.channel_id, "agent.run.updated", {
    id: run.id,
    status: runStatus,
    responseMessageId: run.response_message_id,
  });
}

async function failRun(env: Env, run: RunRecord, message: string): Promise<void> {
  const safe = redactSecret(message);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE agent_runs SET status='failed',last_error=?,completed_at=? WHERE id=?",
    ).bind(safe, now, run.id),
    env.DB.prepare(
      "UPDATE messages SET content=?,status='failed',updated_at=? WHERE id=?",
    ).bind(`Agent error: ${safe}`, now, run.response_message_id),
  ]);
  const response = await getPublicMessage(env, run.response_message_id, "");
  if (response) await recordChannelEvent(env, run.channel_id, "message.updated", response);
  await recordChannelEvent(env, run.channel_id, "agent.run.updated", {
    id: run.id,
    status: "failed",
    responseMessageId: run.response_message_id,
    error: safe,
  });
}

async function cancelRemoteRun(env: Env, run: RunRecord & AgentRecord): Promise<void> {
  if (run.remote_task_id) {
    try {
      const token = await decryptCredential(env, run.token_ciphertext, run.token_iv);
      await rpcJson(run.rpc_url, token, "tasks/cancel", { id: run.remote_task_id });
    } catch {
      // Cancellation is best effort; local state still stops the run.
    }
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE agent_runs SET status='canceled',completed_at=? WHERE id=?",
    ).bind(now, run.id),
    env.DB.prepare(
      "UPDATE messages SET status='canceled',updated_at=? WHERE id=?",
    ).bind(now, run.response_message_id),
  ]);
  const response = await getPublicMessage(env, run.response_message_id, "");
  if (response) await recordChannelEvent(env, run.channel_id, "message.updated", response);
}

async function getTaskSnapshot(
  rpcUrl: string,
  bearerToken: string,
  taskId: string,
): Promise<StreamSnapshot> {
  const data = await rpcJson(rpcUrl, bearerToken, "tasks/get", { id: taskId });
  const accumulator = createAccumulator();
  applyA2AResult(accumulator, data.result);
  return snapshotFrom(accumulator, false);
}

async function rpcJson(
  rpcUrl: string,
  bearerToken: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${bearerToken}`,
    },
    redirect: "manual",
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  if (!response.ok) throw await responseError(response);
  try {
    const data = await response.json() as Record<string, unknown>;
    if (data.error) throw new A2AError(jsonRpcError(data.error), false);
    return data;
  } catch (error) {
    if (error instanceof A2AError) throw error;
    throw new A2AError(`A2A ${method} returned invalid JSON.`, true);
  }
}

async function consumeStream(options: {
  rpcUrl: string;
  bearerToken: string;
  method: "message/stream" | "tasks/resubscribe";
  params: Record<string, unknown>;
  signal: AbortSignal;
  seed?: StreamSnapshot;
  stopAfterFirstEvent?: boolean;
  onSnapshot?: (snapshot: StreamSnapshot) => Promise<void> | void;
}): Promise<StreamSnapshot> {
  const response = await fetch(options.rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${options.bearerToken}`,
    },
    redirect: "manual",
    signal: options.signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: options.method,
      params: options.params,
    }),
  });
  if (!response.ok) throw await responseError(response);
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) {
    throw new A2AError("A2A endpoint does not support message/stream SSE.", false);
  }
  if (!response.body) throw new A2AError("A2A streaming response had no body.", true);

  const accumulator = createAccumulator(options.seed);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          let envelope: Record<string, unknown>;
          try {
            envelope = JSON.parse(data) as Record<string, unknown>;
          } catch {
            throw new A2AError("A2A stream emitted invalid JSON.", true);
          }
          if (envelope.error) throw new A2AError(jsonRpcError(envelope.error), false);
          applyA2AResult(accumulator, envelope.result);
          received = true;
          const snapshot = snapshotFrom(accumulator, false);
          await options.onSnapshot?.(snapshot);
          if (options.stopAfterFirstEvent || snapshot.terminal) return snapshot;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!received && !options.seed) throw new A2AError("A2A stream ended without events.", true);
  return snapshotFrom(accumulator, !TERMINAL.has(accumulator.state));
}

function createAccumulator(seed?: StreamSnapshot): StreamAccumulator {
  const artifacts = new Map<string, string>();
  if (seed?.text) artifacts.set("seed", seed.text);
  return {
    taskId: seed?.taskId ?? null,
    contextId: seed?.contextId ?? null,
    state: seed?.state ?? "",
    artifacts,
    order: seed?.text ? ["seed"] : [],
    directText: "",
    statusText: "",
    finalEventSeen: seed?.terminal ?? false,
  };
}

function applyA2AResult(accumulator: StreamAccumulator, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const value = raw as Record<string, unknown>;
  const kind = String(value.kind ?? "").toLowerCase();
  const taskId = stringValue(value.taskId) ?? stringValue(value.id);
  const contextId = stringValue(value.contextId);
  if (taskId) accumulator.taskId = taskId;
  if (contextId) accumulator.contextId = contextId;

  if (kind === "artifact-update" || value.artifact) {
    const artifact = (value.artifact ?? {}) as Record<string, unknown>;
    const id = stringValue(artifact.artifactId) ?? stringValue(artifact.id) ?? "artifact";
    const text = partsText(artifact.parts);
    if (!accumulator.order.includes(id)) accumulator.order.push(id);
    accumulator.artifacts.set(
      id,
      value.append ? `${accumulator.artifacts.get(id) ?? ""}${text}` : text,
    );
    if (value.lastChunk === true) accumulator.finalEventSeen = true;
  }

  if (kind === "message" || (value.role && value.parts)) {
    accumulator.directText = partsText(value.parts) || accumulator.directText;
  }

  const status = (value.status ?? {}) as Record<string, unknown>;
  const state = normalizeState(status.state ?? value.state);
  if (state) accumulator.state = state;
  const statusMessage = status.message as Record<string, unknown> | undefined;
  if (statusMessage) accumulator.statusText = partsText(statusMessage.parts) || accumulator.statusText;

  const artifacts = value.artifacts as Array<Record<string, unknown>> | undefined;
  for (const artifact of artifacts ?? []) {
    const id = stringValue(artifact.artifactId) ?? stringValue(artifact.id) ?? crypto.randomUUID();
    if (!accumulator.order.includes(id)) accumulator.order.push(id);
    accumulator.artifacts.set(id, partsText(artifact.parts));
  }
  if (value.final === true) accumulator.finalEventSeen = true;
}

function snapshotFrom(accumulator: StreamAccumulator, interrupted: boolean): StreamSnapshot {
  const artifactText = accumulator.order
    .map((id) => accumulator.artifacts.get(id) ?? "")
    .filter(Boolean)
    .join("\n\n");
  const text = artifactText || accumulator.directText || accumulator.statusText;
  return {
    taskId: accumulator.taskId,
    contextId: accumulator.contextId,
    state: accumulator.state,
    text,
    terminal: TERMINAL.has(accumulator.state),
    interrupted,
  };
}

function partsText(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  return raw
    .map((part) => part && typeof part === "object" && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
}

function normalizeState(value: unknown): TaskState {
  const raw = String(value ?? "").toLowerCase().replace(/^task_state_/, "").replace(/_/g, "-");
  return [
    "submitted",
    "working",
    "completed",
    "failed",
    "canceled",
    "rejected",
    "input-required",
    "auth-required",
  ].includes(raw) ? raw as TaskState : "";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function jsonRpcError(value: unknown): string {
  if (!value || typeof value !== "object") return "A2A JSON-RPC error.";
  const error = value as Record<string, unknown>;
  return `A2A JSON-RPC error ${String(error.code ?? "")}: ${String(error.message ?? "Unknown error")}`;
}

async function responseError(response: Response): Promise<A2AError> {
  const detail = redactSecret((await response.text()).replace(/\s+/g, " ").slice(0, 1_000));
  const retryAfter = Number(response.headers.get("retry-after"));
  const retryable = response.status === 408
    || response.status === 409
    || response.status === 425
    || response.status === 429
    || response.status >= 500;
  return new A2AError(
    `A2A endpoint returned HTTP ${response.status}${detail ? ` · ${detail}` : ""}`,
    retryable,
    response.status,
    Number.isFinite(retryAfter) ? Math.min(300, Math.max(1, retryAfter)) : undefined,
  );
}

function normalizeA2AError(error: unknown): A2AError {
  if (error instanceof A2AError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new A2AError("A2A stream segment timed out.", true);
  }
  const message = redactSecret(error instanceof Error ? error.message : String(error));
  return new A2AError(
    message || "Unknown A2A failure.",
    error instanceof TypeError || /timeout|temporar|network|fetch failed|unavailable/i.test(message),
  );
}

export function parseA2AEventForTest(
  previous: { text?: string; taskId?: string | null; contextId?: string | null; state?: string },
  result: unknown,
): StreamSnapshot {
  const accumulator = createAccumulator({
    taskId: previous.taskId ?? null,
    contextId: previous.contextId ?? null,
    state: normalizeState(previous.state),
    text: previous.text ?? "",
    terminal: false,
    interrupted: false,
  });
  applyA2AResult(accumulator, result);
  return snapshotFrom(accumulator, false);
}

export function parseA2AEventsForTest(results: unknown[]): StreamSnapshot {
  const accumulator = createAccumulator();
  for (const result of results) applyA2AResult(accumulator, result);
  return snapshotFrom(accumulator, false);
}
