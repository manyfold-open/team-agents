import {
  agentCardCandidates,
  assertMutationOrigin,
  createSession,
  deleteSession,
  deriveAgentHandle,
  encryptCredential,
  enforceRateLimit,
  errorResponse,
  getAuthUser,
  hashPassword,
  HttpError,
  json,
  normalizeUsername,
  readJson,
  requireAuth,
  validateAgentRpcUrl,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "./security";
import {
  getPublicMessage,
  listPublicMessages,
  recordChannelEvent,
  requireChannelAccess,
  requireChannelMember,
} from "./data";
import { ensureSchema } from "./schema-sql";
import { agentHttpError, fetchAgentCard, verifyAgentCredentials, type AgentCardSummary } from "./a2a";
import type { AgentInput, AgentQueueMessage, AuthUser, CreateMessageInput, Env } from "./types";

const WORKSPACE_ID = "main";
const ALLOWED_REACTIONS = new Set(["👍", "❤️", "🎉", "👀", "✅", "🤔"]);

export async function handleApiRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  try {
    await ensureSchema(env.DB);
    assertMutationOrigin(request);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "team-agents", time: new Date().toISOString() });
    }
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      return await register(request, env);
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return await login(request, env);
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return json({ ok: true }, 200, { "set-cookie": await deleteSession(request, env) });
    }
    if (url.pathname === "/api/auth/change-password" && request.method === "POST") {
      return await changePassword(request, env);
    }
    if (url.pathname === "/api/bootstrap" && request.method === "GET") {
      return await bootstrap(request, env);
    }
    if (url.pathname === "/api/channels" && request.method === "POST") {
      return await createChannel(request, env);
    }
    if (url.pathname === "/api/agents" && request.method === "GET") {
      return await listAgents(request, env);
    }
    if (url.pathname === "/api/agents" && request.method === "POST") {
      return await createAgent(request, env);
    }
    if (url.pathname === "/api/agents/discover" && request.method === "POST") {
      return await discoverAgent(request, env);
    }

    const channelMessages = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
    if (channelMessages && request.method === "GET") {
      return await getMessages(request, env, decodeURIComponent(channelMessages[1]));
    }
    if (channelMessages && request.method === "POST") {
      return await createMessage(request, env, decodeURIComponent(channelMessages[1]));
    }
    const channelRoster = url.pathname.match(/^\/api\/channels\/([^/]+)\/roster$/);
    if (channelRoster && request.method === "GET") {
      return await getRoster(request, env, decodeURIComponent(channelRoster[1]));
    }
    const channelJoin = url.pathname.match(/^\/api\/channels\/([^/]+)\/join$/);
    if (channelJoin && request.method === "POST") {
      return await joinChannel(request, env, decodeURIComponent(channelJoin[1]));
    }
    const channelInvite = url.pathname.match(/^\/api\/channels\/([^/]+)\/invite$/);
    if (channelInvite && request.method === "POST") {
      return await inviteToChannel(request, env, decodeURIComponent(channelInvite[1]));
    }
    const channelRead = url.pathname.match(/^\/api\/channels\/([^/]+)\/read$/);
    if (channelRead && request.method === "POST") {
      return await markRead(request, env, decodeURIComponent(channelRead[1]));
    }
    const channelStream = url.pathname.match(/^\/api\/channels\/([^/]+)\/stream$/);
    if (channelStream && request.method === "GET") {
      return await connectChannel(request, env, decodeURIComponent(channelStream[1]));
    }
    const channelAgent = url.pathname.match(/^\/api\/channels\/([^/]+)\/agents\/([^/]+)$/);
    if (channelAgent && request.method === "POST") {
      return await addAgentToChannel(
        request,
        env,
        decodeURIComponent(channelAgent[1]),
        decodeURIComponent(channelAgent[2]),
      );
    }
    if (channelAgent && request.method === "DELETE") {
      return await removeAgentFromChannel(
        request,
        env,
        decodeURIComponent(channelAgent[1]),
        decodeURIComponent(channelAgent[2]),
      );
    }
    const resetAgent = url.pathname.match(/^\/api\/channels\/([^/]+)\/agents\/([^/]+)\/reset$/);
    if (resetAgent && request.method === "POST") {
      return await resetAgentContext(
        request,
        env,
        decodeURIComponent(resetAgent[1]),
        decodeURIComponent(resetAgent[2]),
      );
    }
    const reaction = url.pathname.match(/^\/api\/messages\/(\d+)\/reactions$/);
    if (reaction && request.method === "POST") {
      return await toggleReaction(request, env, Number(reaction[1]));
    }
    const agent = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (agent && request.method === "PATCH") {
      return await updateAgent(request, env, decodeURIComponent(agent[1]));
    }
    if (agent && request.method === "DELETE") {
      return await removeAgent(request, env, decodeURIComponent(agent[1]));
    }
    const runAction = url.pathname.match(/^\/api\/agent-runs\/([^/]+)\/(cancel|retry)$/);
    if (runAction && request.method === "POST") {
      return await actOnRun(
        request,
        env,
        decodeURIComponent(runAction[1]),
        runAction[2] as "cancel" | "retry",
      );
    }
    return json({ error: { code: "not_found", message: "API route not found." } }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}

