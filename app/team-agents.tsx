"use client";

import {
  AtSign,
  Bot,
  Check,
  ChevronDown,
  CirclePlus,
  Download,
  Globe2,
  Hash,
  Languages,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Square,
  Users,
  X,
  Zap,
} from "lucide-react";
import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Locale = "zh" | "en";
type User = { id: string; username: string; role: "owner" | "member" };
type Channel = {
  id: string;
  name: string;
  slug: string;
  topic: string;
  isPrivate: boolean;
  joined: boolean;
  role: "manager" | "member" | null;
  unread: boolean;
  latestMessageId: number;
  memberCount: number;
  agentCount: number;
};
type Agent = {
  id: string;
  ownerUserId: string;
  ownerUsername?: string;
  name: string;
  handle: string;
  description: string;
  rpcUrl: string;
  historyCount: number;
  enabled: boolean;
  tokenConfigured: boolean;
  channelCount: number;
};
type DiscoveredCard = {
  cardUrl: string;
  name: string;
  description: string;
  rpcUrl: string;
  protocolVersion: string;
  streaming: boolean;
  skills: string[];
  suggestedHandle: string;
};
type RosterUser = { id: string; username: string; role: "manager" | "member"; kind: "user" };
type RosterAgent = {
  id: string;
  name: string;
  handle: string;
  description: string;
  ownerUserId: string;
  ownerUsername: string;
  joinedAt: string;
  kind: "agent";
};
type Message = {
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
  status: "sent" | "queued" | "streaming" | "input-required" | "failed" | "canceled";
  runId: string | null;
  runTriggeredByUserId: string | null;
  agentOwnerUserId: string | null;
  createdAt: string;
  updatedAt: string;
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
  replyCount: number;
};
type Bootstrap = {
  authenticated: boolean;
  user?: User;
  workspace?: { id: string; name: string };
  channels?: Channel[];
  agents?: Agent[];
};
type Modal = "channel" | "people" | "agents" | "account" | null;

const copy = {
  zh: {
    welcome: "欢迎回到协作现场",
    authSub: "让人类与 A2A Agent 在同一个频道里一起推进工作。",
    login: "登录",
    register: "创建账号",
    username: "用户名",
    usernameHint: "3–32 个字符；支持文字、数字、点、下划线和连字符。",
    password: "密码",
    noAccount: "还没有账号？",
    haveAccount: "已经有账号？",
    signingIn: "正在进入工作区…",
    channels: "频道",
    addChannel: "新建频道",
    threads: "讨论串",
    agents: "Agent 管理",
    settings: "账号设置",
    logout: "退出登录",
    members: "成员",
    channelAgents: "频道 Agent",
    joined: "已加入",
    join: "加入频道",
    newChannel: "创建频道",
    channelName: "频道名称",
    channelTopic: "频道主题",
    privateChannel: "设为私密频道",
    privateHint: "只有受邀成员可以查看。",
    create: "创建",
    cancel: "取消",
    inviteMember: "邀请成员",
    inviteByUsername: "输入用户名",
    invite: "邀请",
    messagePlaceholder: "发消息到",
    threadPlaceholder: "回复这个讨论串",
    reply: "回复",
    send: "发送",
    noMessages: "这里还很安静。发出第一条消息，或 @ 一个 Agent 开始协作。",
    addAgent: "连接新 Agent",
    agentName: "Agent 名称",
    handle: "提及名称",
    rpcUrl: "A2A 调用地址",
    cardUrl: "Agent Card 或 RPC 地址",
    discover: "读取 Agent Card",
    discovering: "正在读取…",
    discoverHint: "粘贴 Agent Card、A2A base 或 RPC 地址，下面的字段会自动填好。",
    discoverFailed: "没读到 Agent Card，请手动填写下面的字段。",
    discoveredFrom: "已从 Agent Card 读取",
    streamingOn: "支持流式",
    streamingOff: "不支持流式",
    details: "名称与职责（可改）",
    editAgent: "编辑",
    saveChanges: "保存修改",
    tokenKeep: "留空表示沿用当前 token",
    memoryResetNote: "端点或 token 变了，保存后各频道的 A2A 上下文会重置。",
    reenableNote: "这个 Agent 已停用，保存后会重新启用。",
    token: "Bearer token",
    history: "发送历史消息数",
    historyNote: "同时会延续 A2A context，Agent 可能记得更早的对话。",
    description: "职责说明",
    saveTest: "保存并测试连接",
    testing: "正在建立 A2A 流式连接…",
    addToChannel: "加入当前频道",
    removeFromChannel: "移出当前频道",
    resetMemory: "重置当前频道记忆",
    ownedBy: "所有者",
    disabled: "已停用",
    remove: "停用",
    changePassword: "修改密码",
    currentPassword: "当前密码",
    newPassword: "新密码",
    updatePassword: "更新密码",
    thinking: "Agent 正在处理",
    inputRequired: "Agent 需要更多信息",
    failed: "Agent 调用失败",
    canceled: "已停止",
    stop: "停止",
    retry: "重试",
    connectionTip: "仅支持可公开访问的 HTTPS A2A v0.3 streaming endpoint。",
    language: "English",
    public: "公开",
    private: "私密",
    channelInfo: "频道信息",
    you: "你",
    mentionHint: "输入 @ 可选择成员或 Agent",
    openSidebar: "打开频道列表",
    close: "关闭",
    searchChannels: "筛选频道",
    saved: "已保存",
  },
  en: {
    welcome: "Welcome back to the work",
    authSub: "Bring people and A2A agents together in the same channel.",
    login: "Sign in",
    register: "Create account",
    username: "Username",
    usernameHint: "3–32 characters: letters, numbers, dots, underscores, or hyphens.",
    password: "Password",
    noAccount: "New to Team Agents?",
    haveAccount: "Already have an account?",
    signingIn: "Opening your workspace…",
    channels: "Channels",
    addChannel: "New channel",
    threads: "Threads",
    agents: "Manage agents",
    settings: "Account settings",
    logout: "Sign out",
    members: "Members",
    channelAgents: "Channel agents",
    joined: "Joined",
    join: "Join channel",
    newChannel: "Create a channel",
    channelName: "Channel name",
    channelTopic: "Channel topic",
    privateChannel: "Make this channel private",
    privateHint: "Only invited members can see it.",
    create: "Create",
    cancel: "Cancel",
    inviteMember: "Invite a member",
    inviteByUsername: "Enter a username",
    invite: "Invite",
    messagePlaceholder: "Message",
    threadPlaceholder: "Reply to this thread",
    reply: "Reply",
    send: "Send",
    noMessages: "It’s quiet here. Send the first message or @mention an agent to get moving.",
    addAgent: "Connect a new agent",
    agentName: "Agent name",
    handle: "Mention handle",
    rpcUrl: "A2A RPC URL",
    cardUrl: "Agent card or RPC URL",
    discover: "Read agent card",
    discovering: "Reading…",
    discoverHint: "Paste an agent card, A2A base, or RPC URL — the fields below fill themselves.",
    discoverFailed: "No agent card found — fill the fields below manually.",
    discoveredFrom: "Filled from the agent card",
    streamingOn: "Streaming",
    streamingOff: "No streaming",
    details: "Name and role (editable)",
    editAgent: "Edit",
    saveChanges: "Save changes",
    tokenKeep: "Leave blank to keep the current token",
    memoryResetNote: "Endpoint or token changed — A2A context resets in every channel on save.",
    reenableNote: "This agent is disabled; saving re-enables it.",
    token: "Bearer token",
    history: "History messages sent",
    historyNote: "A2A context also continues, so the agent may remember earlier conversation.",
    description: "What this agent does",
    saveTest: "Save & test connection",
    testing: "Opening an A2A streaming connection…",
    addToChannel: "Add to this channel",
    removeFromChannel: "Remove from this channel",
    resetMemory: "Reset channel memory",
    ownedBy: "Owned by",
    disabled: "Disabled",
    remove: "Disable",
    changePassword: "Change password",
    currentPassword: "Current password",
    newPassword: "New password",
    updatePassword: "Update password",
    thinking: "Agent is working",
    inputRequired: "Agent needs more information",
    failed: "Agent call failed",
    canceled: "Stopped",
    stop: "Stop",
    retry: "Retry",
    connectionTip: "Requires a publicly reachable HTTPS A2A v0.3 streaming endpoint.",
    language: "中文",
    public: "Public",
    private: "Private",
    channelInfo: "Channel details",
    you: "you",
    mentionHint: "Type @ to mention a person or agent",
    openSidebar: "Open channel list",
    close: "Close",
    searchChannels: "Filter channels",
    saved: "Saved",
  },
} as const;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => ({})) as T & {
    error?: { code: string; message: string };
  };
  if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
  return data;
}

