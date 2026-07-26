import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  usernameNormalized: text("username_normalized").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  createdAt: text("created_at").notNull(),
  disabledAt: text("disabled_at"),
}, (table) => [
  uniqueIndex("users_username_normalized_unique").on(table.usernameNormalized),
]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("sessions_user_idx").on(table.userId),
  index("sessions_expiry_idx").on(table.expiresAt),
]);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: text("created_at").notNull(),
});

export const workspaceMembers = sqliteTable("workspace_members", {
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["owner", "member"] }).notNull(),
  joinedAt: text("joined_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.userId] }),
  index("workspace_members_user_idx").on(table.userId),
]);

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  topic: text("topic").notNull().default(""),
  isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  archivedAt: text("archived_at"),
}, (table) => [
  uniqueIndex("channels_workspace_slug_unique").on(table.workspaceId, table.slug),
  index("channels_workspace_idx").on(table.workspaceId),
]);

export const channelMembers = sqliteTable("channel_members", {
  channelId: text("channel_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["manager", "member"] }).notNull(),
  joinedAt: text("joined_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.userId] }),
  index("channel_members_user_idx").on(table.userId),
]);

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  handle: text("handle").notNull(),
  description: text("description").notNull().default(""),
  rpcUrl: text("rpc_url").notNull(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  tokenIv: text("token_iv").notNull(),
  historyCount: integer("history_count").notNull().default(20),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  configVersion: integer("config_version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("agents_workspace_handle_unique").on(table.workspaceId, table.handle),
  index("agents_owner_idx").on(table.ownerUserId),
]);

export const channelAgents = sqliteTable("channel_agents", {
  channelId: text("channel_id").notNull(),
  agentId: text("agent_id").notNull(),
  addedBy: text("added_by").notNull(),
  joinedAt: text("joined_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.agentId] }),
  index("channel_agents_agent_idx").on(table.agentId),
]);

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientMessageId: text("client_message_id"),
  channelId: text("channel_id").notNull(),
  threadRootId: integer("thread_root_id"),
  senderType: text("sender_type", { enum: ["user", "agent", "system"] }).notNull(),
  senderUserId: text("sender_user_id"),
  senderAgentId: text("sender_agent_id"),
  content: text("content").notNull(),
  status: text("status", { enum: ["sent", "queued", "streaming", "input-required", "failed", "canceled"] }).notNull().default("sent"),
  runId: text("run_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("messages_channel_client_unique").on(table.channelId, table.clientMessageId),
  index("messages_channel_id_idx").on(table.channelId, table.id),
  index("messages_thread_idx").on(table.threadRootId, table.id),
]);

export const messageMentions = sqliteTable("message_mentions", {
  messageId: integer("message_id").notNull(),
  kind: text("kind", { enum: ["user", "agent"] }).notNull(),
  targetId: text("target_id").notNull(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.kind, table.targetId] }),
]);

export const reactions = sqliteTable("reactions", {
  messageId: integer("message_id").notNull(),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.messageId, table.userId, table.emoji] }),
]);

export const readCursors = sqliteTable("read_cursors", {
  channelId: text("channel_id").notNull(),
  userId: text("user_id").notNull(),
  lastMessageId: integer("last_message_id").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.userId] }),
]);

export const channelEvents = sqliteTable("channel_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  channelId: text("channel_id").notNull(),
  kind: text("kind").notNull(),
  dataJson: text("data_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("channel_events_channel_idx").on(table.channelId, table.id),
]);

export const agentConversations = sqliteTable("agent_conversations", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  channelId: text("channel_id").notNull(),
  threadKey: text("thread_key").notNull(),
  contextId: text("context_id"),
  activeTaskId: text("active_task_id"),
  configVersion: integer("config_version").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("agent_conversations_scope_unique").on(table.agentId, table.channelId, table.threadKey),
]);

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  channelId: text("channel_id").notNull(),
  threadRootId: integer("thread_root_id"),
  triggerMessageId: integer("trigger_message_id").notNull(),
  responseMessageId: integer("response_message_id").notNull(),
  status: text("status", { enum: ["queued", "running", "input-required", "completed", "failed", "canceled"] }).notNull(),
  remoteTaskId: text("remote_task_id"),
  remoteContextId: text("remote_context_id"),
  lastError: text("last_error"),
  attempt: integer("attempt").notNull().default(0),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("agent_runs_trigger_agent_unique").on(table.triggerMessageId, table.agentId),
  index("agent_runs_conversation_idx").on(table.agentId, table.channelId, table.threadRootId, table.createdAt),
]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  windowStartedAt: text("window_started_at").notNull(),
  count: integer("count").notNull(),
  blockedUntil: text("blocked_until"),
});