async function register(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown }>(request);
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  await enforceRateLimit(request, env, "register", username);
  const credentials = await hashPassword(password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users
         (id,username,username_normalized,password_hash,password_salt,password_iterations,created_at)
         VALUES(?,?,?,?,?,?,?)`,
      ).bind(
        userId,
        username,
        normalizeUsername(username),
        credentials.hash,
        credentials.salt,
        credentials.iterations,
        now,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO workspaces(id,name,owner_user_id,created_at)
         VALUES('main','Team Agents',?,?)`,
      ).bind(userId, now),
      env.DB.prepare(
        `INSERT INTO workspace_members(workspace_id,user_id,role,joined_at)
         SELECT 'main',?,
           CASE WHEN owner_user_id=? THEN 'owner' ELSE 'member' END,?
         FROM workspaces WHERE id='main'`,
      ).bind(userId, userId, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO channels
         (id,workspace_id,name,slug,topic,is_private,created_by,created_at)
         SELECT 'general','main','general','general',
           'Team-wide updates and everyday collaboration',0,owner_user_id,?
         FROM workspaces WHERE id='main'`,
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO channel_members(channel_id,user_id,role,joined_at)
         SELECT 'general',?,
           CASE WHEN owner_user_id=? THEN 'manager' ELSE 'member' END,?
         FROM workspaces WHERE id='main'`,
      ).bind(userId, userId, now),
      env.DB.prepare(
        `INSERT INTO messages
         (client_message_id,channel_id,sender_type,content,status,created_at,updated_at)
         SELECT 'system:welcome','general','system',
           'Welcome to Team Agents. Invite your teammates, create a channel, or connect your first A2A agent.',
           'sent',?,?
         FROM workspaces
         WHERE id='main' AND owner_user_id=?
           AND NOT EXISTS (
             SELECT 1 FROM messages
             WHERE channel_id='general' AND client_message_id='system:welcome'
           )`,
      ).bind(now, now, userId),
    ]);
  } catch (error) {
    if (/unique/i.test(String(error))) {
      throw new HttpError(409, "username_taken", "That username is already registered.");
    }
    throw error;
  }
  const membership = await env.DB.prepare(
    "SELECT role FROM workspace_members WHERE workspace_id='main' AND user_id=?",
  ).bind(userId).first<{ role: "owner" | "member" }>();
  if (!membership) throw new HttpError(500, "registration_failed", "Could not join the workspace.");
  const role = membership.role;
  return json(
    { user: { id: userId, username, role } },
    201,
    { "set-cookie": await createSession(request, env, userId) },
  );
}

async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ username?: unknown; password?: unknown }>(request);
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  await enforceRateLimit(request, env, "login", username);
  const row = await env.DB.prepare(
    `SELECT u.id,u.username,u.password_hash,u.password_salt,u.password_iterations,u.disabled_at,
      wm.role
     FROM users u
     JOIN workspace_members wm ON wm.user_id=u.id AND wm.workspace_id='main'
     WHERE u.username_normalized=?`,
  ).bind(normalizeUsername(username)).first<{
    id: string;
    username: string;
    password_hash: string;
    password_salt: string;
    password_iterations: number;
    disabled_at: string | null;
    role: "owner" | "member";
  }>();
  if (!row || row.disabled_at || !await verifyPassword(
    password,
    row.password_hash,
    row.password_salt,
    row.password_iterations,
  )) {
    throw new HttpError(401, "invalid_credentials", "Username or password is incorrect.");
  }
  return json(
    { user: { id: row.id, username: row.username, role: row.role } },
    200,
    { "set-cookie": await createSession(request, env, row.id) },
  );
}

async function changePassword(request: Request, env: Env): Promise<Response> {
  const user = await requireAuth(request, env);
  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request);
  const currentPassword = validatePassword(body.currentPassword);
  const newPassword = validatePassword(body.newPassword);
  const row = await env.DB.prepare(
    "SELECT password_hash,password_salt,password_iterations FROM users WHERE id=?",
  ).bind(user.id).first<{
    password_hash: string;
    password_salt: string;
    password_iterations: number;
  }>();
  if (!row || !await verifyPassword(
    currentPassword,
    row.password_hash,
    row.password_salt,
    row.password_iterations,
  )) {
    throw new HttpError(401, "invalid_credentials", "Current password is incorrect.");
  }
  const next = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET password_hash=?,password_salt=?,password_iterations=? WHERE id=?",
    ).bind(next.hash, next.salt, next.iterations, user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
  ]);
  return json(
    { ok: true },
    200,
    { "set-cookie": await createSession(request, env, user.id) },
  );
}

async function bootstrap(request: Request, env: Env): Promise<Response> {
  const user = await getAuthUser(request, env);
  if (!user) return json({ authenticated: false });
  const channels = await listChannels(env, user);
  const agents = await getAgentsForUser(env, user);
  return json({
    authenticated: true,
    user,
    workspace: { id: WORKSPACE_ID, name: "Team Agents" },
    channels,
    agents,
  });
}