function avatarHue(value: string): number {
  return [...value].reduce((sum, character) => sum + character.charCodeAt(0) * 13, 0) % 360;
}

function initials(value: string): string {
  return value.trim().split(/\s+/).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
}

function upsertMessage(list: Message[], message: Message): Message[] {
  const index = list.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...list, message].sort((left, right) => left.id - right.id);
  const copyList = [...list];
  copyList[index] = message;
  return copyList;
}

export function TeamAgentsApp() {
  const [locale, setLocale] = useState<Locale>("zh");
  const t = copy[locale];
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadRoot, setThreadRoot] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [rosterUsers, setRosterUsers] = useState<RosterUser[]>([]);
  const [rosterAgents, setRosterAgents] = useState<RosterAgent[]>([]);
  const [requiresJoin, setRequiresJoin] = useState(false);
  const [loadingChannel, setLoadingChannel] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [channelFilter, setChannelFilter] = useState("");
  const eventCursor = useRef(0);

  const refreshBootstrap = useCallback(async () => {
    const data = await api<Bootstrap>("/api/bootstrap");
    setBoot(data);
    if (data.authenticated && data.channels?.length) {
      setSelectedChannelId((current) => current || data.channels?.find((channel) => channel.joined)?.id || data.channels?.[0].id || "");
    }
    return data;
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("team-agents-locale");
    if (stored === "zh" || stored === "en") {
      queueMicrotask(() => setLocale(stored));
    }
    queueMicrotask(() => {
      refreshBootstrap().catch((cause) => setError(String(cause.message ?? cause)));
    });
  }, [refreshBootstrap]);

  const toggleLocale = () => {
    const next = locale === "zh" ? "en" : "zh";
    setLocale(next);
    window.localStorage.setItem("team-agents-locale", next);
  };

  const selectedChannel = boot?.channels?.find((channel) => channel.id === selectedChannelId) ?? null;

  const loadChannel = useCallback(async (channelId: string) => {
    if (!channelId || !boot?.authenticated) return;
    setLoadingChannel(true);
    setError("");
    try {
      const [messageData, rosterData] = await Promise.all([
        api<{ messages: Message[]; requiresJoin: boolean }>(`/api/channels/${encodeURIComponent(channelId)}/messages`),
        api<{ members: RosterUser[]; agents: RosterAgent[] }>(`/api/channels/${encodeURIComponent(channelId)}/roster`),
      ]);
      setMessages(messageData.messages);
      setRequiresJoin(messageData.requiresJoin);
      setRosterUsers(rosterData.members);
      setRosterAgents(rosterData.agents);
      setThreadRoot(null);
      setThreadMessages([]);
      const latest = messageData.messages.at(-1)?.id ?? 0;
      if (latest) {
        await api(`/api/channels/${encodeURIComponent(channelId)}/read`, {
          method: "POST",
          body: JSON.stringify({ messageId: latest }),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingChannel(false);
    }
  }, [boot?.authenticated]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadChannel(selectedChannelId);
    });
    return () => {
      active = false;
    };
  }, [selectedChannelId, loadChannel]);

  useEffect(() => {
    if (!selectedChannelId || requiresJoin || !boot?.authenticated) return;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let closed = false;
    let attempt = 0;
    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/channels/${encodeURIComponent(selectedChannelId)}/stream?after=${eventCursor.current}`,
      );
      socket.onopen = () => { attempt = 0; };
      socket.onmessage = (event) => {
        if (event.data === "pong") return;
        try {
          const payload = JSON.parse(String(event.data)) as {
            eventId: number;
            kind: string;
            data: Message | { agentId?: string };
          };
          eventCursor.current = Math.max(eventCursor.current, payload.eventId);
          if (["message.created", "message.updated", "reaction.updated"].includes(payload.kind)) {
            const message = payload.data as Message;
            if (message.threadRootId) {
              setThreadMessages((current) => upsertMessage(current, message));
              setMessages((current) => current.map((candidate) =>
                candidate.id === message.threadRootId
                  ? { ...candidate, replyCount: Math.max(candidate.replyCount, current.filter((item) => item.threadRootId === message.threadRootId).length) }
                  : candidate));
            } else {
              setMessages((current) => upsertMessage(current, message));
            }
          }
          if (payload.kind === "member.updated") {
            loadChannel(selectedChannelId);
            refreshBootstrap();
          }
        } catch {
          // Ignore non-JSON keepalive frames.
        }
      };
      socket.onclose = () => {
        if (closed) return;
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt));
      };
    };
    connect();
    const ping = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
    }, 25_000);
    return () => {
      closed = true;
      window.clearInterval(ping);
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [selectedChannelId, requiresJoin, boot?.authenticated, loadChannel, refreshBootstrap]);

  const openThread = async (message: Message) => {
    setThreadRoot(message);
    try {
      const data = await api<{ messages: Message[]; root: Message }>(
        `/api/channels/${encodeURIComponent(message.channelId)}/messages?thread=${message.id}`,
      );
      setThreadMessages(data.messages);
      setThreadRoot(data.root);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (!boot) return <LoadingScreen />;
  if (!boot.authenticated || !boot.user) {
    return (
      <AuthScreen
        locale={locale}
        onToggleLocale={toggleLocale}
        onAuthenticated={refreshBootstrap}
      />
    );
  }

  const filteredChannels = (boot.channels ?? []).filter((channel) =>
    channel.name.toLowerCase().includes(channelFilter.toLowerCase()));

  return (
    <main className="workspace-shell">
      <button
        className="mobile-menu-button"
        aria-label={t.openSidebar}
        onClick={() => setSidebarOpen(true)}
      >
        <Menu size={20} />
      </button>
      {sidebarOpen && <button className="mobile-scrim" aria-label={t.close} onClick={() => setSidebarOpen(false)} />}

      <aside className={`workspace-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="workspace-switcher">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <strong>Team Agents</strong>
            <span>Human + A2A workspace</span>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        <nav className="primary-nav">
          <button className="nav-row">
            <MessageCircle size={17} />
            <span>{t.threads}</span>
          </button>
          <button className="nav-row" onClick={() => setModal("agents")}>
            <Bot size={17} />
            <span>{t.agents}</span>
            <span className="nav-count">{rosterAgents.length}</span>
          </button>
        </nav>

        <div className="channel-section">
          <div className="section-heading">
            <span>{t.channels}</span>
            <button className="tiny-icon" aria-label={t.addChannel} onClick={() => setModal("channel")}>
              <Plus size={16} />
            </button>
          </div>
          <label className="channel-filter">
            <Search size={14} />
            <input
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              placeholder={t.searchChannels}
            />
          </label>
          <div className="channel-list">
            {filteredChannels.map((channel) => (
              <button
                key={channel.id}
                className={`channel-row ${channel.id === selectedChannelId ? "active" : ""}`}
                onClick={() => {
                  setSelectedChannelId(channel.id);
                  setSidebarOpen(false);
                }}
              >
                {channel.isPrivate ? <LockKeyhole size={14} /> : <Hash size={15} />}
                <span>{channel.name}</span>
                {channel.unread && <i className="unread-dot" />}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <button className="profile-button" onClick={() => setModal("account")}>
            <Avatar name={boot.user.username} />
            <span>
              <strong>{boot.user.username}</strong>
              <small>{boot.user.role === "owner" ? "Workspace owner" : "Member"}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          <div className="footer-actions">
            <button className="icon-button" onClick={toggleLocale} title={t.language}>
              <Languages size={17} />
            </button>
            <button className="icon-button" onClick={() => setModal("agents")} title={t.agents}>
              <Settings size={17} />
            </button>
          </div>
        </div>
      </aside>

      <section className="conversation-pane">
        {selectedChannel ? (
          <>
            <header className="channel-header">
              <div>
                <div className="channel-title">
                  {selectedChannel.isPrivate ? <LockKeyhole size={17} /> : <Hash size={19} />}
                  <h1>{selectedChannel.name}</h1>
                  <span className="privacy-chip">
                    {selectedChannel.isPrivate ? t.private : t.public}
                  </span>
                </div>
                <p>{selectedChannel.topic || "A shared space for focused collaboration."}</p>
              </div>
              <div className="channel-actions">
                <button className="member-pill" onClick={() => setModal("people")}>
                  <Users size={16} />
                  <span>{selectedChannel.memberCount}</span>
                </button>
                <button className="member-pill agent-pill" onClick={() => setModal("agents")}>
                  <Bot size={16} />
                  <span>{selectedChannel.agentCount}</span>
                </button>
                <button className="icon-button"><MoreHorizontal size={19} /></button>
              </div>
            </header>

            {error && (
              <div className="error-banner">
                <span>{error}</span>
                <button onClick={() => setError("")}><X size={15} /></button>
              </div>
            )}

            {requiresJoin ? (
              <JoinChannel
                channel={selectedChannel}
                locale={locale}
                onJoin={async () => {
                  await api(`/api/channels/${encodeURIComponent(selectedChannel.id)}/join`, { method: "POST" });
                  await refreshBootstrap();
                  await loadChannel(selectedChannel.id);
                }}
              />
            ) : (
              <>
                <div className="message-scroll">
                  <ChannelIntro channel={selectedChannel} locale={locale} />
                  {loadingChannel ? (
                    <div className="inline-loader"><RefreshCw className="spin" size={18} /> Loading channel…</div>
                  ) : messages.length ? (
                    messages.map((message) => (
                      <MessageCard
                        key={message.id}
                        message={message}
                        currentUser={boot.user!}
                        locale={locale}
                        onThread={() => openThread(message)}
                        onReact={(emoji) => reactToMessage(message.id, emoji, selectedChannel.id, setMessages, setError)}
                        onRunAction={(action) => runAction(message, action, setError)}
                      />
                    ))
                  ) : (
                    <div className="empty-messages">
                      <MessageCircle size={30} />
                      <p>{t.noMessages}</p>
                    </div>
                  )}
                </div>
                <Composer
                  channel={selectedChannel}
                  locale={locale}
                  rosterUsers={rosterUsers}
                  rosterAgents={rosterAgents}
                  onSent={(message) => setMessages((current) => upsertMessage(current, message))}
                />
              </>
            )}
          </>
        ) : (
          <div className="blank-pane">
            <Sparkles size={32} />
            <h2>Team Agents</h2>
            <p>Create or choose a channel to start collaborating.</p>
          </div>
        )}
      </section>

      {threadRoot && selectedChannel && (
        <aside className="thread-pane">
          <header className="thread-header">
            <div>
              <strong>{t.threads}</strong>
              <span>#{selectedChannel.name}</span>
            </div>
            <button className="icon-button" onClick={() => setThreadRoot(null)} aria-label={t.close}>
              <X size={18} />
            </button>
          </header>
          <div className="thread-scroll">
            <MessageCard
              message={threadRoot}
              currentUser={boot.user}
              locale={locale}
              isThreadRoot
              onThread={() => undefined}
              onReact={(emoji) => reactToMessage(threadRoot.id, emoji, selectedChannel.id, setMessages, setError)}
              onRunAction={(action) => runAction(threadRoot, action, setError)}
            />
            <div className="thread-divider">
              <span>{threadMessages.length} {locale === "zh" ? "条回复" : "replies"}</span>
            </div>
            {threadMessages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                currentUser={boot.user!}
                locale={locale}
                compact
                onThread={() => undefined}
                onReact={(emoji) => reactToMessage(message.id, emoji, selectedChannel.id, setThreadMessages, setError)}
                onRunAction={(action) => runAction(message, action, setError)}
              />
            ))}
          </div>
          <Composer
            channel={selectedChannel}
            locale={locale}
            rosterUsers={rosterUsers}
            rosterAgents={rosterAgents}
            threadRootId={threadRoot.id}
            onSent={(message) => setThreadMessages((current) => upsertMessage(current, message))}
          />
        </aside>
      )}

      {modal === "channel" && (
        <ChannelModal
          locale={locale}
          onClose={() => setModal(null)}
          onCreated={async (channel) => {
            await refreshBootstrap();
            setSelectedChannelId(channel.id);
            setModal(null);
          }}
        />
      )}
      {modal === "people" && selectedChannel && (
        <PeopleModal
          locale={locale}
          channel={selectedChannel}
          users={rosterUsers}
          agents={rosterAgents}
          currentUser={boot.user}
          onClose={() => setModal(null)}
          onInvited={() => loadChannel(selectedChannel.id)}
        />
      )}
      {modal === "agents" && (
        <AgentsModal
          locale={locale}
          currentUser={boot.user}
          agents={boot.agents ?? []}
          channel={selectedChannel}
          channelAgents={rosterAgents}
          onClose={() => setModal(null)}
          onChanged={async () => {
            await refreshBootstrap();
            if (selectedChannel) await loadChannel(selectedChannel.id);
          }}
        />
      )}
      {modal === "account" && (
        <AccountModal
          locale={locale}
          user={boot.user}
          onClose={() => setModal(null)}
          onLogout={async () => {
            await api("/api/auth/logout", { method: "POST" });
            setBoot({ authenticated: false });
            setModal(null);
          }}
        />
      )}
    </main>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="brand-orbit"><Sparkles size={24} /></div>
      <strong>Team Agents</strong>
      <span>Preparing your workspace…</span>
    </div>
  );
}

function AuthScreen(props: {
  locale: Locale;
  onToggleLocale: () => void;
  onAuthenticated: () => Promise<Bootstrap>;
}) {
  const { locale, onToggleLocale, onAuthenticated } = props;
  const t = copy[locale];
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-brand">
          <div className="brand-mark"><Sparkles size={19} /></div>
          <strong>Team Agents</strong>
        </div>
        <div className="story-copy">
          <span className="eyebrow"><Zap size={14} /> Human + agent collaboration</span>
          <h1>{t.welcome}</h1>
          <p>{t.authSub}</p>
        </div>
        <div className="story-channel">
          <div className="story-channel-head">
            <span><Hash size={16} /> product-launch</span>
            <span>8 people · 3 agents</span>
          </div>
          <div className="story-message">
            <Avatar name="Mira" />
            <div><strong>Mira</strong><p>@researcher summarize the customer feedback and suggest our top three actions.</p></div>
          </div>
          <div className="story-message agent-story">
            <Avatar name="Researcher" agent />
            <div>
              <strong>Researcher <em>AGENT</em></strong>
              <p>I found three repeated themes. Here’s the decision-ready version…</p>
              <span className="stream-line" />
            </div>
          </div>
        </div>
      </section>
      <section className="auth-form-wrap">
        <button className="language-button" onClick={onToggleLocale}>
          <Globe2 size={16} /> {t.language}
        </button>
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card-icon"><AtSign size={21} /></div>
          <h2>{mode === "login" ? t.login : t.register}</h2>
          <p>{mode === "login" ? t.noAccount : t.haveAccount}{" "}
            <button type="button" className="text-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? t.register : t.login}
            </button>
          </p>
          <label>
            <span>{t.username}</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={32}
              aria-describedby="auth-username-hint"
              spellCheck={false}
              required
            />
            <small id="auth-username-hint" className="field-hint">{t.usernameHint}</small>
          </label>
          <label>
            <span>{t.password}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button auth-submit" disabled={busy}>
            {busy ? <><RefreshCw className="spin" size={17} /> {t.signingIn}</> : mode === "login" ? t.login : t.register}
          </button>
          <small className="auth-note">
            <ShieldCheck size={14} /> Passwords are securely hashed. Agent tokens stay encrypted.
          </small>
        </form>
      </section>
    </main>
  );
}

