export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CHANNEL_ROOMS: DurableObjectNamespace<import("./channel-room").ChannelRoom>;
  AGENT_TASKS: Queue<AgentQueueMessage>;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  ENVIRONMENT?: string;
  CREDENTIALS_ENCRYPTION_KEY?: string;
  AUTH_HMAC_KEY?: string;
  /** Manyfold API origin for the A2A connect flow. Defaults to production. */
  MANYFOLD_API_BASE_URL?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: "owner" | "member";
}

export interface AgentQueueMessage {
  kind: "start" | "resume" | "cancel";
  runId: string;
  queuedAt: string;
}

export type ChannelEventKind =
  | "message.created"
  | "message.updated"
  | "reaction.updated"
  | "member.updated"
  | "agent.run.updated";

export interface ChannelEvent {
  eventId: number;
  channelId: string;
  kind: ChannelEventKind;
  data: unknown;
}

export interface AgentInput {
  name: string;
  handle: string;
  description?: string;
  rpcUrl: string;
  /**
   * Agent Card / A2A base / RPC URL to discover from. When present, `name`,
   * `description` and `rpcUrl` are filled from the card unless explicitly set.
   */
  cardUrl?: string;
  bearerToken?: string;
  historyCount: number;
}

/**
 * How several agents mentioned in one message answer.
 * `parallel` — independent runs, none sees the others (the historical default).
 * `relay` — one at a time, each handed the answers of the agents before it.
 */
export type AgentRunMode = "parallel" | "relay";

export interface CreateMessageInput {
  clientMessageId: string;
  content: string;
  threadRootId?: number;
  mentions: Array<{ kind: "user" | "agent"; id: string }>;
  agentMode?: AgentRunMode;
}

/** Run state carried alongside an agent message so the UI can show the wait. */
export interface PublicRun {
  id: string;
  status: "queued" | "running" | "input-required" | "completed" | "failed" | "canceled";
  attempt: number;
  startedAt: string | null;
  progressText: string | null;
  relayIndex: number;
  relayTotal: number;
}

/** One entry of the cross-channel run tray. */
export interface UserRunSummary extends PublicRun {
  channelId: string;
  channelName: string;
  agentId: string;
  agentName: string;
  agentHandle: string;
  responseMessageId: number;
  threadRootId: number | null;
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
}