async function listChannels(env: Env, user: AuthUser): Promise<unknown[]> {
  const rows = await env.DB.prepare(
    `SELECT c.id,c.name,c.slug,c.topic,c.is_private,cm.role AS member_role,
      COALESCE((SELECT MAX(m.id) FROM messages m WHERE m.channel_id=c.id),0) AS latest_message_id,
      COALESCE(rc.last_message_id,0) AS last_read_id,
      (SELECT COUNT(*) FROM channel_members x WHERE x.channel_id=c.id) AS member_count,
      (SELECT COUNT(*) FROM channel_agents x WHERE x.channel_id=c.id) AS agent_count
     FROM channels c
     LEFT JOIN channel_members cm ON cm.channel_id=c.id AND cm.user_id=?
     LEFT JOIN read_cursors rc ON rc.channel_id=c.id AND rc.user_id=?
     WHERE c.workspace_id='main' AND c.archived_at IS NULL
       AND (c.is_private=0 OR cm.user_id IS NOT NULL OR ?='owner')
     ORDER BY CASE WHEN c.slug='general' THEN 0 ELSE 1 END,c.name COLLATE NOCASE`,
  ).bind(user.id, user.id, user.role).all<{
    id: string;
    name: string;
    slug: string;
    topic: string;
    is_private: number;
    member_role: "manager" | "member" | null;
    latest_message_id: number;
    last_read_id: number;
    member_count: number;
    agent_count: number;
  }>();
  return rows.results.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    topic: row.topic,
    isPrivate: Boolean(row.is_private),
    joined: Boolean(row.member_role) || user.role === "owner",
    role: row.member_role,
    unread: Number(row.latest_message_id) > Number(row.last_read_id),
    latestMessageId: Number(row.latest_message_id),
    memberCount: Number(row.member_count),
    agentCount: Number(row.agent_count),
  }));
}

async function createChannel(request: Request, env: Env): Promise<Response> {
  const user = await requireAuth(request, env);
  const body = await readJson<{ name?: unknown; topic?: unknown; isPrivate?: unknown }>(request);
  if (typeof body.name !== "string") throw new HttpError(400, "invalid_channel", "Channel name is required.");
  const slug = body.name.trim().normalize("NFKC").toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u3400-\u9fff-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  if (!slug) throw new HttpError(400, "invalid_channel", "Channel name is invalid.");
  const name = body.name.trim().slice(0, 60);
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 240) : "";
  const channelId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO channels
         (id,workspace_id,name,slug,topic,is_private,created_by,created_at)
         VALUES(?,'main',?,?,?,?,?,?)`,
      ).bind(channelId, name, slug, topic, body.isPrivate ? 1 : 0, user.id, now),
      env.DB.prepare(
        `INSERT INTO channel_members(channel_id,user_id,role,joined_at)
         VALUES(?,?,'manager',?)`,
      ).bind(channelId, user.id, now),
    ]);
  } catch (error) {
    if (/unique/i.test(String(error))) {
      throw new HttpError(409, "channel_exists", "A channel with that name already exists.");
    }
    throw error;
  }
  return json({ channel: (await listChannels(env, user)).find(
    (candidate) => (candidate as { id: string }).id === channelId,
  ) }, 201);
}

async function joinChannel(request: Request, env: Env, channelId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  const channel = await requireChannelAccess(env, user, channelId);
  if (channel.isPrivate) throw new HttpError(403, "invite_required", "Private channels require an invitation.");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_members(channel_id,user_id,role,joined_at)
     VALUES(?,?,'member',?)`,
  ).bind(channelId, user.id, now).run();
  await recordChannelEvent(env, channelId, "member.updated", { userId: user.id, action: "joined" });
  return json({ ok: true });
}