function Avatar({ name, agent = false }: { name: string; agent?: boolean }) {
  return (
    <span
      className={`avatar ${agent ? "agent-avatar" : ""}`}
      style={{ "--avatar-hue": avatarHue(name) } as React.CSSProperties}
    >
      {agent ? <Bot size={16} /> : initials(name)}
    </span>
  );
}

function ChannelIntro({ channel, locale }: { channel: Channel; locale: Locale }) {
  return (
    <div className="channel-intro">
      <div className="intro-icon">{channel.isPrivate ? <LockKeyhole size={25} /> : <Hash size={28} />}</div>
      <h2>{channel.name}</h2>
      <p>{channel.topic || (locale === "zh" ? "这个频道还没有主题。" : "This channel does not have a topic yet.")}</p>
      <span>{locale === "zh" ? "这是频道的开始。" : "This is the beginning of the channel."}</span>
    </div>
  );
}

function MessageCard(props: {
  message: Message;
  currentUser: User;
  locale: Locale;
  onThread: () => void;
  onReact: (emoji: string) => void;
  onRunAction: (action: "cancel" | "retry") => void;
  compact?: boolean;
  isThreadRoot?: boolean;
}) {
  const { message, currentUser, locale, onThread, onReact, onRunAction, compact, isThreadRoot } = props;
  const t = copy[locale];
  const agent = message.sender.type === "agent";
  const system = message.sender.type === "system";
  const running = ["queued", "streaming"].includes(message.status);
  const canManageRun = Boolean(message.runId) && (
    message.runTriggeredByUserId === currentUser.id
    || message.agentOwnerUserId === currentUser.id
    || currentUser.role === "owner"
  );
  if (system) {
    return (
      <div className="system-message">
        <Sparkles size={15} /><span>{message.content}</span>
      </div>
    );
  }
  return (
    <article className={`message-card ${agent ? "from-agent" : ""} ${compact ? "compact" : ""}`}>
      <Avatar name={message.sender.name} agent={agent} />
      <div className="message-main">
        <header>
          <strong>{message.sender.name}</strong>
          {agent && <span className="agent-badge">AGENT</span>}
          <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(message.createdAt))}</time>
        </header>
        <div className="message-content">
          <ReactMarkdown skipHtml>{message.content}</ReactMarkdown>
          {running && <span className="typing-cursor" />}
        </div>
        {message.status !== "sent" && (
          <div className={`message-status status-${message.status}`}>
            {running && <RefreshCw className="spin" size={13} />}
            {message.status === "input-required" && <MessageCircle size={13} />}
            {message.status === "failed" && <X size={13} />}
            {message.status === "canceled" && <Square size={12} />}
            <span>
              {running ? t.thinking : message.status === "input-required" ? t.inputRequired : message.status === "failed" ? t.failed : t.canceled}
            </span>
            {canManageRun && running && <button onClick={() => onRunAction("cancel")}>{t.stop}</button>}
            {canManageRun && ["failed", "canceled"].includes(message.status) && <button onClick={() => onRunAction("retry")}>{t.retry}</button>}
          </div>
        )}
        <div className="message-reactions">
          {message.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              className={reaction.reacted ? "reacted" : ""}
              onClick={() => onReact(reaction.emoji)}
            >
              <span>{reaction.emoji}</span><small>{reaction.count}</small>
            </button>
          ))}
          {!isThreadRoot && message.replyCount > 0 && (
            <button className="thread-count" onClick={onThread}>
              <MessageCircle size={13} /> {message.replyCount} {locale === "zh" ? "条回复" : "replies"}
            </button>
          )}
        </div>
      </div>
      <div className="message-hover-actions">
        {["👍", "❤️", "👀"].map((emoji) => <button key={emoji} onClick={() => onReact(emoji)}>{emoji}</button>)}
        {!isThreadRoot && <button onClick={onThread} title={t.reply}><MessageCircle size={15} /></button>}
        <button title="More"><MoreHorizontal size={15} /></button>
      </div>
    </article>
  );
}

