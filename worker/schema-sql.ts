export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    disabled_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','member')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    is_private INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    archived_at TEXT,
    UNIQUE(workspace_id, slug)
  )`,
  `CREATE INDEX IF NOT EXISTS channels_workspace_idx ON channels(workspace_id)`,
  `CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('manager','member')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY(channel_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS channel_members_user_idx ON channel_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    handle TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    rpc_url TEXT NOT NULL,
    token_ciphertext TEXT NOT NULL,
    token_iv TEXT NOT NULL,
    history_count INTEGER NOT NULL DEFAULT 20,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workspace_id, handle)
  )`,
  `CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents(owner_user_id)`,
  `CREATE TABLE IF NOT EXISTS channel_agents (
    channel_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    added_by TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY(channel_id, agent_id)
  )`,
  `CREATE INDEX IF NOT EXISTS channel_agents_agent_idx ON channel_agents(agent_id)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_message_id TEXT,
    channel_id TEXT NOT NULL,
    thread_root_id INTEGER,
    sender_type TEXT NOT NULL CHECK(sender_type IN ('user','agent','system')),
    sender_user_id TEXT,
    sender_agent_id TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','queued','streaming','input-required','failed','canceled')),
    run_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(channel_id, client_message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS messages_channel_id_idx ON messages(channel_id, id)`,
  `CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages(thread_root_id, id)`,
  `CREATE TABLE IF NOT EXISTS message_mentions (
    message_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('user','agent')),
    target_id TEXT NOT NULL,
    PRIMARY KEY(message_id, kind, target_id)
  )`,
  `CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(message_id, user_id, emoji)
  )`,
  `CREATE TABLE IF NOT EXISTS read_cursors (
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    last_message_id INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(channel_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS channel_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS channel_events_channel_idx ON channel_events(channel_id, id)`,
  `CREATE TABLE IF NOT EXISTS agent_conversations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    thread_key TEXT NOT NULL,
    context_id TEXT,
    active_task_id TEXT,
    config_version INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(agent_id, channel_id, thread_key)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    thread_root_id INTEGER,
    trigger_message_id INTEGER NOT NULL,
    response_message_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','input-required','completed','failed','canceled')),
    remote_task_id TEXT,
    remote_context_id TEXT,
    last_error TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    progress_text TEXT,
    relay_group_id TEXT,
    relay_index INTEGER NOT NULL DEFAULT 0,
    relay_total INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE(trigger_message_id, agent_id)
  )`,
  `CREATE INDEX IF NOT EXISTS agent_runs_conversation_idx
    ON agent_runs(agent_id, channel_id, thread_root_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS agent_runs_status_idx ON agent_runs(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    count INTEGER NOT NULL,
    blocked_until TEXT
  )`,
  // Holds an in-flight Manyfold A2A connect handshake. The device code is the
  // only credential that can redeem the minted agent tokens, so it is stored
  // encrypted and never leaves the worker.
  `CREATE TABLE IF NOT EXISTS manyfold_connect_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    user_code TEXT NOT NULL,
    auth_url TEXT NOT NULL,
    device_code_ciphertext TEXT NOT NULL,
    device_code_iv TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','exchanged','expired','denied')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS manyfold_connect_user_idx
    ON manyfold_connect_sessions(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS manyfold_connect_expiry_idx
    ON manyfold_connect_sessions(expires_at)`,
] as const;

/**
 * Columns added after a table shipped. `CREATE TABLE IF NOT EXISTS` is a no-op
 * on a database that already has the table, so a new column would never reach
 * production without this pass. SQLite has no `ADD COLUMN IF NOT EXISTS`, hence
 * the `PRAGMA table_info` check rather than a swallowed error.
 */
export const ADDED_COLUMNS = [
  { table: "agent_runs", column: "progress_text", ddl: "TEXT" },
  { table: "agent_runs", column: "relay_group_id", ddl: "TEXT" },
  { table: "agent_runs", column: "relay_index", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "agent_runs", column: "relay_total", ddl: "INTEGER NOT NULL DEFAULT 1" },
] as const;

/**
 * Indexes over columns from `ADDED_COLUMNS`. They cannot live in
 * `SCHEMA_STATEMENTS`: on an already-deployed database that batch runs before
 * the column exists, and `CREATE INDEX` on a missing column is a hard error.
 */
const POST_COLUMN_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS agent_runs_relay_idx
    ON agent_runs(relay_group_id, relay_index)`,
] as const;

async function addMissingColumns(db: D1Database): Promise<void> {
  const tables = [...new Set(ADDED_COLUMNS.map((entry) => entry.table))];
  const present = new Map<string, Set<string>>();
  for (const table of tables) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    present.set(table, new Set(info.results.map((row) => row.name)));
  }
  for (const entry of ADDED_COLUMNS) {
    if (present.get(entry.table)?.has(entry.column)) continue;
    await db.prepare(
      `ALTER TABLE ${entry.table} ADD COLUMN ${entry.column} ${entry.ddl}`,
    ).run();
  }
}

let initialized: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const statements = SCHEMA_STATEMENTS.map((sql) => db.prepare(sql));
      for (let index = 0; index < statements.length; index += 50) {
        await db.batch(statements.slice(index, index + 50));
      }
      await addMissingColumns(db);
      await db.batch(POST_COLUMN_STATEMENTS.map((sql) => db.prepare(sql)));
    })().catch((error) => {
      initialized = null;
      throw error;
    });
  }
  return initialized;
}