async function inviteToChannel(request: Request, env: Env, channelId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  const channel = await requireChannelMember(env, user, channelId);
  if (!channel.canManage) throw new HttpError(403, "manager_required", "Only channel managers can add members.");
  const body = await readJson<{ username?: unknown }>(request);
  const username = validateUsername(body.username);
  const target = await env.DB.prepare(
    "SELECT id,username FROM users WHERE username_normalized=? AND disabled_at IS NULL",
  ).bind(normalizeUsername(username)).first<{ id: string; username: string }>();
  if (!target) throw new HttpError(404, "user_not_found", "No member has that username.");
  await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_members(channel_id,user_id,role,joined_at)
     VALUES(?,?,'member',?)`,
  ).bind(channelId, target.id, new Date().toISOString()).run();
  await recordChannelEvent(env, channelId, "member.updated", {
    userId: target.id,
    username: target.username,
    action: "joined",
  });
  return json({ ok: true });
}

async function getMessages(request: Request, env: Env, channelId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  const channel = await requireChannelAccess(env, user, channelId);
  if (!channel.memberRole && user.role !== "owner") {
    return json({ channel, messages: [], requiresJoin: true });
  }
  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before") ?? 0) || undefined;
  const threadRootId = Number(url.searchParams.get("thread") ?? 0) || undefined;
  const messages = await listPublicMessages(env, channelId, user.id, { before, threadRootId });
  let root = null;
  if (threadRootId) root = await getPublicMessage(env, threadRootId, user.id);
  return json({ channel, messages, root, requiresJoin: false });
}

async function getRoster(request: Request, env: Env, channelId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  await requireChannelAccess(env, user, channelId);
  const [members, agents] = await Promise.all([
    env.DB.prepare(
      `SELECT u.id,u.username,cm.role
       FROM channel_members cm JOIN users u ON u.id=cm.user_id
       WHERE cm.channel_id=? AND u.disabled_at IS NULL
       ORDER BY u.username COLLATE NOCASE`,
    ).bind(channelId).all<{ id: string; username: string; role: "manager" | "member" }>(),
    env.DB.prepare(
      `SELECT a.id,a.name,a.handle,a.description,a.owner_user_id,ca.joined_at,
        u.username AS owner_username
       FROM channel_agents ca
       JOIN agents a ON a.id=ca.agent_id
       JOIN users u ON u.id=a.owner_user_id
       WHERE ca.channel_id=? AND a.enabled=1
       ORDER BY a.name COLLATE NOCASE`,
    ).bind(channelId).all<{
      id: string;
      name: string;
      handle: string;
      description: string;
      owner_user_id: string;
      owner_username: string;
      joined_at: string;
    }>(),
  ]);
  return json({
    members: members.results.map((member) => ({ ...member, kind: "user" })),
    agents: agents.results.map((agent) => ({
      id: agent.id,
      name: agent.name,
      handle: agent.handle,
      description: agent.description,
      ownerUserId: agent.owner_user_id,
      ownerUsername: agent.owner_username,
      joinedAt: agent.joined_at,
      kind: "agent",
    })),
  });
}

async function createMessage(request: Request, env: Env, channelId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  await requireChannelMember(env, user, channelId);
  const body = await readJson<Partial<CreateMessageInput>>(request);
  if (typeof body.clientMessageId !== "string" || !body.clientMessageId) {
    throw new HttpError(400, "client_message_id_required", "clientMessageId is required.");
  }
  if (typeof body.content !== "string" || !body.content.trim() || body.content.length > 20_000) {
    throw new HttpError(400, "invalid_message", "Message must contain 1–20,000 characters.");
  }
  const existing = await env.DB.prepare(
    "SELECT id FROM messages WHERE channel_id=? AND client_message_id=?",
  ).bind(channelId, body.clientMessageId).first<{ id: number }>();
  if (existing) {
    return json({ message: await getPublicMessage(env, existing.id, user.id), duplicate: true });
  }
  const threadRootId = body.threadRootId ? Number(body.threadRootId) : null;
  if (threadRootId) {
    const root = await env.DB.prepare(
      "SELECT id FROM messages WHERE id=? AND channel_id=? AND thread_root_id IS NULL",
    ).bind(threadRootId, channelId).first();
    if (!root) throw new HttpError(400, "invalid_thread", "Thread root message is invalid.");
  }
  const mentions = dedupeMentions(body.mentions);
  const validAgentIds = await validMentionedAgents(env, channelId, mentions);
  const now = new Date().toISOString();
  const insert = await env.DB.prepare(
    `INSERT INTO messages
     (client_message_id,channel_id,thread_root_id,sender_type,sender_user_id,content,status,created_at,updated_at)
     VALUES(?,?,?,'user',?,?,'sent',?,?)`,
  ).bind(
    body.clientMessageId,
    channelId,
    threadRootId,
    user.id,
    body.content.trim(),
    now,
    now,
  ).run();
  const messageId = Number(insert.meta.last_row_id);
  if (mentions.length) {
    await env.DB.batch(mentions.map((mention) => env.DB.prepare(
      "INSERT OR IGNORE INTO message_mentions(message_id,kind,target_id) VALUES(?,?,?)",
    ).bind(messageId, mention.kind, mention.id)));
  }
  const message = await getPublicMessage(env, messageId, user.id);
  if (message) await recordChannelEvent(env, channelId, "message.created", message);

  const runs: Array<{ id: string; responseMessageId: number }> = [];
  for (const agentId of validAgentIds) {
    const runId = crypto.randomUUID();
    const responseInsert = await env.DB.prepare(
      `INSERT INTO messages
       (channel_id,thread_root_id,sender_type,sender_agent_id,content,status,run_id,created_at,updated_at)
       VALUES(?,?,'agent',?,'Thinking…','queued',?,?,?)`,
    ).bind(channelId, threadRootId, agentId, runId, now, now).run();
    const responseMessageId = Number(responseInsert.meta.last_row_id);
    await env.DB.prepare(
      `INSERT INTO agent_runs
       (id,agent_id,channel_id,thread_root_id,trigger_message_id,response_message_id,status,created_at)
       VALUES(?,?,?,?,?,?,'queued',?)`,
    ).bind(runId, agentId, channelId, threadRootId, messageId, responseMessageId, now).run();
    const response = await getPublicMessage(env, responseMessageId, user.id);
    if (response) await recordChannelEvent(env, channelId, "message.created", response);
    runs.push({ id: runId, responseMessageId });
  }
  for (const run of runs) {
    try {
      await env.AGENT_TASKS.send({
        kind: "start",
        runId: run.id,
        queuedAt: new Date().toISOString(),
      } satisfies AgentQueueMessage);
    } catch {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE agent_runs SET status='failed',last_error='Queue unavailable',completed_at=? WHERE id=?",
        ).bind(new Date().toISOString(), run.id),
        env.DB.prepare(
          "UPDATE messages SET content='Agent queue is temporarily unavailable.',status='failed',updated_at=? WHERE id=?",
        ).bind(new Date().toISOString(), run.responseMessageId),
      ]);
    }
  }
  return json({ message, runs }, 201);
}

function dedupeMentions(
  value: unknown,
): Array<{ kind: "user" | "agent"; id: string }> {
  if (!Array.isArray(value)) return [];
  const output: Array<{ kind: "user" | "agent"; id: string }> = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as Record<string, unknown>;
    if (!["user", "agent"].includes(String(raw.kind)) || typeof raw.id !== "string") continue;
    const mention = { kind: raw.kind as "user" | "agent", id: raw.id };
    const key = `${mention.kind}:${mention.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(mention);
    }
  }
  return output.slice(0, 20);
}

