# Team Agents

Team Agents 是一个面向人类与 A2A Agent 的频道协作应用。它采用类似 Slack 的频道、消息和 thread 组织方式，但使用独立的产品设计；同一频道里的成员可以通过结构化 `@agent` mention 调用自己接入的 A2A v0.3 Agent。

## 功能

- username + password 注册登录，首位用户自动成为 workspace owner
- 公开/私密频道、成员邀请、thread、reaction、未读状态
- 粘贴 Agent Card / A2A base / RPC 地址即可自动发现 Agent，名称、职责与端点从 card 读取
- 每位用户独立配置 Agent 的 JSON-RPC 地址、Bearer token 与历史条数
- `message/stream` SSE、Task 状态、artifact 增量合并、`tasks/get` / `tasks/resubscribe`
- Agent 流式占位消息、失败重试、取消和 `input-required`
- 中文 / English 本机切换，桌面三栏与移动端抽屉

## 技术架构

- React 19 + TypeScript + vinext
- Cloudflare Worker + D1
- 每频道一个 `ChannelRoom` Durable Object，使用可休眠 WebSocket
- `AGENT_TASKS` Queue 与 dead-letter queue
- scrypt（N=32768、r=8、p=3）密码哈希，保留旧 PBKDF2 记录的安全兼容校验
- AES-256-GCM Agent token 加密；API 永不回显 token

主要目录：

```text
app/                 React 界面
worker/              Worker API、A2A、Durable Object、安全层
db/schema.ts         Drizzle D1 模型
drizzle/             D1 migrations
tests/               安全与 A2A 解析测试
```

## 本地开发

要求 Node.js `>=22.13.0`。

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

打开 `http://localhost:3000`。本地 Agent 可以使用 HTTP 地址；生产环境仅允许公共 HTTPS 地址。

## 连接 Agent

在 Agent 弹窗里粘贴下面任意一种地址，点「读取 Agent Card」，名称 / 职责 / RPC 端点会自动填好，只剩 Bearer token 需要手填：

- Agent Card：`https://api.manyfold.ai/api/a2a/agents/<agentId>/agent-card.json`
- A2A base：`https://api.manyfold.ai/api/a2a/agents/<agentId>`
- RPC 端点：`https://api.manyfold.ai/api/a2a/agents/<agentId>/rpc`

后两种会依次尝试 `<base>/.well-known/agent-card.json` 与 `<base>/agent-card.json`。Card 是公开资源，读取时不发送 token。没有 card 的 A2A server 仍可手填全部字段。

API 上等价于：

```bash
curl -X POST http://localhost:3000/api/agents \
  -H 'content-type: application/json' \
  -d '{"cardUrl":"https://api.manyfold.ai/api/a2a/agents/<agentId>/rpc","bearerToken":"<token>"}'
```

`cardUrl` 之外的字段都可省略：`name` / `description` 取自 card，`handle` 由名称派生并自动加 `-2`、`-3` 后缀避免冲突，`historyCount` 默认 20。显式传入的字段优先于 card。

保存时先用 `tasks/get` 探测一个随机 task id 来确认 token 被接受 —— A2A server 在分发方法前鉴权，所以 401/403 说明 token 无效，task-not-found 说明可用，**不消耗 Agent turn**。只有当 server 未实现 `tasks/get` 时才回退到真实的 `message/stream` 测试。

Manyfold 托管 Agent 需要先在 agent 详情页 A2A tab 打开 exposure 并铸 External client token；exposure 未开启时端点统一返回 404。

连接失败会返回可读的错误码而不是笼统的 500：`agent_card_unavailable`（读不到 card）、`agent_token_rejected`（端点回 401/403）、`agent_unreachable`（网络 / 5xx）。校验不通过时不写库。

## 编辑 Agent

Agent 卡片上的铅笔按钮可以改名称、handle、职责、端点、历史条数与 token。Token 留空表示沿用已存的凭证。

只有端点或 token 变化时才会 `config_version+1` 并清空各频道的 A2A `contextId` —— 一个 contextId 只属于某个端点 + 身份，换了就必须重开会话；改名或调历史条数则保留频道记忆。

```bash
curl -X PATCH http://localhost:3000/api/agents/<agentId> \
  -H 'content-type: application/json' \
  -d '{"description":"新的职责描述"}'
```

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run check:worker
```

## GitHub Actions 部署

项目只通过 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 发布。push 到 `main` 或手动运行 workflow 后，会依次：

1. 执行 typecheck、lint、测试、生产依赖审计、构建和 Worker dry-run。
2. 幂等创建 `team-agents-db`、`team-agents-agent-tasks` 和 DLQ。
3. 写入真实 D1 ID、应用 migration、部署 Worker 和 Durable Object migration。
4. 从 GitHub Secrets 注入凭证加密与认证 HMAC 密钥。
5. 对 health、匿名 bootstrap 和 HTML shell 做生产 smoke test。

在 GitHub `production` environment 配置四个 secret：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CREDENTIALS_ENCRYPTION_KEY`（至少 32 个随机字符）
- `AUTH_HMAC_KEY`（至少 32 个随机字符，且与前者不同）

可选 environment variable `PRODUCTION_URL` 用于覆盖默认 smoke-test 地址 `https://team-agents.netmind-ai.workers.dev`。

`CREDENTIALS_ENCRYPTION_KEY` 轮换前需要重新加密已保存的 Agent token。
