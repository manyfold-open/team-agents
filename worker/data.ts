import type { AuthUser, ChannelEvent, ChannelEventKind, Env, PublicRun } from "./types";
import { HttpError } from "./security";

export interface ChannelAccess {
  id: string;
  name: string;
  slug: string;
  topic: string;
  isPrivate: boolean;
  createdBy: string;
  memberRole: "manager" | "member" | null;
  canManage: boolean;
}

export interface MessageRow {
  id: number;
  client_message_id: string | null;
  channel_id: string;
  thread_root_id: number | null;
  sender_type: "user" | "agent" | "system";
  sender_user_id: string | null;
  sender_agent_id: string | null;
  content: string;
  status: "sent" | "queued" | "streaming" | "input-required" | "failed" | "canceled";
  run_id: string | null;
  created_at: string;
  updated_at: string;
  username: string | null;
  agent_name: string | null;
  agent_handle: string | null;
  agent_owner_user_id: string | null;
  run_trigger_user_id: string | null;
  run_status: PublicRun["status"] | null;
  run_attempt: number | null;
  run_started_at: string | null;
  run_progress_text: string | null;
  run_relay_index: number | null;
  run_relay_total: number | null;
}

/**
 * Columns the message queries pull off `agent_runs`. Aliased because `m.*` is
 * selected alongside them and both tables carry `status`.
 */
const RUN_COLUMNS = `ar.status AS run_status,ar.attempt AS run_attempt,
      ar.started_at AS run_started_at,ar.progress_text AS run_progress_text,
      ar.relay_index AS run_relay_index,ar.relay_total AS run_relay_total`;

export interface PublicMessage {
  id: number;
  clientMessageId: string | null;
  channelId: string;
  threadRootId: number | null;
  sender: {
    type: "user" | "agent" | "system";
    id: string | null;
    name: string;
    handle?: string;
  };
  content: string;
  status: MessageRow["status"];
  runId: string | null;
  runTriggeredByUserId: string | null;
  agentOwnerUserId: string | null;
  run: PublicRun | null;
  createdAt: string;
  updatedAt: string;
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
  replyCount: number;
}

export async function getChannelAccess(
  env: Env,
  user: AuthUser,
  channelId: string,
): Promise<ChannelAccess | null> {
  const row = await env.DB.prepare(
    `SELECT c.id,c.name,c.slug,c.topic,c.is_private,c.created_by,cm.role AS member_role
     FROM channels c
     LEFT JOIN channel_members cm ON cm.channel_id=c.id AND cm.user_id=?
     WHERE c.id=? AND c.archived_at IS NULL`,
  ).bind(user.id, channelId).first<{
    id: string;
    name: string;
    slug: string;
    topic: string;
    is_private: number;
    created_by: string;
    member_role: "manager" | "member" | null;
  }>();
  if (!row) return null;
  if (row.is_private && !row.member_role && user.role !== "owner") return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    topic: row.topic,
    isPrivate: Boolean(row.is_private),
    createdBy: row.created_by,
    memberRole: row.member_role,
    canManage: user.role === "owner" || row.member_role === "manager",
  };
}

export async function requireChannelAccess(
  env: Env,
  user: AuthUser,
  channelId: string,
): Promise<ChannelAccess> {
  const channel = await getChannelAccess(env, user, channelId);
  if (!channel) throw new HttpError(404, "channel_not_found", "Channel not found.");
  return channel;
}

export async function requireChannelMember(
  env: Env,
  user: AuthUser,
  channelId: string,
): Promise<ChannelAccess> {
  const channel = await requireChannelAccess(env, user, channelId);
  if (!channel.memberRole && user.role !== "owner") {
    throw new HttpError(403, "channel_membership_required", "Join this channel first.");
  }
  return channel;
}