async function validMentionedAgents(
  env: Env,
  channelId: string,
  mentions: Array<{ kind: "user" | "agent"; id: string }>,
): Promise<string[]> {
  const agentIds = mentions.filter((mention) => mention.kind === "agent").map((mention) => mention.id);
  if (!agentIds.length) return [];
  const placeholders = agentIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT a.id FROM agents a
     JOIN channel_agents ca ON ca.agent_id=a.id AND ca.channel_id=?
     WHERE a.id IN (${placeholders}) AND a.enabled=1`,
  ).bind(channelId, ...agentIds).all<{ id: string }>();
  const valid = new Set(rows.results.map((row) => row.id));
  if (valid.size !== new Set(agentIds).size) {
    throw new HttpError(400, "invalid_agent_mention", "One or more mentioned Agents are unavailable.");
  }
  return [...valid];
}

async function toggleReaction(request: Request, env: Env, messageId: number): Promise<Response> {
  const user = await requireAuth(request, env);
  const body = await readJson<{ emoji?: unknown }>(request);
  if (typeof body.emoji !== "string" || !ALLOWED_REACTIONS.has(body.emoji)) {
    throw new HttpError(400, "invalid_reaction", "That reaction is not supported.");
  }
  const message = await env.DB.prepare(
    "SELECT channel_id FROM messages WHERE id=?",
  ).bind(messageId).first<{ channel_id: string }>();
  if (!message) throw new HttpError(404, "message_not_found", "Message not found.");
  await requireChannelMember(env, user, message.channel_id);
  const existing = await env.DB.prepare(
    "SELECT 1 AS found FROM reactions WHERE message_id=? AND user_id=? AND emoji=?",
  ).bind(messageId, user.id, body.emoji).first();
  if (existing) {
    await env.DB.prepare(
      "DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?",
    ).bind(messageId, user.id, body.emoji).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO reactions(message_id,user_id,emoji,created_at) VALUES(?,?,?,?)",
    ).bind(messageId, user.id, body.emoji, new Date().toISOString()).run();
  }
  const updated = await getPublicMessage(env, messageId, user.id);
  if (updated) await recordChannelEvent(env, message.channel_id, "reaction.updated", updated);
  return json({ message: updated });
}

async function markRead(request: Request, env: Env, channelId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  await requireChannelMember(env, user, channelId);
  const body = await readJson<{ messageId?: unknown }>(request);
  const messageId = Math.max(0, Number(body.messageId) || 0);
  await env.DB.prepare(
    `INSERT INTO read_cursors(channel_id,user_id,last_message_id,updated_at)
     VALUES(?,?,?,?)
     ON CONFLICT(channel_id,user_id) DO UPDATE SET
       last_message_id=MAX(last_message_id,excluded.last_message_id),
       updated_at=excluded.updated_at`,
  ).bind(channelId, user.id, messageId, new Date().toISOString()).run();
  return json({ ok: true });
}

async function connectChannel(request: Request, env: Env, channelId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  await requireChannelMember(env, user, channelId);
  const room = env.CHANNEL_ROOMS.getByName(channelId);
  const forwarded = new Request(
    `https://channel-room.internal/connect${new URL(request.url).search}`,
    request,
  );
  forwarded.headers.set("x-team-agents-channel-id", channelId);
  forwarded.headers.set("x-team-agents-user-id", user.id);
  return room.fetch(forwarded);
}

async function getAgentsForUser(env: Env, user: AuthUser): Promise<unknown[]> {
  const rows = await env.DB.prepare(
    `SELECT a.id,a.owner_user_id,a.name,a.handle,a.description,a.rpc_url,a.history_count,
      a.enabled,a.updated_at,u.username AS owner_username,
      (SELECT COUNT(*) FROM channel_agents ca WHERE ca.agent_id=a.id) AS channel_count
     FROM agents a JOIN users u ON u.id=a.owner_user_id
     WHERE a.workspace_id='main' AND (a.owner_user_id=? OR ?='owner')
     ORDER BY a.enabled DESC,a.name COLLATE NOCASE`,
  ).bind(user.id, user.role).all<{
    id: string;
    owner_user_id: string;
    name: string;
    handle: string;
    description: string;
    rpc_url: string;
    history_count: number;
    enabled: number;
    updated_at: string;
    owner_username: string;
    channel_count: number;
  }>();
  return rows.results.map(publicAgent);
}

function publicAgent(row: {
  id: string;
  owner_user_id: string;
  name: string;
  handle: string;
  description: string;
  rpc_url: string;
  history_count: number;
  enabled: number;
  updated_at: string;
  owner_username?: string;
  channel_count?: number;
}): unknown {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerUsername: row.owner_username,
    name: row.name,
    handle: row.handle,
    description: row.description,
    rpcUrl: row.rpc_url,
    historyCount: Number(row.history_count),
    enabled: Boolean(row.enabled),
    tokenConfigured: true,
    updatedAt: row.updated_at,
    channelCount: Number(row.channel_count ?? 0),
  };
}

async function listAgents(request: Request, env: Env): Promise<Response> {
  const user = await requireAuth(request, env);
  return json({ agents: await getAgentsForUser(env, user) });
}

