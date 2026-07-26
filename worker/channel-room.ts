import { DurableObject } from "cloudflare:workers";
import type { ChannelEvent, Env } from "./types";

interface SocketAttachment {
  channelId: string;
  userId: string;
  connectedAt: string;
}

export class ChannelRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") return this.openSocket(request, url);
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const event = await request.json() as ChannelEvent;
      this.broadcast(event);
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  }

  private async openSocket(request: Request, url: URL): Promise<Response> {
    if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const channelId = request.headers.get("x-team-agents-channel-id");
    const userId = request.headers.get("x-team-agents-user-id");
    if (!channelId || !userId) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      channelId,
      userId,
      connectedAt: new Date().toISOString(),
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`channel:${channelId}`, `user:${userId}`]);

    const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
    const missed = await this.env.DB.prepare(
      `SELECT id,channel_id,kind,data_json
       FROM channel_events
       WHERE channel_id=? AND id>?
       ORDER BY id ASC LIMIT 200`,
    ).bind(channelId, after).all<{
      id: number;
      channel_id: string;
      kind: ChannelEvent["kind"];
      data_json: string;
    }>();
    for (const row of missed.results) {
      server.send(JSON.stringify({
        eventId: row.id,
        channelId: row.channel_id,
        kind: row.kind,
        data: JSON.parse(row.data_json),
      } satisfies ChannelEvent));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(event: ChannelEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets(`channel:${event.channelId}`)) {
      try {
        socket.send(payload);
      } catch {
        try {
          socket.close(1011, "Delivery failed");
        } catch {
          // The socket is already gone.
        }
      }
    }
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    if (message === "ping") ws.send("pong");
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Close is idempotent in the Workers runtime.
    }
  }
}
