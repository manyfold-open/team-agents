"use client";

import {
  AtSign,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  Hash,
  Languages,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Users,
  X,
  Zap,
} from "lucide-react";
import React, {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  unreadCount: number;
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
/** Composer seed; `nonce` makes repeat inserts of the same handle distinct. */
type Prefill = { text: string; nonce: number };

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
    connectManyfold: "从 Manyfold 连接",
    connectManyfoldHint: "在 Manyfold 上勾选账号下的 Agent，地址和 token 自动带回，无需复制粘贴。",
    connectOpening: "正在打开授权页…",
    connectWaiting: "等待你在 Manyfold 上完成授权…",
    connectCodeLabel: "核对确认码",
    connectCodeHint: "Manyfold 授权页上显示的码应与这里一致；不一致就不要授权。",
    connectReopen: "重新打开授权页",
    connectCancel: "取消",
    connectDenied: "授权被拒绝。",
    connectExpired: "授权会话已过期，请重新发起。",
    connectPopupBlocked: "浏览器拦截了弹窗，请点「重新打开授权页」。",
    connectedCount: (n: number) => `已连接 ${n} 个 Agent`,
    connectNone: "没有选中任何 Agent。",
    connectUnverified: "已保存，但连通性校验未通过",
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
    jumpLatest: "跳到最新",
    newMessages: (n: number) => `${n} 条新消息`,
    loadOlder: "加载更早的消息",
    loadingOlder: "正在加载更早的消息…",
    today: "今天",
    yesterday: "昨天",
    copyMessage: "复制内容",
    copied: "已复制",
    continueRun: "继续这个任务",
    inputRequiredHint: "再 @ 它一次，就会接着同一个任务继续。",
    unknownMention: (handle: string) => `@${handle} 不在这个频道，不会触发任何 Agent。`,
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
    connectManyfold: "Connect from Manyfold",
    connectManyfoldHint: "Pick agents from your Manyfold account — endpoint and token come back automatically, no copy-paste.",
    connectOpening: "Opening the authorization page…",
    connectWaiting: "Waiting for you to authorize on Manyfold…",
    connectCodeLabel: "Verification code",
    connectCodeHint: "The code on the Manyfold page must match this one. If it doesn’t, do not authorize.",
    connectReopen: "Reopen authorization page",
    connectCancel: "Cancel",
    connectDenied: "Authorization was denied.",
    connectExpired: "The authorization session expired — start again.",
    connectPopupBlocked: "Your browser blocked the popup — use “Reopen authorization page”.",
    connectedCount: (n: number) => `Connected ${n} agent${n === 1 ? "" : "s"}`,
    connectNone: "No agents were selected.",
    connectUnverified: "Saved, but the connection check failed",
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
    jumpLatest: "Jump to latest",
    newMessages: (n: number) => `${n} new message${n === 1 ? "" : "s"}`,
    loadOlder: "Load earlier messages",
    loadingOlder: "Loading earlier messages…",
    today: "Today",
    yesterday: "Yesterday",
    copyMessage: "Copy text",
    copied: "Copied",
    continueRun: "Continue this task",
    inputRequiredHint: "Mention it again and it picks up the same task.",
    unknownMention: (handle: string) => `@${handle} is not in this channel — no agent will run.`,
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

const BOTTOM_THRESHOLD = 80;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string, locale: Locale): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === today.toDateString()) return copy[locale].today;
  if (dayKey(iso) === yesterday.toDateString()) return copy[locale].yesterday;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    weekday: "short",
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

/**
 * Two passes: the synchronous one wins the common case, the frame-later one
 * catches Markdown that settles its own height after commit.
 */