/** Reads the public Agent Card behind whatever URL shape the user pasted. */
async function discoverCard(cardUrl: unknown, env: Env): Promise<AgentCardSummary> {
  const candidates = agentCardCandidates(cardUrl, env.ENVIRONMENT === "production");
  try {
    const card = await fetchAgentCard(candidates);
    // The endpoint advertised by the card is still user-influenced input, so it
    // goes through the same host guard as a hand-entered RPC URL.
    return { ...card, rpcUrl: validateAgentRpcUrl(card.rpcUrl, env.ENVIRONMENT === "production") };
  } catch (error) {
    agentHttpError(error, "discover");
  }
}

/** Verifies credentials and reports failures as an actionable 4xx/502. */
async function verifyAgentConnection(rpcUrl: string, bearerToken: string): Promise<void> {
  try {
    await verifyAgentCredentials(rpcUrl, bearerToken);
  } catch (error) {
    agentHttpError(error, "connect");
  }
}

async function discoverAgent(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);
  const body = await readJson<{ cardUrl?: string }>(request);
  const card = await discoverCard(body.cardUrl, env);
  return json({
    card: {
      cardUrl: card.cardUrl,
      name: card.name,
      description: card.description,
      rpcUrl: card.rpcUrl,
      protocolVersion: card.protocolVersion,
      streaming: card.streaming,
      skills: card.skills,
      suggestedHandle: deriveAgentHandle(card.name),
    },
  });
}

/** Appends `-2`, `-3`… until the derived handle is free in this workspace. */
async function uniqueHandle(env: Env, base: string, excludeAgentId?: string): Promise<string> {
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base.slice(0, 31 - `-${suffix}`.length)}-${suffix}`;
    const row = await env.DB.prepare(
      "SELECT id FROM agents WHERE workspace_id='main' AND handle=? AND id IS NOT ?",
    ).bind(candidate, excludeAgentId ?? null).first<{ id: string }>();
    if (!row) return candidate;
  }
  throw new HttpError(409, "agent_handle_taken", "Could not derive a free Agent handle.");
}

function validateAgentInput(
  input: Partial<AgentInput>,
  env: Env,
  requireToken: boolean,
  card?: AgentCardSummary,
): Required<Omit<AgentInput, "bearerToken" | "cardUrl">> & { bearerToken?: string } {
  const name = typeof input.name === "string" && input.name.trim()
    ? input.name.trim().slice(0, 60)
    : card?.name ?? "";
  if (!name) throw new HttpError(400, "invalid_agent_name", "Agent name is required.");
  const rawHandle = typeof input.handle === "string" ? input.handle.trim().toLowerCase().replace(/^@/, "") : "";
  const handle = rawHandle || (card ? deriveAgentHandle(name) : "");
  if (!/^[a-z0-9][a-z0-9_-]{1,30}$/.test(handle)) {
    throw new HttpError(400, "invalid_agent_handle", "Agent handle must be 2–31 lowercase letters, numbers, underscores, or hyphens.");
  }
  const bearerToken = typeof input.bearerToken === "string" ? input.bearerToken.trim() : undefined;
  if (requireToken && !bearerToken) {
    throw new HttpError(400, "agent_token_required", "Bearer token is required.");
  }
  const description = typeof input.description === "string" && input.description.trim()
    ? input.description.trim().slice(0, 240)
    : card?.description ?? "";
  return {
    name,
    handle,
    description,
    rpcUrl: card && input.rpcUrl === undefined
      ? card.rpcUrl
      : validateAgentRpcUrl(input.rpcUrl, env.ENVIRONMENT === "production"),
    historyCount: input.historyCount === undefined
      ? 20
      : Math.min(100, Math.max(0, Number(input.historyCount) || 0)),
    ...(bearerToken ? { bearerToken } : {}),
  };
}

async function createAgent(request: Request, env: Env): Promise<Response> {
  const user = await requireAuth(request, env);
  const body = await readJson<Partial<AgentInput>>(request);
  const card = body.cardUrl ? await discoverCard(body.cardUrl, env) : undefined;
  const input = validateAgentInput(body, env, true, card);
  await verifyAgentConnection(input.rpcUrl, input.bearerToken!);
  // A handle the user never typed must not fail the save; a typed one still does.
  const handle = typeof body.handle === "string" && body.handle.trim()
    ? input.handle
    : await uniqueHandle(env, input.handle);
  input.handle = handle;
  const encrypted = await encryptCredential(env, input.bearerToken!);
  const agentId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO agents
       (id,workspace_id,owner_user_id,name,handle,description,rpc_url,
        token_ciphertext,token_iv,history_count,enabled,config_version,created_at,updated_at)
       VALUES(?,'main',?,?,?,?,?,?,?,?,1,1,?,?)`,
    ).bind(
      agentId,
      user.id,
      input.name,
      input.handle,
      input.description,
      input.rpcUrl,
      encrypted.ciphertext,
      encrypted.iv,
      input.historyCount,
      now,
      now,
    ).run();
  } catch (error) {
    if (/unique/i.test(String(error))) {
      throw new HttpError(409, "agent_handle_taken", "That Agent handle is already in use.");
    }
    throw error;
  }
  const row = await env.DB.prepare(
    `SELECT id,owner_user_id,name,handle,description,rpc_url,history_count,enabled,updated_at
     FROM agents WHERE id=?`,
  ).bind(agentId).first<{
    id: string;
    owner_user_id: string;
    name: string;
    handle: string;
    description: string;
    rpc_url: string;
    history_count: number;
    enabled: number;
    updated_at: string;
  }>();
  return json({ agent: row ? publicAgent(row) : null }, 201);
}