export async function recordChannelEvent(
  env: Env,
  channelId: string,
  kind: ChannelEventKind,
  data: unknown,
): Promise<ChannelEvent> {
  const result = await env.DB.prepare(
    "INSERT INTO channel_events(channel_id,kind,data_json,created_at) VALUES(?,?,?,?)",
  ).bind(channelId, kind, JSON.stringify(data), new Date().toISOString()).run();
  const event: ChannelEvent = {
    eventId: Number(result.meta.last_row_id),
    channelId,
    kind,
    data,
  };
  const room = env.CHANNEL_ROOMS.getByName(channelId);
  await room.fetch("https://channel-room.internal/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  return event;
}

export async function getPublicMessage(
  env: Env,
  messageId: number,
  currentUserId: string,
): Promise<PublicMessage | null> {
  const row = await env.DB.prepare(
    `SELECT m.*,u.username,a.name AS agent_name,a.handle AS agent_handle,
      a.owner_user_id AS agent_owner_user_id,trigger.sender_user_id AS run_trigger_user_id,
      ${RUN_COLUMNS}
     FROM messages m
     LEFT JOIN users u ON u.id=m.sender_user_id
     LEFT JOIN agents a ON a.id=m.sender_agent_id
     LEFT JOIN agent_runs ar ON ar.id=m.run_id
     LEFT JOIN messages trigger ON trigger.id=ar.trigger_message_id
     WHERE m.id=?`,
  ).bind(messageId).first<MessageRow>();
  if (!row) return null;
  const [reactionRows, replyRow] = await Promise.all([
    env.DB.prepare(
      `SELECT emoji,COUNT(*) AS count,
        MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS reacted
       FROM reactions WHERE message_id=? GROUP BY emoji ORDER BY MIN(created_at)`,
    ).bind(currentUserId, messageId).all<{ emoji: string; count: number; reacted: number }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM messages WHERE thread_root_id=?",
    ).bind(messageId).first<{ count: number }>(),
  ]);
  return mapMessage(row, reactionRows.results, replyRow?.count ?? 0);
}

export const MESSAGE_PAGE_SIZE = 50;

/**
 * Callers over-fetch by one row so a single query answers both "what is on this
 * page" and "is there anything older". Rows arrive oldest-first, so the surplus
 * sits at the front and is what gets trimmed.
 */
export function splitMessagePage<T>(
  rows: T[],
  size: number = MESSAGE_PAGE_SIZE,
): { messages: T[]; hasMore: boolean } {
  if (rows.length <= size) return { messages: rows, hasMore: false };
  return { messages: rows.slice(rows.length - size), hasMore: true };
}

export async function listPublicMessages(
  env: Env,
  channelId: string,
  currentUserId: string,
  options: { before?: number; after?: number; threadRootId?: number; limit?: number } = {},
): Promise<PublicMessage[]> {
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const binds: unknown[] = [channelId];
  const where = ["m.channel_id=?"];
  if (options.threadRootId) {
    where.push("m.thread_root_id=?");
    binds.push(options.threadRootId);
  } else {
    where.push("m.thread_root_id IS NULL");
  }
  if (options.before) {
    where.push("m.id<?");
    binds.push(options.before);
  }
  if (options.after) {
    where.push("m.id>?");
    binds.push(options.after);
  }
  binds.push(limit);
  // Walking forward takes the rows nearest the cursor, which for `after` are
  // the oldest ones — the opposite end of the range from every other page.
  const forward = Boolean(options.after);
  const rows = await env.DB.prepare(
    `SELECT m.*,u.username,a.name AS agent_name,a.handle AS agent_handle,
      a.owner_user_id AS agent_owner_user_id,trigger.sender_user_id AS run_trigger_user_id,
      ${RUN_COLUMNS}
     FROM messages m
     LEFT JOIN users u ON u.id=m.sender_user_id
     LEFT JOIN agents a ON a.id=m.sender_agent_id
     LEFT JOIN agent_runs ar ON ar.id=m.run_id
     LEFT JOIN messages trigger ON trigger.id=ar.trigger_message_id
     WHERE ${where.join(" AND ")}
     ORDER BY m.id ${forward ? "ASC" : "DESC"} LIMIT ?`,
  ).bind(...binds).all<MessageRow>();
  if (!rows.results.length) return [];
  return await enrichMessages(env, forward ? rows.results : rows.results.reverse(), currentUserId);
}