function Composer(props: {
  channel: Channel;
  locale: Locale;
  rosterUsers: RosterUser[];
  rosterAgents: RosterAgent[];
  threadRootId?: number;
  onSent: (message: Message) => void;
}) {
  const { channel, locale, rosterUsers, rosterAgents, threadRootId, onSent } = props;
  const t = copy[locale];
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mentionMatch = value.match(/(?:^|\s)@([\w-]*)$/);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? null;
  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    return [
      ...rosterAgents
        .filter((agent) => agent.handle.includes(mentionQuery))
        .map((agent) => ({ id: agent.id, label: agent.name, handle: agent.handle, kind: "agent" as const })),
      ...rosterUsers
        .filter((user) => user.username.toLowerCase().includes(mentionQuery))
        .map((user) => ({ id: user.id, label: user.username, handle: user.username, kind: "user" as const })),
    ].slice(0, 7);
  }, [mentionQuery, rosterAgents, rosterUsers]);
  const chooseMention = (option: typeof mentionOptions[number]) => {
    setValue((current) => current.replace(/@[\w-]*$/, `@${option.handle} `));
    window.setTimeout(() => textarea.current?.focus(), 0);
  };
  const submit = async () => {
    if (!value.trim() || sending) return;
    setSending(true);
    setError("");
    const lower = value.toLowerCase();
    const mentions = [
      ...rosterAgents
        .filter((agent) => new RegExp(`(^|\\s)@${escapeRegExp(agent.handle)}\\b`, "i").test(lower))
        .map((agent) => ({ kind: "agent" as const, id: agent.id })),
      ...rosterUsers
        .filter((user) => new RegExp(`(^|\\s)@${escapeRegExp(user.username)}\\b`, "i").test(lower))
        .map((user) => ({ kind: "user" as const, id: user.id })),
    ];
    try {
      const data = await api<{ message: Message }>(
        `/api/channels/${encodeURIComponent(channel.id)}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            clientMessageId: crypto.randomUUID(),
            content: value.trim(),
            ...(threadRootId ? { threadRootId } : {}),
            mentions,
          }),
        },
      );
      onSent(data.message);
      setValue("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={`composer ${threadRootId ? "thread-composer" : ""}`}>
      {mentionOptions.length > 0 && (
        <div className="mention-menu">
          {mentionOptions.map((option) => (
            <button key={`${option.kind}:${option.id}`} onClick={() => chooseMention(option)}>
              <Avatar name={option.label} agent={option.kind === "agent"} />
              <span><strong>{option.label}</strong><small>@{option.handle}</small></span>
              {option.kind === "agent" && <span className="agent-badge">AGENT</span>}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textarea}
        value={value}
        rows={1}
        placeholder={threadRootId ? t.threadPlaceholder : `${t.messagePlaceholder} #${channel.name}`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-toolbar">
        <div>
          <button><CirclePlus size={19} /></button>
          <button onClick={() => setValue((current) => `${current}${current ? " " : ""}@`)}>
            <AtSign size={18} />
          </button>
          <button><SmilePlus size={18} /></button>
          <span>{t.mentionHint}</span>
        </div>
        <button className="send-button" disabled={!value.trim() || sending} onClick={submit} aria-label={t.send}>
          {sending ? <RefreshCw className="spin" size={17} /> : <Send size={17} />}
        </button>
      </div>
      {error && <div className="composer-error">{error}</div>}
    </div>
  );
}

function JoinChannel({ channel, locale, onJoin }: { channel: Channel; locale: Locale; onJoin: () => Promise<void> }) {
  const t = copy[locale];
  const [busy, setBusy] = useState(false);
  return (
    <div className="join-channel">
      <div className="intro-icon"><Hash size={28} /></div>
      <h2>#{channel.name}</h2>
      <p>{channel.topic}</p>
      <span>{channel.memberCount} {t.members.toLowerCase()} · {channel.agentCount} agents</span>
      <button
        className="primary-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onJoin();
          setBusy(false);
        }}
      >
        {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />} {t.join}
      </button>
    </div>
  );
}