async function updateAgent(request: Request, env: Env, agentId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  const current = await env.DB.prepare(
    `SELECT id,owner_user_id,name,handle,description,rpc_url,token_ciphertext,token_iv,
      history_count,enabled,config_version,updated_at
     FROM agents WHERE id=?`,
  ).bind(agentId).first<{
    id: string;
    owner_user_id: string;
    name: string;
    handle: string;
    description: string;
    rpc_url: string;
    token_ciphertext: string;
    token_iv: string;
    history_count: number;
    enabled: number;
    config_version: number;
    updated_at: string;
  }>();
  if (!current) throw new HttpError(404, "agent_not_found", "Agent not found.");
  if (current.owner_user_id !== user.id) {
    throw new HttpError(403, "agent_owner_required", "Only the Agent owner can edit credentials.");
  }
  const raw = await readJson<Partial<AgentInput>>(request);
  // Re-discovery refreshes name / description / endpoint from the card, but only
  // for fields the caller did not override in this request.
  const card = raw.cardUrl ? await discoverCard(raw.cardUrl, env) : undefined;
  const input = validateAgentInput({
    name: raw.name ?? card?.name ?? current.name,
    handle: raw.handle ?? current.handle,
    description: raw.description ?? card?.description ?? current.description,
    rpcUrl: raw.rpcUrl ?? card?.rpcUrl ?? current.rpc_url,
    historyCount: raw.historyCount ?? current.history_count,
    bearerToken: raw.bearerToken,
  }, env, false);
  const currentToken = await import("./security").then(({ decryptCredential }) =>
    decryptCredential(env, current.token_ciphertext, current.token_iv));
  const token = input.bearerToken || currentToken;
  await verifyAgentConnection(input.rpcUrl, token);
  let ciphertext = current.token_ciphertext;
  let iv = current.token_iv;
  // A stored A2A contextId only belongs to one endpoint + identity, so renaming
  // an Agent or changing its history depth must not throw away channel memory.
  // Only a new endpoint or a genuinely different token invalidates it — and the
  // config_version bump has to be conditional too, since the queue worker resets
  // context on its own whenever the versions diverge (see a2a.ts getConversation).
  const credentialsChanged = input.rpcUrl !== current.rpc_url || token !== currentToken;
  if (input.bearerToken && token !== currentToken) {
    const encrypted = await encryptCredential(env, input.bearerToken);
    ciphertext = encrypted.ciphertext;
    iv = encrypted.iv;
  }
  const now = new Date().toISOString();
  try {
    const statements = [
      env.DB.prepare(
        `UPDATE agents SET name=?,handle=?,description=?,rpc_url=?,token_ciphertext=?,
         token_iv=?,history_count=?,enabled=1,config_version=config_version+?,updated_at=?
         WHERE id=?`,
      ).bind(
        input.name,
        input.handle,
        input.description,
        input.rpcUrl,
        ciphertext,
        iv,
        input.historyCount,
        credentialsChanged ? 1 : 0,
        now,
        agentId,
      ),
    ];
    if (credentialsChanged) {
      statements.push(env.DB.prepare(
        "UPDATE agent_conversations SET context_id=NULL,active_task_id=NULL,updated_at=? WHERE agent_id=?",
      ).bind(now, agentId));
    }
    await env.DB.batch(statements);
  } catch (error) {
    if (/unique/i.test(String(error))) {
      throw new HttpError(409, "agent_handle_taken", "That Agent handle is already in use.");
    }
    throw error;
  }
  const row = await env.DB.prepare(
    `SELECT id,owner_user_id,name,handle,description,rpc_url,history_count,enabled,updated_at
     FROM agents WHERE id=?`,
  ).bind(agentId).first<typeof current>();
  return json({ agent: row ? publicAgent(row) : null });
}

async function removeAgent(request: Request, env: Env, agentId: string): Promise<Response> {
  const user = await requireAuth(request, env);
  const agent = await env.DB.prepare(
    "SELECT owner_user_id FROM agents WHERE id=?",
  ).bind(agentId).first<{ owner_user_id: string }>();
  if (!agent) throw new HttpError(404, "agent_not_found", "Agent not found.");
  if (agent.owner_user_id !== user.id && user.role !== "owner") {
    throw new HttpError(403, "agent_owner_required", "Only the Agent owner or workspace owner can remove it.");
  }
  const channels = await env.DB.prepare(
    "SELECT channel_id FROM channel_agents WHERE agent_id=?",
  ).bind(agentId).all<{ channel_id: string }>();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE agents SET enabled=0,updated_at=? WHERE id=?").bind(now, agentId),
    env.DB.prepare("DELETE FROM channel_agents WHERE agent_id=?").bind(agentId),
    env.DB.prepare("DELETE FROM agent_conversations WHERE agent_id=?").bind(agentId),
    env.DB.prepare(
      "UPDATE agent_runs SET status='canceled',completed_at=? WHERE agent_id=? AND status IN ('queued','running')",
    ).bind(now, agentId),
  ]);
  for (const channel of channels.results) {
    await recordChannelEvent(env, channel.channel_id, "member.updated", {
      agentId,
      action: "removed",
    });
  }
  return json({ ok: true });
}