/** Attaches reactions and reply counts to an already-ordered page of rows. */
async function enrichMessages(
  env: Env,
  ordered: MessageRow[],
  currentUserId: string,
): Promise<PublicMessage[]> {
  const ids = ordered.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const [reactionRows, replyRows] = await Promise.all([
    env.DB.prepare(
      `SELECT message_id,emoji,COUNT(*) AS count,
        MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS reacted
       FROM reactions WHERE message_id IN (${placeholders})
       GROUP BY message_id,emoji ORDER BY MIN(created_at)`,
    ).bind(currentUserId, ...ids).all<{
      message_id: number;
      emoji: string;
      count: number;
      reacted: number;
    }>(),
    env.DB.prepare(
      `SELECT thread_root_id,COUNT(*) AS count
       FROM messages WHERE thread_root_id IN (${placeholders})
       GROUP BY thread_root_id`,
    ).bind(...ids).all<{ thread_root_id: number; count: number }>(),
  ]);
  const reactionsByMessage = new Map<number, Array<{ emoji: string; count: number; reacted: number }>>();
  for (const reaction of reactionRows.results) {
    const list = reactionsByMessage.get(reaction.message_id) ?? [];
    list.push(reaction);
    reactionsByMessage.set(reaction.message_id, list);
  }
  const repliesByMessage = new Map(replyRows.results.map((row) => [row.thread_root_id, row.count]));
  return ordered.map((row) => mapMessage(
    row,
    reactionsByMessage.get(row.id) ?? [],
    repliesByMessage.get(row.id) ?? 0,
  ));
}

/** Half of an `around` window, per side of the target message. */
const HALF_WINDOW = 25;

export interface MessageWindow {
  messages: PublicMessage[];
  /** Older messages exist before the first row of this window. */
  hasMore: boolean;
  /** Newer messages exist after the last row — true only away from the tail. */
  hasNewer: boolean;
}

/**
 * A page centred on one message rather than on the tail of the channel.
 *
 * This is what makes "go to the answer" land on the answer. Both halves
 * over-fetch by one row so the caller learns, from the same two queries,
 * whether the transcript continues in either direction — a reader who arrives
 * mid-history has to be able to page both ways out of where they landed.
 */
export async function listMessagesAround(
  env: Env,
  channelId: string,
  currentUserId: string,
  messageId: number,
  threadRootId?: number,
): Promise<MessageWindow> {
  const [olderPage, newerPage] = await Promise.all([
    // `before: messageId + 1` is `id <= messageId`: the target itself anchors
    // the older half rather than being skipped by a strict `<`.
    listPublicMessages(env, channelId, currentUserId, {
      before: messageId + 1,
      threadRootId,
      limit: HALF_WINDOW + 1,
    }),
    listPublicMessages(env, channelId, currentUserId, {
      after: messageId,
      threadRootId,
      limit: HALF_WINDOW + 1,
    }),
  ]);
  const older = splitMessagePage(olderPage, HALF_WINDOW);
  const hasNewer = newerPage.length > HALF_WINDOW;
  return {
    messages: [...older.messages, ...newerPage.slice(0, HALF_WINDOW)],
    hasMore: older.hasMore,
    hasNewer,
  };
}

export interface SearchHit {
  messageId: number;
  channelId: string;
  channelName: string;
  threadRootId: number | null;
  senderType: "user" | "agent" | "system";
  senderName: string;
  senderHandle: string | null;
  excerpt: string;
  createdAt: string;
}

/** Trigram cannot index anything shorter, so this is where the scan starts. */
export const SEARCH_MIN_INDEXED_LENGTH = 3;
const SEARCH_PAGE_SIZE = 30;

/**
 * Searches every channel this reader can actually read.
 *
 * The visibility rule is membership — not the looser rule the sidebar uses. A
 * public channel you have not joined lists its name but returns no messages on
 * open, so surfacing its contents through search would be a way around that.
 */
