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
  bearerToken?: string;
  historyCount: number;
}

export interface CreateMessageInput {
  clientMessageId: string;
  content: string;
  threadRootId?: number;
  mentions: Array<{ kind: "user" | "agent"; id: string }>;
}