async function addAgentToChannel(
  request: Request,
  env: Env,
  channelId: string,
  agentId: string,
): Promise<Response> {
  const user = await requireAuth(request, env);
  await requireChannelMember(env, user, channelId);
  const agent = await env.DB.prepare(
    "SELECT owner_user_id,enabled FROM agents WHERE id=?",
  ).bind(agentId).first<{ owner_user_id: string; enabled: number }>();
  if (!agent || !agent.enabled) throw new HttpError(404, "agent_not_found", "Agent not found.");
  if (agent.owner_user_id !== user.id) {
    throw new HttpError(403, "agent_owner_required", "Only the Agent owner can add it to a channel.");
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO channel_agents(channel_id,agent_id,added_by,joined_at)
     VALUES(?,?,?,?)`,
  ).bind(channelId, agentId, user.id, new Date().toISOString()).run();
  await recordChannelEvent(env, channelId, "member.updated", { agentId, action: "joined" });
  return json({ ok: true });
}

async function removeAgentFromChannel(
  request: Request,
  env: Env,
  channelId: string,
  agentId: string,
): Promise<Response> {
  const user = await requireAuth(request, env);
  await requireChannelMember(env, user, channelId);
  const agent = await env.DB.prepare(
    "SELECT owner_user_id FROM agents WHERE id=?",
  ).bind(agentId).first<{ owner_user_id: string }>();
  if (!agent) throw new HttpError(404, "agent_not_found", "Agent not found.");
  if (agent.owner_user_id !== user.id) {
    throw new HttpError(403, "agent_owner_required", "Only the Agent owner can remove it.");
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM channel_agents WHERE channel_id=? AND agent_id=?")
      .bind(channelId, agentId),
    env.DB.prepare("DELETE FROM agent_conversations WHERE channel_id=? AND agent_id=?")
      .bind(channelId, agentId),
    env.DB.prepare(
      `UPDATE agent_runs SET status='canceled',completed_at=?
       WHERE channel_id=? AND agent_id=? AND status IN ('queued','running')`,
    ).bind(now, channelId, agentId),
  ]);
  await recordChannelEvent(env, channelId, "member.updated", { agentId, action: "removed" });
  return json({ ok: true });
}

async function resetAgentContext(
  request: Request,
  env: Env,
  channelId: string,
  agentId: string,
): Promise<Response> {
  const user = await requireAuth(request, env);
  await requireChannelMember(env, user, channelId);
  const agent = await env.DB.prepare(
    "SELECT owner_user_id FROM agents WHERE id=?",
  ).bind(agentId).first<{ owner_user_id: string }>();
  if (!agent || agent.owner_user_id !== user.id) {
    throw new HttpError(403, "agent_owner_required", "Only the Agent owner can reset its memory.");
  }
  const body = await readJson<{ threadRootId?: unknown }>(request);
  const threadKey = Number(body.threadRootId) > 0 ? String(Number(body.threadRootId)) : "main";
  await env.DB.prepare(
    "DELETE FROM agent_conversations WHERE channel_id=? AND agent_id=? AND thread_key=?",
  ).bind(channelId, agentId, threadKey).run();
  return json({ ok: true });
}

async function actOnRun(
  request: Request,
  env: Env,
  runId: string,
  action: "cancel" | "retry",
): Promise<Response> {
  const user = await requireAuth(request, env);
  const run = await env.DB.prepare(
    `SELECT r.id,r.status,r.channel_id,r.agent_id,r.response_message_id,
      m.sender_user_id AS trigger_user_id,a.owner_user_id
     FROM agent_runs r
     JOIN messages m ON m.id=r.trigger_message_id
     JOIN agents a ON a.id=r.agent_id
     WHERE r.id=?`,
  ).bind(runId).first<{
    id: string;
    status: string;
    channel_id: string;
    agent_id: string;
    response_message_id: number;
    trigger_user_id: string;
    owner_user_id: string;
  }>();
  if (!run) throw new HttpError(404, "run_not_found", "Agent run not found.");
  await requireChannelMember(env, user, run.channel_id);
  if (![run.trigger_user_id, run.owner_user_id].includes(user.id) && user.role !== "owner") {
    throw new HttpError(403, "run_action_forbidden", "You cannot manage this Agent run.");
  }
  if (action === "cancel") {
    if (!["queued", "running"].includes(run.status)) {
      throw new HttpError(409, "run_not_active", "This Agent run is not active.");
    }
    await env.AGENT_TASKS.send({ kind: "cancel", runId, queuedAt: new Date().toISOString() });
    return json({ ok: true });
  }
  if (run.status !== "failed" && run.status !== "canceled") {
    throw new HttpError(409, "run_not_retryable", "Only failed or canceled runs can be retried.");
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE agent_runs SET status='queued',remote_task_id=NULL,remote_context_id=NULL,
       last_error=NULL,attempt=0,started_at=NULL,completed_at=NULL,created_at=? WHERE id=?`,
    ).bind(now, runId),
    env.DB.prepare(
      "UPDATE messages SET content='Thinking…',status='queued',updated_at=? WHERE id=?",
    ).bind(now, run.response_message_id),
  ]);
  await env.AGENT_TASKS.send({ kind: "start", runId, queuedAt: now });
  return json({ ok: true });
}