export async function searchMessages(
  env: Env,
  user: AuthUser,
  options: {
    query: string;
    channelId?: string;
    senderType?: "user" | "agent";
    before?: number;
    indexed: boolean;
  },
): Promise<{ hits: SearchHit[]; hasMore: boolean; mode: "index" | "scan" }> {
  const query = options.query.trim();
  if (!query) return { hits: [], hasMore: false, mode: options.indexed ? "index" : "scan" };
  const indexed = options.indexed && query.length >= SEARCH_MIN_INDEXED_LENGTH;
  const binds: unknown[] = [];
  const where: string[] = [];
  if (indexed) {
    // Quoted as a phrase so the whole string is matched literally: chat search
    // is a substring question, not a boolean-operator one, and an unescaped
    // query would otherwise let FTS5 syntax leak in from the search box.
    binds.push(`"${query.replace(/"/g, '""')}"`);
  } else {
    where.push("instr(lower(m.content),lower(?))>0");
    binds.push(query);
  }
  where.push("m.status NOT IN ('queued','streaming')");
  where.push(
    `(EXISTS(SELECT 1 FROM channel_members cm
       WHERE cm.channel_id=m.channel_id AND cm.user_id=?) OR ?='owner')`,
  );
  binds.push(user.id, user.role);
  if (options.channelId) {
    where.push("m.channel_id=?");
    binds.push(options.channelId);
  }
  if (options.senderType) {
    where.push("m.sender_type=?");
    binds.push(options.senderType);
  }
  if (options.before) {
    where.push("m.id<?");
    binds.push(options.before);
  }
  binds.push(SEARCH_PAGE_SIZE + 1);
  const rows = await env.DB.prepare(
    `SELECT m.id,m.channel_id,m.thread_root_id,m.sender_type,m.content,m.created_at,
      c.name AS channel_name,u.username,a.name AS agent_name,a.handle AS agent_handle
     FROM ${indexed ? "messages_fts JOIN messages m ON m.id=messages_fts.rowid" : "messages m"}
     JOIN channels c ON c.id=m.channel_id AND c.archived_at IS NULL
     LEFT JOIN users u ON u.id=m.sender_user_id
     LEFT JOIN agents a ON a.id=m.sender_agent_id
     WHERE ${indexed ? "messages_fts MATCH ? AND " : ""}${where.join(" AND ")}
     ORDER BY m.id DESC LIMIT ?`,
  ).bind(...binds).all<{
    id: number;
    channel_id: string;
    thread_root_id: number | null;
    sender_type: "user" | "agent" | "system";
    content: string;
    created_at: string;
    channel_name: string;
    username: string | null;
    agent_name: string | null;
    agent_handle: string | null;
  }>();
  const hasMore = rows.results.length > SEARCH_PAGE_SIZE;
  return {
    hits: rows.results.slice(0, SEARCH_PAGE_SIZE).map((row) => ({
      messageId: row.id,
      channelId: row.channel_id,
      channelName: row.channel_name,
      threadRootId: row.thread_root_id,
      senderType: row.sender_type,
      senderName: row.sender_type === "user"
        ? row.username ?? "Former member"
        : row.sender_type === "agent"
          ? row.agent_name ?? "Agent"
          : "Team Agents",
      senderHandle: row.agent_handle,
      excerpt: searchExcerpt(row.content, query),
      createdAt: row.created_at,
    })),
    hasMore,
    mode: indexed ? "index" : "scan",
  };
}

const EXCERPT_RADIUS = 90;

/**
 * A window of the message around the first hit, so a match 4,000 characters
 * into an agent's report is visible in the result row instead of being cut off
 * by a plain head-truncation.
 */
export function searchExcerpt(content: string, query: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  const at = collapsed.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return collapsed.slice(0, EXCERPT_RADIUS * 2);
  const start = Math.max(0, at - EXCERPT_RADIUS);
  const end = Math.min(collapsed.length, at + query.length + EXCERPT_RADIUS);
  return `${start > 0 ? "…" : ""}${collapsed.slice(start, end)}${end < collapsed.length ? "…" : ""}`;
}

function mapMessage(
  row: MessageRow,
  reactions: Array<{ emoji: string; count: number; reacted: number }>,
  replyCount: number,
): PublicMessage {
  const senderId = row.sender_type === "user"
    ? row.sender_user_id
    : row.sender_type === "agent"
      ? row.sender_agent_id
      : null;
  const senderName = row.sender_type === "user"
    ? row.username ?? "Former member"
    : row.sender_type === "agent"
      ? row.agent_name ?? "Agent"
      : "Team Agents";
  return {
    id: row.id,
    clientMessageId: row.client_message_id,
    channelId: row.channel_id,
    threadRootId: row.thread_root_id,
    sender: {
      type: row.sender_type,
      id: senderId,
      name: senderName,
      ...(row.agent_handle ? { handle: row.agent_handle } : {}),
    },
    content: row.content,
    status: row.status,
    runId: row.run_id,
    runTriggeredByUserId: row.run_trigger_user_id,
    agentOwnerUserId: row.agent_owner_user_id,
    run: row.run_id && row.run_status
      ? {
        id: row.run_id,
        status: row.run_status,
        attempt: Number(row.run_attempt ?? 0),
        startedAt: row.run_started_at,
        progressText: row.run_progress_text,
        relayIndex: Number(row.run_relay_index ?? 0),
        relayTotal: Number(row.run_relay_total ?? 1),
      }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reactions: reactions.map((reaction) => ({
      emoji: reaction.emoji,
      count: Number(reaction.count),
      reacted: Boolean(reaction.reacted),
    })),
    replyCount: Number(replyCount),
  };
}