function ModalShell(props: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={props.onClose} aria-label="Close" />
      <section className={`modal-card ${props.wide ? "wide" : ""}`}>
        <header>
          <div><h2>{props.title}</h2>{props.subtitle && <p>{props.subtitle}</p>}</div>
          <button className="icon-button" onClick={props.onClose}><X size={18} /></button>
        </header>
        <div className="modal-body">{props.children}</div>
      </section>
    </div>
  );
}

function ChannelModal({ locale, onClose, onCreated }: { locale: Locale; onClose: () => void; onCreated: (channel: Channel) => void }) {
  const t = copy[locale];
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const data = await api<{ channel: Channel }>("/api/channels", {
        method: "POST",
        body: JSON.stringify({ name, topic, isPrivate }),
      });
      onCreated(data.channel);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <ModalShell title={t.newChannel} subtitle={locale === "zh" ? "为一个项目、主题或团队建立共同空间。" : "Give a project, topic, or team a shared home."} onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        <label><span>{t.channelName}</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. product-launch" required autoFocus /></label>
        <label><span>{t.channelTopic}</span><textarea value={topic} onChange={(event) => setTopic(event.target.value)} rows={3} /></label>
        <label className="check-row">
          <input type="checkbox" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} />
          <span><strong>{t.privateChannel}</strong><small>{t.privateHint}</small></span>
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>{t.cancel}</button><button className="primary-button">{t.create}</button></div>
      </form>
    </ModalShell>
  );
}