function pinToBottom(node: HTMLElement): void {
  node.scrollTop = node.scrollHeight;
  window.requestAnimationFrame(() => {
    node.scrollTop = node.scrollHeight;
  });
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
  const messageScroll = useRef<HTMLDivElement>(null);
  // Follow new output only while the reader is already at the bottom, so
  // scrolling up to read history is never yanked away by a streaming agent.
  const stickToBottom = useRef(true);
  // Scroll position captured before an older page is prepended, so the layout
  // effect can keep the reader on the message they were reading.
  const restoreAnchor = useRef<{ top: number; height: number } | null>(null);
  const readCursor = useRef(0);
  const [followingLatest, setFollowingLatest] = useState(true);
  const [missedCount, setMissedCount] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderPending, setOlderPending] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [threadPrefill, setThreadPrefill] = useState<Prefill | null>(null);

  const refreshBootstrap = useCallback(async () => {
    const data = await api<Bootstrap>("/api/bootstrap");
    setBoot(data);
    if (data.authenticated && data.channels?.length) {
      setSelectedChannelId((current) => current || data.channels?.find((channel) => channel.joined)?.id || data.channels?.[0].id || "");
    }
    return data;
  }, []);

  // Clears the badge locally as well as on the server: the sidebar polls
  // bootstrap, and waiting a whole poll cycle to drop a dot you just read looks
  // like the app lost track of you.
  const markRead = useCallback(async (channelId: string, messageId: number) => {
    if (!channelId || !messageId) return;
    setBoot((current) => {
      if (!current?.channels) return current;
      return {
        ...current,
        channels: current.channels.map((channel) =>
          channel.id === channelId ? { ...channel, unread: false, unreadCount: 0 } : channel),
      };
    });
    await api(`/api/channels/${encodeURIComponent(channelId)}/read`, {
      method: "POST",
      body: JSON.stringify({ messageId }),
    }).catch(() => undefined);
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
    // A fresh channel always opens pinned to the newest message.
    stickToBottom.current = true;
    restoreAnchor.current = null;
    setFollowingLatest(true);
    setMissedCount(0);
    try {
      const [messageData, rosterData] = await Promise.all([
        api<{ messages: Message[]; hasMore?: boolean; requiresJoin: boolean }>(`/api/channels/${encodeURIComponent(channelId)}/messages`),
        api<{ members: RosterUser[]; agents: RosterAgent[] }>(`/api/channels/${encodeURIComponent(channelId)}/roster`),
      ]);
      setMessages(messageData.messages);
      setHasOlder(Boolean(messageData.hasMore));
      setRequiresJoin(messageData.requiresJoin);
      setRosterUsers(rosterData.members);
      setRosterAgents(rosterData.agents);
      setThreadRoot(null);
      setThreadMessages([]);
      const latest = messageData.messages.at(-1)?.id ?? 0;
      readCursor.current = latest;
      if (latest) await markRead(channelId, latest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingChannel(false);
    }
  }, [boot?.authenticated, markRead]);

  const loadOlder = useCallback(async () => {
    const node = messageScroll.current;
    const oldest = messages[0]?.id;
    if (!node || !oldest || !hasOlder || olderPending || !selectedChannelId) return;
    setOlderPending(true);
    restoreAnchor.current = { top: node.scrollTop, height: node.scrollHeight };
    try {
      const data = await api<{ messages: Message[]; hasMore?: boolean }>(
        `/api/channels/${encodeURIComponent(selectedChannelId)}/messages?before=${oldest}`,
      );
      setHasOlder(Boolean(data.hasMore));
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...data.messages.filter((message) => !known.has(message.id)), ...current];
      });
    } catch (cause) {
      restoreAnchor.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOlderPending(false);
    }
  }, [messages, hasOlder, olderPending, selectedChannelId]);

  // Anchor restore takes priority over follow-the-latest: a prepended page must
  // never be mistaken for new output at the bottom.
  useLayoutEffect(() => {
    const node = messageScroll.current;
    if (!node) return;
    const anchor = restoreAnchor.current;
    if (anchor) {
      restoreAnchor.current = null;
      // Assigned, not incremented: browsers that implement CSS scroll anchoring
      // have already shifted scrollTop by this same delta, and Safari has not.
      // Setting the absolute target lands correctly either way.
      node.scrollTop = anchor.top + (node.scrollHeight - anchor.height);
      return;
    }
    if (stickToBottom.current) {
      pinToBottom(node);
      setMissedCount(0);
    }
  }, [messages, loadingChannel]);

  // A reflow — window resize, phone rotation, the thread pane opening — changes
  // content height and would drift a pinned reader off the newest message.
  useEffect(() => {
    const node = messageScroll.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) pinToBottom(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [selectedChannelId, requiresJoin, loadingChannel]);

  const handleMessageScroll = useCallback(() => {
    const node = messageScroll.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < BOTTOM_THRESHOLD;
    stickToBottom.current = atBottom;
    setFollowingLatest(atBottom);
    if (atBottom) setMissedCount(0);
    if (node.scrollTop < 160) void loadOlder();
  }, [loadOlder]);

  const scrollToLatest = useCallback(() => {
    const node = messageScroll.current;
    if (!node) return;
    stickToBottom.current = true;
    setFollowingLatest(true);
    setMissedCount(0);
    pinToBottom(node);
  }, []);

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
    let readTimer = 0;
    let closed = false;
    let attempt = 0;
    // Only count as read what the reader could actually have seen: the tab is
    // in front and they are sitting at the bottom of the transcript.
    const noteRead = (messageId: number) => {
      if (messageId <= readCursor.current) return;
      if (document.visibilityState !== "visible" || !stickToBottom.current) return;
      readCursor.current = messageId;
      window.clearTimeout(readTimer);
      readTimer = window.setTimeout(() => {
        void markRead(selectedChannelId, readCursor.current);
      }, 1_200);
    };
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
            noteRead(message.id);
            if (payload.kind === "message.created" && !message.threadRootId && !stickToBottom.current) {
              setMissedCount((current) => current + 1);
            }
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
      window.clearTimeout(readTimer);
      socket?.close();
    };
  }, [selectedChannelId, requiresJoin, boot?.authenticated, loadChannel, refreshBootstrap, markRead]);

  // The channel socket only carries the open channel, so activity anywhere else
  // is invisible without this. Polling keeps the sidebar and the tab title
  // honest while the reader waits on a long agent run somewhere else.
  useEffect(() => {
    if (!boot?.authenticated) return;
    const sync = () => {
      if (document.visibilityState !== "visible") return;
      refreshBootstrap().catch(() => undefined);
    };
    const timer = window.setInterval(sync, 20_000);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [boot?.authenticated, refreshBootstrap]);

  const unreadElsewhere = (boot?.channels ?? []).reduce(
    (sum, channel) => sum + (channel.id === selectedChannelId ? 0 : channel.unreadCount),
    0,
  );

  useEffect(() => {
    document.title = unreadElsewhere > 0 ? `(${unreadElsewhere}) Team Agents` : "Team Agents";
  }, [unreadElsewhere]);

  const mentionInComposer = useCallback((handle: string, inThread: boolean) => {
    const seed = (current: Prefill | null): Prefill => ({
      text: `@${handle} `,
      nonce: (current?.nonce ?? 0) + 1,
    });
    if (inThread) setThreadPrefill(seed);
    else setPrefill(seed);
  }, []);

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
            {filteredChannels.map((channel) => {
              const active = channel.id === selectedChannelId;
              const unread = active ? 0 : channel.unreadCount;
              return (
                <button
                  key={channel.id}
                  className={`channel-row ${active ? "active" : ""} ${unread ? "has-unread" : ""}`}
                  onClick={() => {
                    setSelectedChannelId(channel.id);
                    setSidebarOpen(false);
                  }}
                >
                  {channel.isPrivate ? <LockKeyhole size={14} /> : <Hash size={15} />}
                  <span>{channel.name}</span>
                  {unread > 0 && (
                    <i className="unread-count">{unread > 99 ? "99+" : unread}</i>
                  )}
                </button>
              );
            })}
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
                <div className="transcript">
                  <div className="message-scroll" ref={messageScroll} onScroll={handleMessageScroll}>
                    {hasOlder ? (
                      <button
                        className="history-top"
                        onClick={() => void loadOlder()}
                        disabled={olderPending}
                      >
                        <RefreshCw className={olderPending ? "spin" : ""} size={14} />
                        {olderPending ? t.loadingOlder : t.loadOlder}
                      </button>
                    ) : (
                      <ChannelIntro channel={selectedChannel} locale={locale} />
                    )}
                    {loadingChannel ? (
                      <div className="inline-loader"><RefreshCw className="spin" size={18} /> Loading channel…</div>
                    ) : messages.length ? (
                      messages.map((message, index) => {
                        const previous = messages[index - 1];
                        const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
                        return (
                          <React.Fragment key={message.id}>
                            {newDay && (
                              <div className="day-divider">
                                <span>{dayLabel(message.createdAt, locale)}</span>
                              </div>
                            )}
                            <MessageCard
                              message={message}
                              currentUser={boot.user!}
                              locale={locale}
                              onThread={() => openThread(message)}
                              onReact={(emoji) => reactToMessage(message.id, emoji, selectedChannel.id, setMessages, setError)}
                              onRunAction={(action) => runAction(message, action, setError)}
                              onMention={(handle) => mentionInComposer(handle, false)}
                            />
                          </React.Fragment>
                        );
                      })
                    ) : (
                      <div className="empty-messages">
                        <MessageCircle size={30} />
                        <p>{t.noMessages}</p>
                      </div>
                    )}
                  </div>
                  {!followingLatest && (
                    <button className="jump-latest" onClick={scrollToLatest}>
                      <ChevronDown size={15} />
                      {missedCount > 0 ? t.newMessages(missedCount) : t.jumpLatest}
                    </button>
                  )}
                </div>
                <Composer
                  channel={selectedChannel}
                  locale={locale}
                  rosterUsers={rosterUsers}
                  rosterAgents={rosterAgents}
                  prefill={prefill}
                  onSent={(message) => {
                    // Sending is an explicit intent to be at the bottom.
                    stickToBottom.current = true;
                    setFollowingLatest(true);
                    setMessages((current) => upsertMessage(current, message));
                  }}
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
              onMention={(handle) => mentionInComposer(handle, true)}
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
                onMention={(handle) => mentionInComposer(handle, true)}
              />
            ))}
          </div>
          <Composer
            channel={selectedChannel}
            locale={locale}
            rosterUsers={rosterUsers}
            rosterAgents={rosterAgents}
            threadRootId={threadRoot.id}
            prefill={threadPrefill}
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
  onMention: (handle: string) => void;
  compact?: boolean;
  isThreadRoot?: boolean;
}) {
  const { message, currentUser, locale, onThread, onReact, onRunAction, onMention, compact, isThreadRoot } = props;
  const t = copy[locale];
  const [copied, setCopied] = useState(false);
  const agent = message.sender.type === "agent";
  const system = message.sender.type === "system";
  const running = ["queued", "streaming"].includes(message.status);
  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard permission denied — nothing useful to say, the text is on screen.
    }
  };
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
            {message.status === "input-required" && message.sender.handle && (
              <button onClick={() => onMention(message.sender.handle!)}>{t.continueRun}</button>
            )}
          </div>
        )}
        {message.status === "input-required" && (
          <p className="status-hint">{t.inputRequiredHint}</p>
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
        <button
          title={copied ? t.copied : t.copyMessage}
          aria-label={copied ? t.copied : t.copyMessage}
          onClick={() => void copyContent()}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
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
  prefill?: Prefill | null;
  onSent: (message: Message) => void;
}) {
  const { channel, locale, rosterUsers, rosterAgents, threadRootId, prefill, onSent } = props;
  const t = copy[locale];
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  // Keyed by the query it belongs to, so a changed query resets the highlight
  // without an effect round-trip.
  const [mentionCursor, setMentionCursor] = useState<{ query: string | null; index: number }>({
    query: null,
    index: 0,
  });
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [appliedPrefill, setAppliedPrefill] = useState(0);
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
  const menuOpen = mentionOptions.length > 0 && !mentionDismissed;
  const mentionIndex = mentionCursor.query === mentionQuery ? mentionCursor.index : 0;
  const moveMention = (step: number) => {
    setMentionCursor({
      query: mentionQuery,
      index: (mentionIndex + step + mentionOptions.length) % mentionOptions.length,
    });
  };
  // Adjusting state from a changed prop during render, rather than in an effect,
  // keeps the seeded draft in the very first paint.
  if (prefill && prefill.nonce !== appliedPrefill) {
    setAppliedPrefill(prefill.nonce);
    setValue((current) => {
      if (current.trimEnd().endsWith(prefill.text.trim())) return current;
      return `${current}${current && !current.endsWith(" ") ? " " : ""}${prefill.text}`;
    });
  }
  useEffect(() => {
    if (appliedPrefill) textarea.current?.focus();
  }, [appliedPrefill]);
  const chooseMention = (option: typeof mentionOptions[number]) => {
    setValue((current) => current.replace(/@[\w-]*$/, `@${option.handle} `));
    window.setTimeout(() => textarea.current?.focus(), 0);
  };
  // A handle nobody in this channel answers to would post as plain text and
  // silently start no run at all, so it gets called out before send.
  const unresolvedMention = useMemo(() => {
    const known = new Set([
      ...rosterAgents.map((agent) => agent.handle.toLowerCase()),
      ...rosterUsers.map((user) => user.username.toLowerCase()),
    ]);
    for (const match of value.matchAll(/(?:^|\s)@([\w-]{2,})/g)) {
      const stillTyping = (match.index ?? 0) + match[0].length === value.length && mentionQuery !== null;
      if (stillTyping) continue;
      if (!known.has(match[1].toLowerCase())) return match[1];
    }
    return null;
  }, [value, mentionQuery, rosterAgents, rosterUsers]);
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
      {menuOpen && (
        <div className="mention-menu">
          {mentionOptions.map((option, index) => (
            <button
              key={`${option.kind}:${option.id}`}
              className={index === mentionIndex ? "active" : ""}
              onMouseEnter={() => setMentionCursor({ query: mentionQuery, index })}
              onClick={() => chooseMention(option)}
            >
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
        onChange={(event) => {
          setValue(event.target.value);
          setMentionDismissed(false);
        }}
        onKeyDown={(event) => {
          // While the mention menu is up it owns the arrows and Enter, which is
          // what every chat client trains people to expect.
          if (menuOpen) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveMention(event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              chooseMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)]);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setMentionDismissed(true);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-toolbar">
        <div>
          <button
            title={t.mentionHint}
            aria-label={t.mentionHint}
            onClick={() => {
              setValue((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@`);
              setMentionDismissed(false);
              textarea.current?.focus();
            }}
          >
            <AtSign size={18} />
          </button>
          <span>{t.mentionHint}</span>
        </div>
        <button className="send-button" disabled={!value.trim() || sending} onClick={submit} aria-label={t.send}>
          {sending ? <RefreshCw className="spin" size={17} /> : <Send size={17} />}
        </button>
      </div>
      {unresolvedMention && !error && (
        <div className="composer-hint">{t.unknownMention(unresolvedMention)}</div>
      )}
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
  const card = useRef<HTMLElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  useEffect(() => {
    // Respect a field that already claimed focus via autoFocus.
    if (!card.current?.contains(document.activeElement)) card.current?.focus();
  }, []);
  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={props.onClose} aria-label="Close" />
      <section
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className={`modal-card ${props.wide ? "wide" : ""}`}
      >
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

interface ConnectSession {
  connectId: string;
  userCode: string;
  authUrl: string;
  expiresAt: string;
}

interface ConnectedAgentResult {
  id: string;
  name: string;
  handle: string;
  created: boolean;
  verified: boolean;
  warning?: string;
}

type ConnectPoll =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | {
      status: "approved";
      agents: ConnectedAgentResult[];
      failed: Array<{ name: string; error: string }>;
    };

/**
 * Device-code handshake against Manyfold: we open their consent page in a popup
 * and poll our own worker, which holds the device code. Tokens are minted on
 * Manyfold's side at poll time and land encrypted in D1 — they never reach the
 * browser, so nothing here ever holds a credential.
 */
function ManyfoldConnectPanel(props: {
  locale: Locale;
  onConnected: () => Promise<void>;
}) {
  const { locale, onConnected } = props;
  const t = copy[locale];
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConnectPoll | null>(null);
  const popup = useRef<Window | null>(null);

  const openConsent = (url: string) => {
    popup.current = window.open(url, "manyfold-connect", "width=520,height=760,noopener,noreferrer");
    if (!popup.current) setError(t.connectPopupBlocked);
  };

  const start = async () => {
    setStarting(true);
    setError("");
    setResult(null);
    try {
      const started = await api<{ connect: ConnectSession }>("/api/manyfold/connect", { method: "POST" });
      setSession(started.connect);
      openConsent(started.connect.authUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    const current = session;
    setSession(null);
    popup.current?.close();
    if (current) {
      await api(`/api/manyfold/connect/${encodeURIComponent(current.connectId)}`, { method: "DELETE" })
        .catch(() => undefined);
    }
  };

  // Polls while a session is live. Manyfold's session TTL is 15 minutes; the
  // interval stops on any terminal status so an abandoned popup goes quiet.
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    const tick = async () => {
      try {
        const poll = await api<ConnectPoll>(
          `/api/manyfold/connect/${encodeURIComponent(session.connectId)}/poll`,
          { method: "POST" },
        );
        if (stopped || poll.status === "pending") return;
        setResult(poll);
        setSession(null);
        popup.current?.close();
        if (poll.status === "approved") await onConnected();
      } catch (cause) {
        if (stopped) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setSession(null);
      }
    };
    const timer = setInterval(() => void tick(), 2_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [session, onConnected]);

  return (
    <div className="manyfold-connect">
      {!session && (
        <button className="secondary-button" onClick={() => void start()} disabled={starting}>
          {starting
            ? <><RefreshCw className="spin" size={14} /> {t.connectOpening}</>
            : <><Sparkles size={14} /> {t.connectManyfold}</>}
        </button>
      )}
      {session && (
        <div className="connect-waiting">
          <div className="connect-code">
            <small>{t.connectCodeLabel}</small>
            <strong>{session.userCode}</strong>
          </div>
          <p className="history-note"><ShieldCheck size={14} /> {t.connectCodeHint}</p>
          <p className="history-note"><RefreshCw className="spin" size={14} /> {t.connectWaiting}</p>
          <div className="connect-actions">
            <button type="button" className="secondary-button" onClick={() => openConsent(session.authUrl)}>
              <ExternalLink size={14} /> {t.connectReopen}
            </button>
            <button type="button" className="secondary-button danger-text" onClick={() => void cancel()}>
              {t.connectCancel}
            </button>
          </div>
        </div>
      )}
      {!session && !result && <p className="history-note"><Sparkles size={14} /> {t.connectManyfoldHint}</p>}
      {result?.status === "denied" && <div className="form-error">{t.connectDenied}</div>}
      {result?.status === "expired" && <div className="form-error">{t.connectExpired}</div>}
      {result?.status === "approved" && (
        <div className="connect-result">
          <strong>{result.agents.length ? t.connectedCount(result.agents.length) : t.connectNone}</strong>
          {result.agents.map((agent) => (
            <div className="connect-result-row" key={agent.id}>
              <Check size={14} /> <span>@{agent.handle} · {agent.name}</span>
              {!agent.verified && <em className="connect-warn">{t.connectUnverified}</em>}
            </div>
          ))}
          {result.failed.map((entry) => (
            <div className="connect-result-row failed" key={entry.name}>
              <X size={14} /> <span>{entry.name} · {entry.error}</span>
            </div>
          ))}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
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
      <ManyfoldConnectPanel locale={locale} onConnected={onChanged} />
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