function PeopleModal(props: {
  locale: Locale;
  channel: Channel;
  users: RosterUser[];
  agents: RosterAgent[];
  currentUser: User;
  onClose: () => void;
  onInvited: () => Promise<void>;
}) {
  const { locale, channel, users, agents, currentUser, onClose, onInvited } = props;
  const t = copy[locale];
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  return (
    <ModalShell title={`#${channel.name}`} subtitle={`${users.length} ${t.members.toLowerCase()} · ${agents.length} agents`} onClose={onClose}>
      {(channel.role === "manager" || currentUser.role === "owner") && (
        <form
          className="inline-invite"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api(`/api/channels/${encodeURIComponent(channel.id)}/invite`, {
                method: "POST",
                body: JSON.stringify({ username }),
              });
              setUsername("");
              await onInvited();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t.inviteByUsername} />
          <button className="primary-button">{t.invite}</button>
        </form>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="roster-list">
        <h3>{t.members}</h3>
        {users.map((user) => (
          <div className="roster-row" key={user.id}><Avatar name={user.username} /><span><strong>{user.username}</strong><small>{user.role}</small></span></div>
        ))}
        <h3>{t.channelAgents}</h3>
        {agents.map((agent) => (
          <div className="roster-row" key={agent.id}><Avatar name={agent.name} agent /><span><strong>{agent.name} <em className="agent-badge">AGENT</em></strong><small>@{agent.handle} · {t.ownedBy} {agent.ownerUsername}</small></span></div>
        ))}
      </div>
    </ModalShell>
  );
}

function AgentsModal(props: {
  locale: Locale;
  currentUser: User;
  agents: Agent[];
  channel: Channel | null;
  channelAgents: RosterAgent[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { locale, currentUser, agents, channel, channelAgents, onClose, onChanged } = props;
  const t = copy[locale];
  // null = closed, "new" = connect form, Agent = editing that agent.
  const [formFor, setFormFor] = useState<Agent | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", handle: "", description: "", rpcUrl: "", bearerToken: "", historyCount: 20 });
  const [discovering, setDiscovering] = useState(false);
  const [card, setCard] = useState<DiscoveredCard | null>(null);
  const channelAgentIds = new Set(channelAgents.map((agent) => agent.id));
  const editing = formFor && formFor !== "new" ? formFor : null;
  const closeForm = () => {
    setFormFor(null);
    setForm({ name: "", handle: "", description: "", rpcUrl: "", bearerToken: "", historyCount: 20 });
    setCard(null);
    setError("");
  };
  const openCreate = () => {
    if (formFor === "new") return closeForm();
    closeForm();
    setFormFor("new");
  };
  const openEdit = (agent: Agent) => {
    setCard(null);
    setError("");
    // The token is never echoed by the API, so it starts blank and is optional.
    setForm({
      name: agent.name,
      handle: agent.handle,
      description: agent.description,
      rpcUrl: agent.rpcUrl,
      bearerToken: "",
      historyCount: agent.historyCount,
    });
    setFormFor(agent);
  };
  // Suffixes a suggested handle until it clears the handles already on screen, so
  // discovery does not hand the user a value the server will reject.
  const freeHandle = (suggested: string) => {
    const taken = new Set(agents.map((agent) => agent.handle));
    if (!taken.has(suggested)) return suggested;
    for (let suffix = 2; suffix <= 50; suffix += 1) {
      const candidate = `${suggested.slice(0, 31 - `-${suffix}`.length)}-${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    return suggested;
  };
  const discover = async () => {
    if (!form.rpcUrl.trim()) return;
    setDiscovering(true);
    setError("");
    try {
      const result = await api<{ card: DiscoveredCard }>("/api/agents/discover", {
        method: "POST",
        body: JSON.stringify({ cardUrl: form.rpcUrl.trim() }),
      });
      setCard(result.card);
      setForm((current) => ({
        ...current,
        name: current.name || result.card.name,
        handle: current.handle || freeHandle(result.card.suggestedHandle),
        description: current.description || result.card.description,
      }));
    } catch (cause) {
      setCard(null);
      setError(`${t.discoverFailed} ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setDiscovering(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: form.name,
        handle: form.handle,
        description: form.description,
        historyCount: form.historyCount,
        // A discovered agent is saved by card URL so the worker re-reads the
        // endpoint from the card instead of trusting the pasted base URL.
        ...(card ? { cardUrl: card.cardUrl } : { rpcUrl: form.rpcUrl }),
        // Omitted rather than sent blank, so an edit keeps the stored token.
        ...(form.bearerToken ? { bearerToken: form.bearerToken } : {}),
      };
      await api(editing ? `/api/agents/${encodeURIComponent(editing.id)}` : "/api/agents", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      closeForm();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const credentialsChanged = Boolean(
    editing && (form.bearerToken || (card ? card.rpcUrl : form.rpcUrl) !== editing.rpcUrl),
  );
  return (
    <ModalShell title={t.agents} subtitle={locale === "zh" ? "连接你的 A2A Agent，并决定它可以加入哪些频道。" : "Connect your A2A agents and choose the channels where they can work."} onClose={onClose} wide>
      <div className="agent-modal-toolbar">
        <div className="security-note"><ShieldCheck size={16} /><span>{locale === "zh" ? "Token 加密保存且永不回显" : "Tokens are encrypted and never shown again"}</span></div>
        <button className="primary-button" onClick={openCreate}><Plus size={16} /> {t.addAgent}</button>
      </div>
      {formFor && (
        <form className="agent-form" onSubmit={submit}>
          <div className="form-grid">
            <label className="span-two">
              <span>{t.cardUrl}</span>
              <div className="input-with-action">
                <input
                  type="url"
                  value={form.rpcUrl}
                  onChange={(event) => setForm({ ...form, rpcUrl: event.target.value })}
                  // Auto-discovery only on first connect; during an edit a stray
                  // blur must not surface a card error on an unrelated rename.
                  onBlur={() => { if (!editing && !card && form.rpcUrl.trim()) void discover(); }}
                  placeholder="https://api.manyfold.ai/api/a2a/agents/agt_…/rpc"
                  required
                />
                <button type="button" className="secondary-button" onClick={() => void discover()} disabled={discovering || !form.rpcUrl.trim()}>
                  {discovering ? <><RefreshCw className="spin" size={14} /> {t.discovering}</> : <><Download size={14} /> {t.discover}</>}
                </button>
              </div>
            </label>
            <label className="span-two">
              <span>{t.token}</span>
              <input
                type="password"
                value={form.bearerToken}
                onChange={(event) => setForm({ ...form, bearerToken: event.target.value })}
                autoComplete="off"
                placeholder={editing ? t.tokenKeep : undefined}
                required={!editing}
              />
            </label>
            {card && (
              <div className="span-two card-preview">
                <ShieldCheck size={14} />
                <span><strong>{t.discoveredFrom}</strong> · A2A {card.protocolVersion} · {card.streaming ? t.streamingOn : t.streamingOff}</span>
                {card.skills.length > 0 && <small>{card.skills.join(" · ")}</small>}
              </div>
            )}
            <label><span>{t.agentName}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
            <label><span>{t.handle}</span><div className="input-prefix"><span>@</span><input value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} required /></div></label>
            <label className="span-two"><span>{t.description}</span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            <label><span>{t.history}</span><input type="number" min={0} max={100} value={form.historyCount} onChange={(event) => setForm({ ...form, historyCount: Number(event.target.value) })} /></label>
          </div>
          <p className="history-note"><Download size={14} /> {t.discoverHint}</p>
          <p className="history-note"><MessageCircle size={14} /> {t.historyNote}</p>
          <p className="history-note"><Globe2 size={14} /> {t.connectionTip}</p>
          {credentialsChanged && <p className="history-note"><RefreshCw size={14} /> {t.memoryResetNote}</p>}
          {editing && !editing.enabled && <p className="history-note"><Zap size={14} /> {t.reenableNote}</p>}
          {error && <div className="form-error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={closeForm}>{t.cancel}</button>
            <button className="primary-button" disabled={busy}>
              {busy
                ? <><RefreshCw className="spin" size={16} /> {t.testing}</>
                : <><Zap size={16} /> {editing ? t.saveChanges : t.saveTest}</>}
            </button>
          </div>
        </form>
      )}
      <div className="agent-list">
        {agents.length === 0 && <div className="empty-agents"><Bot size={28} /><p>{locale === "zh" ? "还没有连接 Agent。" : "No agents connected yet."}</p></div>}
        {agents.map((agent) => {
          const mine = agent.ownerUserId === currentUser.id;
          const inChannel = channel ? channelAgentIds.has(agent.id) : false;
          return (
            <article className={`agent-card ${!agent.enabled ? "disabled" : ""}`} key={agent.id}>
              <Avatar name={agent.name} agent />
              <div className="agent-card-main">
                <header><strong>{agent.name}</strong><span>@{agent.handle}</span>{!agent.enabled && <em>{t.disabled}</em>}</header>
                <p>{agent.description || "A connected A2A teammate."}</p>
                <small>{t.ownedBy} {agent.ownerUsername || (mine ? currentUser.username : "workspace member")} · {agent.historyCount} history messages</small>
              </div>
              <div className="agent-card-actions">
                {channel && mine && agent.enabled && (
                  <button
                    className={inChannel ? "secondary-button danger-text" : "secondary-button"}
                    onClick={async () => {
                      await api(`/api/channels/${encodeURIComponent(channel.id)}/agents/${encodeURIComponent(agent.id)}`, {
                        method: inChannel ? "DELETE" : "POST",
                      });
                      await onChanged();
                    }}
                  >
                    {inChannel ? t.removeFromChannel : t.addToChannel}
                  </button>
                )}
                {channel && mine && inChannel && (
                  <button
                    className="icon-button"
                    title={t.resetMemory}
                    onClick={async () => {
                      await api(`/api/channels/${encodeURIComponent(channel.id)}/agents/${encodeURIComponent(agent.id)}/reset`, {
                        method: "POST",
                        body: JSON.stringify({}),
                      });
                    }}
                  ><RefreshCw size={16} /></button>
                )}
                {mine && (
                  <button
                    className="icon-button"
                    title={t.editAgent}
                    aria-label={t.editAgent}
                    onClick={() => openEdit(agent)}
                  ><Pencil size={16} /></button>
                )}
                {(mine || currentUser.role === "owner") && agent.enabled && (
                  <button
                    className="icon-button danger-text"
                    title={t.remove}
                    onClick={async () => {
                      await api(`/api/agents/${encodeURIComponent(agent.id)}`, { method: "DELETE" });
                      await onChanged();
                    }}
                  ><X size={16} /></button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </ModalShell>
  );
}

function AccountModal(props: {
  locale: Locale;
  user: User;
  onClose: () => void;
  onLogout: () => Promise<void>;
}) {
  const { locale, user, onClose, onLogout } = props;
  const t = copy[locale];
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  return (
    <ModalShell title={t.settings} subtitle={`@${user.username} · ${user.role}`} onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            await api("/api/auth/change-password", {
              method: "POST",
              body: JSON.stringify({ currentPassword, newPassword }),
            });
            setCurrentPassword("");
            setNewPassword("");
            setNotice(t.saved);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <h3>{t.changePassword}</h3>
        <label><span>{t.currentPassword}</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
        <label><span>{t.newPassword}</span><input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-success"><Check size={15} /> {notice}</div>}
        <button className="primary-button">{t.updatePassword}</button>
      </form>
      <div className="modal-separator" />
      <button className="logout-button" onClick={onLogout}><LogOut size={17} /> {t.logout}</button>
    </ModalShell>
  );
}

async function reactToMessage(
  messageId: number,
  emoji: string,
  channelId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
) {
  try {
    const data = await api<{ message: Message }>(`/api/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    });
    if (data.message.channelId === channelId) {
      setMessages((current) => upsertMessage(current, data.message));
    }
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }
}

async function runAction(
  message: Message,
  action: "cancel" | "retry",
  setError: React.Dispatch<React.SetStateAction<string>>,
) {
  if (!message.runId) return;
  try {
    await api(`/api/agent-runs/${encodeURIComponent(message.runId)}/${action}`, { method: "POST" });
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
